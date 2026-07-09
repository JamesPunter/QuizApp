"""Game logic: state assembly, odds, betting settlement, scoring, reset.

This is the server-side source of truth for everything that used to live in the
frontend's localStorage (quizState.ts / bettingState.ts).
"""

import math
from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone

import random

from .models import (
    CHALLENGE_MARKET,
    CHALLENGE_ODDS_FACTOR,
    PLAYER_USERNAMES,
    PRESENCE_TTL_SECONDS,
    QUIZ_LOSER_MARKET,
    QUIZ_WINNER_MARKET,
    SLOT_COSTS,
    SLOT_MULTIPLIERS,
    SLOT_SYMBOLS,
    SLOT_WIN_PROBABILITY,
    STARTING_BUDGET,
    Answer,
    Bet,
    GameState,
    Mark,
    Market,
    Player,
    Presence,
    Question,
    Score,
    ScoreSnapshot,
    is_admin_username,
    resolve_contestant,
)


# --- Presence (login picker: one name = one device) --------------------------


def _presence_cutoff():
    return timezone.now() - timedelta(seconds=PRESENCE_TTL_SECONDS)


def touch_presence(user):
    """Record that this device is alive right now (called on every poll)."""
    Presence.objects.update_or_create(user=user, defaults={"last_seen": timezone.now()})


def is_present(user):
    """True if some device is actively holding this name."""
    p = Presence.objects.filter(user=user).first()
    return bool(p and p.last_seen and p.last_seen >= _presence_cutoff())


def present_usernames():
    cutoff = _presence_cutoff()
    return [
        p.user.username
        for p in Presence.objects.filter(last_seen__gte=cutoff).select_related("user")
    ]


def release_presence(user):
    """Free the name immediately (called on logout)."""
    Presence.objects.filter(user=user).update(last_seen=None)


# --- Odds --------------------------------------------------------------------


def _softmax_odds(scores, candidates, questions_remaining, sign):
    """Shared softmax odds. p_i ∝ exp(sign * score_i / T), decimal odds = 1/p.

    sign=+1 favours high scorers (quiz winner); sign=-1 favours low scorers
    (quiz loser). T = max(sqrt(questions_remaining), 0.5); odds floored at 1.05.
    """
    odds = {}
    if not candidates:
        return odds

    T = max(math.sqrt(max(questions_remaining, 0)), 0.5)
    raw = [sign * scores.get(c, 0) for c in candidates]
    peak = max(raw)
    exps = [math.exp((s - peak) / T) for s in raw]
    total = sum(exps)

    for c, e in zip(candidates, exps):
        p = e / total
        odds[c] = max(1.05, round((1 / p) * 100) / 100)
    return odds


def compute_quiz_winner_odds(scores, candidates, questions_remaining):
    """Softmax win-probability odds, mirroring bettingState.computeQuizWinnerOdds."""
    return _softmax_odds(scores, candidates, questions_remaining, +1)


def compute_quiz_loser_odds(scores, candidates, questions_remaining):
    """Inverse softmax: the lowest scorer is the likeliest last place."""
    return _softmax_odds(scores, candidates, questions_remaining, -1)


# --- Read helpers ------------------------------------------------------------


def current_scores():
    return {s.player.username: s.points for s in Score.objects.select_related("player")}


def roster_usernames():
    names = [
        p.user.username
        for p in Player.objects.filter(in_roster=True).select_related("user")
        if not is_admin_username(p.user.username)
    ]
    names.sort(key=lambda n: n.lower())
    return names


def _questions_remaining():
    total = Question.objects.count()
    return max(total - ScoreSnapshot.objects.count(), 0)


def quiz_winner_odds():
    return compute_quiz_winner_odds(current_scores(), roster_usernames(), _questions_remaining())


def quiz_loser_odds():
    return compute_quiz_loser_odds(current_scores(), roster_usernames(), _questions_remaining())


def market_odds(market_key):
    """Odds map shown on the board for a single-pick outcome market."""
    if market_key == QUIZ_WINNER_MARKET:
        return quiz_winner_odds()
    if market_key == QUIZ_LOSER_MARKET:
        return quiz_loser_odds()
    return {}


def challenge_statuses():
    """{username: pending|completed|failed} for every rostered player."""
    return {
        p.user.username: p.challenge_status
        for p in Player.objects.filter(in_roster=True).select_related("user")
        if not is_admin_username(p.user.username)
    }


def serialize_bet(b):
    return {
        "id": b.id,
        "market": b.market,
        "selection": b.selection,
        "selections": b.selections or [],
        "amount": b.amount,
        "odds": b.odds,
        "status": b.status,
        "payout": b.payout,
    }


def build_state(user):
    """The single payload every device polls. Player vs admin views differ."""
    # Keep an active contestant in the roster: after a quiz restart clears the
    # roster, anyone still polling re-appears here within a poll cycle, while
    # contestants who have left stay gone.
    register_player(user)
    # Heartbeat: this poll keeps the device's name claimed (see Presence).
    touch_presence(user)

    game = GameState.get()
    questions = list(Question.objects.all())
    total = len(questions)
    idx = game.current_index
    is_admin = is_admin_username(user.username)

    current_q = questions[idx] if 0 <= idx < total else None
    question = None
    if current_q is not None:
        question = {
            "id": current_q.id,
            "index": idx,
            "text": current_q.text,
            "type": current_q.type,
            "options": current_q.options,
            "bonus_prompt": current_q.bonus_prompt,
        }

    scores = current_scores()
    history = [snap.scores for snap in ScoreSnapshot.objects.all()]
    roster = roster_usernames()
    present = set(present_usernames())
    budgets = {
        p.user.username: p.budget
        for p in Player.objects.filter(in_roster=True).select_related("user")
        if not is_admin_username(p.user.username)
    }

    markets = [
        {
            "key": m.key,
            "is_open": m.is_open,
            "is_settled": m.is_settled,
            "odds": market_odds(m.key),
        }
        for m in Market.objects.all()
    ]

    # Per-user fields.
    my_answer = None
    my_bonus_answer = None
    my_mark = None
    my_bonus_mark = None
    if current_q is not None:
        a = Answer.objects.filter(question=current_q, player=user).first()
        my_answer = a.text if a else None
        my_bonus_answer = a.bonus_text if a else None
        if game.entry_state == GameState.FINALIZED:
            mk = Mark.objects.filter(question=current_q, player=user).first()
            my_mark = mk.correct if mk else None
            my_bonus_mark = mk.bonus_correct if mk else None

    budget = None
    my_bets = []
    if not is_admin:
        player = Player.objects.filter(user=user).first()
        budget = player.budget if player else STARTING_BUDGET
        my_bets = [serialize_bet(b) for b in Bet.objects.filter(bettor=user)]

    # Admin-only: everyone's answers + marks for the current question.
    admin_answers = []
    if is_admin and current_q is not None:
        marks = {m.player_id: m for m in Mark.objects.filter(question=current_q)}
        for a in Answer.objects.filter(question=current_q).select_related("player"):
            mk = marks.get(a.player_id)
            admin_answers.append(
                {
                    "username": a.player.username,
                    "answer": a.text,
                    "bonus_answer": a.bonus_text,
                    "mark": mk.correct if mk else None,
                    "bonus_mark": mk.bonus_correct if mk else None,
                }
            )

    return {
        "current_index": idx,
        "entry_state": game.entry_state,
        "scores_visible": game.scores_visible,
        "total_questions": total,
        "question": question,
        "you": {
            "username": user.username,
            "is_admin": is_admin,
            "my_answer": my_answer,
            "my_bonus_answer": my_bonus_answer,
            "my_mark": my_mark,
            "my_bonus_mark": my_bonus_mark,
            "budget": budget,
            "my_bets": my_bets,
        },
        "scores": scores,
        "score_history": history,
        "roster": roster,
        "budgets": budgets,
        "markets": markets,
        # Challenge bet: per-player admin verdicts + the parlay odds factor so
        # the client can preview payouts and disable already-decided players.
        "challenge": {
            "statuses": challenge_statuses(),
            "factor": CHALLENGE_ODDS_FACTOR,
        },
        "answers": admin_answers,
        # The fixed cast + who's currently online, so admins can spot no-shows.
        "players": list(PLAYER_USERNAMES),
        "present": sorted(present),
    }


# --- Player actions ----------------------------------------------------------


def place_bet(user, market_key, selection, amount):
    """Returns (bet, error). Mirrors bettingState.placeBet validation."""
    if is_admin_username(user.username):
        return None, "Beheerders kunnen niet inzetten."

    market = Market.objects.filter(key=market_key).first()
    if market is None or market.is_settled:
        return None, "Deze markt is afgerekend."
    if not market.is_open:
        return None, "Deze markt is nog niet open om op te wedden."

    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return None, "Voer een bedrag groter dan 0 in."
    if amount <= 0:
        return None, "Voer een bedrag groter dan 0 in."

    player, _ = Player.objects.get_or_create(user=user)
    if amount > player.budget:
        return None, "Niet genoeg budget."

    odds = market_odds(market_key)
    if selection not in odds:
        return None, "Ongeldige keuze."

    player.budget -= amount
    player.save(update_fields=["budget"])

    bet = Bet.objects.create(
        bettor=user,
        market=market_key,
        selection=selection,
        amount=amount,
        odds=odds[selection],
    )
    return bet, None


def place_challenge_bet(user, selections, amount):
    """Place the one-per-player challenge parlay. Returns (bet, error).

    The bettor picks a set of other players; payout = amount * factor**picks,
    won only if every pick is declared complete (see settle_challenge_bets).
    """
    if is_admin_username(user.username):
        return None, "Beheerders kunnen niet inzetten."

    market = Market.objects.filter(key=CHALLENGE_MARKET).first()
    if market is None or market.is_settled:
        return None, "Deze markt is afgerekend."
    if not market.is_open:
        return None, "Deze markt is nog niet open om op te wedden."

    if Bet.objects.filter(bettor=user, market=CHALLENGE_MARKET).exists():
        return None, "Je hebt je challenge-inzet al geplaatst."

    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return None, "Voer een bedrag groter dan 0 in."
    if amount <= 0:
        return None, "Voer een bedrag groter dan 0 in."

    if not isinstance(selections, list) or not selections:
        return None, "Kies minstens één speler."

    roster = set(roster_usernames())
    statuses = challenge_statuses()
    picks = []
    for raw in selections:
        name = resolve_contestant(raw) if isinstance(raw, str) else None
        if name is None or name not in roster:
            return None, "Ongeldige keuze."
        if name == user.username:
            return None, "Je kunt niet op je eigen challenge wedden."
        if name in picks:
            return None, "Dubbele keuze."
        if statuses.get(name, Player.CHALLENGE_PENDING) != Player.CHALLENGE_PENDING:
            return None, f"De challenge van {name} is al beslist — die kun je niet kiezen."
        picks.append(name)

    player, _ = Player.objects.get_or_create(user=user)
    if amount > player.budget:
        return None, "Niet genoeg budget."

    odds = round((CHALLENGE_ODDS_FACTOR ** len(picks)) * 100) / 100

    player.budget -= amount
    player.save(update_fields=["budget"])

    bet = Bet.objects.create(
        bettor=user,
        market=CHALLENGE_MARKET,
        selection=", ".join(picks),
        selections=picks,
        amount=amount,
        odds=odds,
    )
    return bet, None


# --- Minigames: slot machine -------------------------------------------------


def spin_slot(user, cost):
    """Play one slot-machine spin. Returns (result, error).

    Charges `cost` up front, rolls 3 independent reels, and only pays out when
    all three match. A matching coin symbol returns the stake multiplied (2× or
    3×); a matching drink symbol is a physical reward (no coins). Anything else
    loses the stake. The result carries the reels so the client can animate them.
    """
    if is_admin_username(user.username):
        return None, "Beheerders kunnen niet spelen."

    try:
        cost = int(cost)
    except (TypeError, ValueError):
        return None, "Ongeldige inzet."
    if cost not in SLOT_COSTS:
        return None, "Ongeldige inzet."

    player, _ = Player.objects.get_or_create(user=user)
    if cost > player.budget:
        return None, "Niet genoeg budget."

    # Decide the outcome first, then build reels to match, so the win rate is
    # SLOT_WIN_PROBABILITY regardless of the number of symbols. A win sets all
    # three reels to one random symbol; a loss is any non-matching combination.
    if random.random() < SLOT_WIN_PROBABILITY:
        symbol = random.choice(SLOT_SYMBOLS)
        reels = [symbol, symbol, symbol]
    else:
        while True:
            reels = [random.choice(SLOT_SYMBOLS) for _ in range(3)]
            if not (reels[0] == reels[1] == reels[2]):
                break
        symbol = None
    win = symbol is not None
    coins_won = cost * SLOT_MULTIPLIERS.get(symbol, 0) if win else 0

    # Charge the stake and credit any coin winnings in one budget update.
    player.budget += coins_won - cost
    player.save(update_fields=["budget"])

    return {
        "reels": reels,
        "win": win,
        "symbol": symbol,
        "cost": cost,
        "coins_won": coins_won,
    }, None


# --- Admin actions -----------------------------------------------------------


def finalize(game, question):
    """Apply +1 per correct mark, snapshot scores, set finalized. Idempotent."""
    if game.entry_state == GameState.FINALIZED:
        return  # already scored — don't double count

    for m in Mark.objects.filter(question=question, correct=True).select_related("player"):
        # 1 point for a correct answer, plus a bonus point when the question's
        # bonus answer is also correct (text_bonus questions only).
        points = 1 + (1 if m.bonus_correct else 0)
        score, _ = Score.objects.get_or_create(player=m.player)
        score.points += points
        score.save(update_fields=["points"])

    game.entry_state = GameState.FINALIZED
    game.save(update_fields=["entry_state"])

    ScoreSnapshot.objects.create(round_index=game.current_index, scores=current_scores())


def quiz_winners(scores):
    entries = {n: s for n, s in scores.items() if not is_admin_username(n)}
    if not entries:
        return []
    mx = max(entries.values())
    if mx <= 0:
        return []
    return [n for n, s in entries.items() if s == mx]


def quiz_losers(scores):
    """Last place: the lowest score among players. Empty until a round is scored
    (before then every player is tied at 0 and there is no meaningful loser)."""
    entries = {n: s for n, s in scores.items() if not is_admin_username(n)}
    if not entries or ScoreSnapshot.objects.count() == 0:
        return []
    mn = min(entries.values())
    return [n for n, s in entries.items() if s == mn]


def _credit(user, amount):
    player, _ = Player.objects.get_or_create(user=user)
    player.budget += amount
    player.save(update_fields=["budget"])


def _settle_outcome_market(market_key, winners):
    """Pay out a single-pick outcome market from a set of winning selections.
    Idempotent (a settled market is skipped)."""
    market, _ = Market.objects.get_or_create(key=market_key)
    if market.is_settled:
        return None

    paid_out = won = lost = 0
    for b in Bet.objects.filter(market=market_key, status=Bet.OPEN).select_related("bettor"):
        if b.selection in winners:
            b.status = Bet.WON
            b.payout = round(b.amount * b.odds)
            _credit(b.bettor, b.payout)
            paid_out += b.payout
            won += 1
        else:
            b.status = Bet.LOST
            b.payout = 0
            lost += 1
        b.save(update_fields=["status", "payout"])

    market.is_settled = True
    market.save(update_fields=["is_settled"])
    return {"winners": winners, "paid_out": paid_out, "won_count": won, "lost_count": lost}


def settle_quiz_winner():
    """Pay out the quiz-winner market from final scores. Idempotent."""
    return _settle_outcome_market(QUIZ_WINNER_MARKET, quiz_winners(current_scores()))


def settle_quiz_loser():
    """Pay out the last-place market from final scores. Idempotent."""
    return _settle_outcome_market(QUIZ_LOSER_MARKET, quiz_losers(current_scores()))


def settle_market(market_key):
    """Settle a single-pick outcome market by key (winner or loser)."""
    if market_key == QUIZ_WINNER_MARKET:
        return settle_quiz_winner()
    if market_key == QUIZ_LOSER_MARKET:
        return settle_quiz_loser()
    return None


def settle_challenge_bets():
    """Resolve every open challenge bet against the current admin verdicts.

    A bet is lost the moment any picked player is failed, and won (paid out
    instantly) once every picked player is completed. Bets with picks still
    pending stay open. Idempotent — only OPEN bets are touched."""
    statuses = challenge_statuses()
    for b in Bet.objects.filter(market=CHALLENGE_MARKET, status=Bet.OPEN).select_related("bettor"):
        picks = b.selections or []
        results = [statuses.get(p, Player.CHALLENGE_PENDING) for p in picks]
        if any(r == Player.CHALLENGE_FAILED for r in results):
            b.status = Bet.LOST
            b.payout = 0
            b.save(update_fields=["status", "payout"])
        elif picks and all(r == Player.CHALLENGE_COMPLETED for r in results):
            b.status = Bet.WON
            b.payout = round(b.amount * b.odds)
            _credit(b.bettor, b.payout)
            b.save(update_fields=["status", "payout"])


def declare_challenge(username, status):
    """Admin verdict on a player's challenge; re-settles challenge bets.
    Returns (player, error)."""
    if status not in (Player.CHALLENGE_PENDING, Player.CHALLENGE_COMPLETED, Player.CHALLENGE_FAILED):
        return None, "Ongeldige status."
    name = resolve_contestant(username)
    if name is None or is_admin_username(name):
        return None, "Onbekende speler."
    user = User.objects.filter(username=name).first()
    if user is None:
        return None, "Onbekende speler."

    player, _ = Player.objects.get_or_create(user=user)
    player.challenge_status = status
    player.save(update_fields=["challenge_status"])
    settle_challenge_bets()
    return player, None


def reset_game():
    """Wipe the quiz + betting game for a fresh start. Keeps the roster."""
    Answer.objects.all().delete()
    Mark.objects.all().delete()
    Score.objects.all().delete()
    ScoreSnapshot.objects.all().delete()
    Bet.objects.all().delete()
    # Clear the visible contestant lists (betje / tussenstand). Active players
    # re-add themselves via register_player on their next poll; those who left
    # stay off the roster until they rejoin.
    Player.objects.all().update(
        budget=STARTING_BUDGET, in_roster=False, challenge_status=Player.CHALLENGE_PENDING
    )
    Market.objects.all().update(is_open=False, is_settled=False)

    game = GameState.get()
    game.current_index = -1
    game.entry_state = GameState.OPEN
    game.scores_visible = False
    game.save()


def register_player(user):
    """Ensure a non-admin user is in the roster with a budget. Called on join
    and on every poll, so an active contestant returns to the roster after a
    restart cleared it."""
    if is_admin_username(user.username):
        return
    player, created = Player.objects.get_or_create(user=user)
    if not created and not player.in_roster:
        player.in_roster = True
        player.save(update_fields=["in_roster"])
