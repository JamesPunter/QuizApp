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
    COIN_PACK_COINS,
    PLAYER_USERNAMES,
    PRESENCE_TTL_SECONDS,
    CRASH_GROWTH_HALF_LIFE,
    CRASH_HOUSE_EDGE,
    CRASH_MAX_MULTIPLIER,
    GIFT_SHOT,
    MINIGAME_COSTS,
    QUIZ_LOSER_MARKET,
    QUIZ_WINNER_MARKET,
    ROULETTE_PAYOUTS,
    ROULETTE_RED_NUMBERS,
    SLOT_COSTS,
    SLOT_JACKPOT,
    SLOT_JACKPOT_COINS,
    SLOT_JACKPOT_PROBABILITY,
    SLOT_MULTIPLIERS,
    SLOT_SHOT,
    SLOT_SIP,
    SLOT_SYMBOLS,
    SLOT_WIN_PROBABILITY,
    STARTING_BUDGET,
    STORE_DRINK_PRICES,
    ActivityEvent,
    Answer,
    Bet,
    BudgetSnapshot,
    CoinPurchase,
    CrashRound,
    GameState,
    Gift,
    Mark,
    Market,
    Player,
    Presence,
    Question,
    Score,
    ScoreSnapshot,
    SlotDrink,
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
    """Every player's points, defaulting to 0 for the full cast so the
    leaderboard and graph list all players from the start — even before anyone
    has been scored."""
    scores = {name: 0 for name in PLAYER_USERNAMES}
    for s in Score.objects.select_related("player"):
        scores[s.player.username] = s.points
    return scores


def current_budgets():
    """Every player's coins, defaulting to STARTING_BUDGET for the full cast so the
    budget list and graph show everyone from the start — even before anyone has
    logged in or placed a bet."""
    budgets = {name: STARTING_BUDGET for name in PLAYER_USERNAMES}
    for p in Player.objects.select_related("user"):
        if p.user.username in budgets:
            budgets[p.user.username] = p.budget
    return budgets


def snapshot_round_budgets(round_index):
    """Record every player's coins entering `round_index`, once. Called when the
    admin opens a round; the first open wins, so re-visiting an earlier round
    never overwrites its start-of-round figure (see BudgetSnapshot)."""
    if round_index < 0:
        return
    BudgetSnapshot.objects.get_or_create(
        round_index=round_index, defaults={"budgets": current_budgets()}
    )


def roster_usernames():
    """The full fixed cast, sorted for stable display. Because we know in advance
    who will play, every player appears on the board and in the betting/challenge
    lists from the start, whether or not they've logged in yet."""
    return sorted(PLAYER_USERNAMES, key=str.lower)


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
    """{username: pending|completed|failed} for the full cast (defaults pending),
    so every player shows up in the challenge-approval and challenge-bet lists."""
    statuses = {name: Player.CHALLENGE_PENDING for name in PLAYER_USERNAMES}
    for p in Player.objects.select_related("user"):
        if p.user.username in statuses:
            statuses[p.user.username] = p.challenge_status
    return statuses


# --- Activity feed (admin-only live log) -------------------------------------

# Short Dutch labels for the outcome markets, used in activity lines.
MARKET_LABELS = {
    QUIZ_WINNER_MARKET: "wie wint",
    QUIZ_LOSER_MARKET: "wie wordt laatste",
    CHALLENGE_MARKET: "challenge",
}


def record_activity(user, kind, text):
    """Append one line to the admin Activity feed. Informational only."""
    ActivityEvent.objects.create(user=user, kind=kind, text=text)


def recent_activity(limit=40):
    return [
        {
            "id": e.id,
            "username": e.user.username,
            "kind": e.kind,
            "text": e.text,
            "created_at": e.created_at.isoformat(),
        }
        for e in ActivityEvent.objects.select_related("user")[:limit]
    ]


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
    # Current coins for the full cast (the Tussenstand budget ranking).
    budgets = current_budgets()
    # Coins entering each round that has started, for the budget-over-rounds graph.
    # Round numbers are 1-based for display (round_index is the 0-based question).
    budget_history = [
        {"round": snap.round_index + 1, "budgets": snap.budgets}
        for snap in BudgetSnapshot.objects.all()
    ]

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
    pending_purchase = None
    slot_lock = None
    crash_round = None
    if not is_admin:
        player = Player.objects.filter(user=user).first()
        budget = player.budget if player else STARTING_BUDGET
        my_bets = [serialize_bet(b) for b in Bet.objects.filter(bettor=user)]
        pp = CoinPurchase.objects.filter(buyer=user, status=CoinPurchase.PENDING).first()
        if pp:
            pending_purchase = {"id": pp.id, "coins": pp.coins}
        # A drink hit on the slot that's still awaiting the quizmaster's OK: it
        # locks this player's machine (the client disables Spin) until confirmed.
        sd = SlotDrink.objects.filter(player=user, status=SlotDrink.PENDING).first()
        if sd:
            slot_lock = {"kind": sd.kind}
        # A live crash round the player can resume (e.g. after reopening the tab).
        # elapsed_ms is server-measured so the client's timer needs no clock sync.
        cr = CrashRound.objects.filter(player=user, active=True).order_by("-started_at").first()
        if cr:
            elapsed_ms = int((timezone.now() - cr.started_at).total_seconds() * 1000)
            crash_round = {
                "cost": cr.cost,
                "elapsed_ms": max(0, elapsed_ms),
                "crash_point": cr.crash_point,
            }

    # Drinks handed to me that I haven't dismissed yet (players and admins alike).
    gifts_received = [
        {"id": g.id, "kind": g.kind, "from": g.sender.username}
        for g in Gift.objects.filter(recipient=user, acknowledged=False).select_related("sender")
    ]

    # Admin-only: the coin packs waiting to be confirmed paid, plus the live feed
    # of what players have been doing (bets / minigames / store).
    pending_purchases = []
    pending_slot_drinks = []
    activity = []
    if is_admin:
        pending_purchases = [
            {"id": p.id, "username": p.buyer.username, "coins": p.coins}
            for p in CoinPurchase.objects.filter(status=CoinPurchase.PENDING).select_related("buyer")
        ]
        # Drinks landed on the slot, waiting for the quizmaster to confirm the
        # player has drunk (shown alongside the coin-pack queue).
        pending_slot_drinks = [
            {"id": d.id, "username": d.player.username, "kind": d.kind, "cost": d.cost}
            for d in SlotDrink.objects.filter(status=SlotDrink.PENDING).select_related("player")
        ]
        activity = recent_activity()

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
            # Store: my un-dismissed drink notifications + any coin pack still
            # waiting on a quizmaster's confirmation.
            "gifts_received": gifts_received,
            "pending_purchase": pending_purchase,
            # A slot drink awaiting the quizmaster's OK, which locks my slot
            # machine until confirmed ({"kind": "shot"|"sip"}), else null.
            "slot_lock": slot_lock,
            # A live crash round to resume (server-measured elapsed), else null.
            "crash_round": crash_round,
        },
        "scores": scores,
        "score_history": history,
        "roster": roster,
        "budgets": budgets,
        "budget_history": budget_history,
        "markets": markets,
        # Challenge bet: per-player admin verdicts + the parlay odds factor so
        # the client can preview payouts and disable already-decided players.
        "challenge": {
            "statuses": challenge_statuses(),
            "factor": CHALLENGE_ODDS_FACTOR,
        },
        "answers": admin_answers,
        # Coin packs awaiting confirmation (admin only; [] for players).
        "pending_purchases": pending_purchases,
        # Slot drinks awaiting confirmation (admin only; [] for players).
        "pending_slot_drinks": pending_slot_drinks,
        # Live feed of player actions (admin only; [] for players).
        "activity": activity,
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
    record_activity(
        user,
        ActivityEvent.BET,
        f"zette {amount} coins in op {selection} ({MARKET_LABELS.get(market_key, market_key)})",
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
    record_activity(
        user,
        ActivityEvent.BET,
        f"zette {amount} coins in op de challenge van {', '.join(picks)}",
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

    # A drink landed on an earlier spin locks the machine until a quizmaster
    # confirms the player has actually drunk it (see confirm_slot_drink).
    if SlotDrink.objects.filter(player=user, status=SlotDrink.PENDING).exists():
        return None, "Doe eerst je drankje en laat de beheerder het bevestigen."

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
    # SLOT_WIN_PROBABILITY regardless of the number of symbols. The jackpot is
    # rolled first: a flat SLOT_JACKPOT_COINS prize (independent of the stake)
    # that lands SLOT_JACKPOT_PROBABILITY of the time. Otherwise an ordinary win
    # sets all three reels to one random symbol; a loss is any non-matching combo.
    if random.random() < SLOT_JACKPOT_PROBABILITY:
        symbol = SLOT_JACKPOT
        reels = [symbol, symbol, symbol]
        coins_won = SLOT_JACKPOT_COINS
    elif random.random() < SLOT_WIN_PROBABILITY:
        symbol = random.choice(SLOT_SYMBOLS)
        reels = [symbol, symbol, symbol]
        coins_won = cost * SLOT_MULTIPLIERS.get(symbol, 0)
    else:
        while True:
            reels = [random.choice(SLOT_SYMBOLS) for _ in range(3)]
            if not (reels[0] == reels[1] == reels[2]):
                break
        symbol = None
        coins_won = 0
    win = symbol is not None

    # Charge the stake and credit any coin winnings in one budget update.
    player.budget += coins_won - cost
    player.save(update_fields=["budget"])

    outcome = f"won {coins_won} coins" if coins_won else ("won een prijs" if win else "verloor")
    record_activity(user, ActivityEvent.MINIGAME, f"speelde de gokkast (inzet {cost}) en {outcome}")

    # Three matching drink symbols is a physical reward: file it for a quizmaster
    # to confirm, which locks this player's machine until they've drunk it.
    if symbol in (SLOT_SHOT, SLOT_SIP):
        SlotDrink.objects.create(player=user, kind=symbol, cost=cost)

    return {
        "reels": reels,
        "win": win,
        "symbol": symbol,
        "cost": cost,
        "coins_won": coins_won,
    }, None


# --- Minigames: shared stake check -------------------------------------------


def _take_minigame_stake(user, cost):
    """Validate a minigame stake and load the player. Returns (player, cost,
    error) — cost is the parsed int. Shared by crash and roulette so every game
    rejects admins, junk stakes, and over-budget bets the same way as the slot."""
    if is_admin_username(user.username):
        return None, None, "Beheerders kunnen niet spelen."
    try:
        cost = int(cost)
    except (TypeError, ValueError):
        return None, None, "Ongeldige inzet."
    if cost not in MINIGAME_COSTS:
        return None, None, "Ongeldige inzet."
    player, _ = Player.objects.get_or_create(user=user)
    if cost > player.budget:
        return None, None, "Niet genoeg budget."
    return player, cost, None


# --- Minigames: crash --------------------------------------------------------


def _crash_multiplier(elapsed_seconds):
    """The live multiplier at `elapsed_seconds` into a round: 1.00x at the start,
    doubling every CRASH_GROWTH_HALF_LIFE seconds. Shared by the client's
    animation and the server's cash-out settlement (the server uses its own
    clock, so it stays authoritative)."""
    if elapsed_seconds <= 0:
        return 1.0
    return 2.0 ** (elapsed_seconds / CRASH_GROWTH_HALF_LIFE)


def _draw_crash_point():
    """Draw a secret crash point so P(crash >= m) = (1 - CRASH_HOUSE_EDGE) / m,
    clamped to [1.00, CRASH_MAX_MULTIPLIER]. Values in the house-edge tail land
    at 1.00 (an instant bust)."""
    u = random.random()
    raw = CRASH_MAX_MULTIPLIER if u <= 0 else (1.0 - CRASH_HOUSE_EDGE) / u
    return max(1.0, min(CRASH_MAX_MULTIPLIER, math.floor(raw * 100) / 100))


def start_crash(user, cost):
    """Begin a live crash round. Returns (result, error).

    Charges the stake up front and opens a CrashRound. The crash point is
    committed here and sent back so the client can animate the climb up to the
    crash and show it happen (even after the player cashes out). Cash-outs are
    still settled server-side on the server's own clock, so the round stays
    authoritative. Any earlier round the player left open is forfeited (its
    stake was already taken).
    """
    player, cost, error = _take_minigame_stake(user, cost)
    if error:
        return None, error

    # Forfeit any round the player wandered off from before opening a new one.
    CrashRound.objects.filter(player=user, active=True).update(active=False)

    player.budget -= cost
    player.save(update_fields=["budget"])

    round = CrashRound.objects.create(player=user, cost=cost, crash_point=_draw_crash_point())
    record_activity(user, ActivityEvent.MINIGAME, f"startte een crashronde (inzet {cost})")
    return {"active": True, "cost": cost, "crash_point": round.crash_point}, None


def cashout_crash(user):
    """Cash out the player's live crash round. Returns (result, error).

    Settled on the server's own clock: the elapsed-time multiplier is compared
    against the round's hidden crash point. Cash out before the crash and you
    bank stake * multiplier; tap too late and the stake (already charged at
    start) is gone. Either way the round closes and the crash point is revealed.
    """
    round = CrashRound.objects.filter(player=user, active=True).order_by("-started_at").first()
    if round is None:
        return None, "Geen actieve ronde."

    elapsed = (timezone.now() - round.started_at).total_seconds()
    multiplier = _crash_multiplier(elapsed)
    round.active = False
    round.save(update_fields=["active"])

    if multiplier >= round.crash_point:
        # Busted: the round crashed before this cash-out reached the server.
        record_activity(
            user,
            ActivityEvent.MINIGAME,
            f"crashte bij {round.crash_point}× en verloor {round.cost} coins",
        )
        return {
            "win": False,
            "multiplier": round.crash_point,
            "crash_point": round.crash_point,
            "cost": round.cost,
            "coins_won": 0,
        }, None

    multiplier = math.floor(multiplier * 100) / 100
    coins_won = int(round.cost * multiplier)
    player, _ = Player.objects.get_or_create(user=user)
    player.budget += coins_won
    player.save(update_fields=["budget"])
    record_activity(
        user,
        ActivityEvent.MINIGAME,
        f"cashte crash uit @ {multiplier}× en won {coins_won} coins",
    )
    return {
        "win": True,
        "multiplier": multiplier,
        "crash_point": round.crash_point,
        "cost": round.cost,
        "coins_won": coins_won,
    }, None


# --- Minigames: roulette -----------------------------------------------------


def _roulette_number_wins(bet, number, color):
    """Whether an outside/green `bet` wins on the landed `number`/`color`."""
    if bet in ("red", "black"):
        return color == bet
    if bet == "even":
        return number != 0 and number % 2 == 0
    if bet == "odd":
        return number % 2 == 1
    if bet == "low":
        return 1 <= number <= 18
    if bet == "high":
        return 19 <= number <= 36
    if bet == "green":
        return number == 0
    return False


def play_roulette(user, cost, bet):
    """Spin the wheel once for a `bet` staking `cost`. Returns (result, error).

    A single-zero European wheel: outside even-money bets pay 2x, green 0 pays
    36x. The landed number + colour ride back on the result so the client can
    animate the wheel before revealing where it stopped.
    """
    payout_mult = ROULETTE_PAYOUTS.get(bet)
    if payout_mult is None:
        return None, "Ongeldige inzet."

    player, cost, error = _take_minigame_stake(user, cost)
    if error:
        return None, error

    number = random.randint(0, 36)
    if number == 0:
        color = "green"
    elif number in ROULETTE_RED_NUMBERS:
        color = "red"
    else:
        color = "black"

    win = _roulette_number_wins(bet, number, color)
    coins_won = cost * payout_mult if win else 0
    player.budget += coins_won - cost
    player.save(update_fields=["budget"])

    outcome = f"won {coins_won} coins" if win else "verloor"
    record_activity(
        user,
        ActivityEvent.MINIGAME,
        f"speelde roulette op {bet} (inzet {cost}) en {outcome}",
    )

    return {
        "number": number,
        "color": color,
        "bet": bet,
        "win": win,
        "cost": cost,
        "coins_won": coins_won,
    }, None


# --- Store -------------------------------------------------------------------


def request_coin_purchase(user):
    """File a pending coin pack for the quizmaster to confirm. Returns
    (purchase, error). One pending purchase at a time keeps the admin queue
    clean — the euro is paid via Tikkie outside the app."""
    if is_admin_username(user.username):
        return None, "Beheerders kopen geen coins."

    if CoinPurchase.objects.filter(buyer=user, status=CoinPurchase.PENDING).exists():
        return None, "Je hebt al een aankoop in afwachting van bevestiging."

    purchase = CoinPurchase.objects.create(buyer=user, coins=COIN_PACK_COINS)
    record_activity(
        user, ActivityEvent.PURCHASE, f"vroeg {COIN_PACK_COINS} coins aan via Tikkie"
    )
    return purchase, None


def confirm_coin_purchase(purchase_id):
    """Admin: mark a pending coin pack paid and credit the coins. Idempotent-ish:
    an already-confirmed purchase is rejected. Returns (purchase, error)."""
    purchase = CoinPurchase.objects.filter(id=purchase_id).select_related("buyer").first()
    if purchase is None:
        return None, "Onbekende aankoop."
    if purchase.status == CoinPurchase.CONFIRMED:
        return None, "Deze aankoop is al bevestigd."

    _credit(purchase.buyer, purchase.coins)
    purchase.status = CoinPurchase.CONFIRMED
    purchase.confirmed_at = timezone.now()
    purchase.save(update_fields=["status", "confirmed_at"])
    return purchase, None


def confirm_slot_drink(drink_id):
    """Admin: confirm a player has done the shot/slok they landed on the slot
    machine, which unlocks their machine. Idempotent-ish: an already-confirmed
    drink is rejected. Returns (drink, error)."""
    drink = SlotDrink.objects.filter(id=drink_id).select_related("player").first()
    if drink is None:
        return None, "Onbekend drankje."
    if drink.status == SlotDrink.CONFIRMED:
        return None, "Dit drankje is al bevestigd."

    drink.status = SlotDrink.CONFIRMED
    drink.confirmed_at = timezone.now()
    drink.save(update_fields=["status", "confirmed_at"])
    return drink, None


def give_drink(user, kind, recipient_name):
    """Spend coins to make another contestant drink. Returns (gift, error). The
    recipient can be any other player or a quizmaster; they get a notification."""
    if is_admin_username(user.username):
        return None, "Beheerders kopen niks in de store."

    price = STORE_DRINK_PRICES.get(kind)
    if price is None:
        return None, "Ongeldig item."

    name = resolve_contestant(recipient_name) if isinstance(recipient_name, str) else None
    if name is None:
        return None, "Onbekende ontvanger."
    if name == user.username:
        return None, "Je kunt niet aan jezelf uitdelen."

    recipient = User.objects.filter(username=name).first()
    if recipient is None:
        return None, f"{name} is nog niet ingelogd."

    player, _ = Player.objects.get_or_create(user=user)
    if price > player.budget:
        return None, "Niet genoeg budget."

    player.budget -= price
    player.save(update_fields=["budget"])

    gift = Gift.objects.create(sender=user, recipient=recipient, kind=kind)
    drink = "een shot" if kind == GIFT_SHOT else "een slokje"
    record_activity(user, ActivityEvent.GIFT, f"trakteerde {name} op {drink}")
    return gift, None


def acknowledge_gift(user, gift_id):
    """Recipient dismisses a drink notification. Returns (gift, error)."""
    gift = Gift.objects.filter(id=gift_id, recipient=user).first()
    if gift is None:
        return None, "Onbekende melding."
    if not gift.acknowledged:
        gift.acknowledged = True
        gift.save(update_fields=["acknowledged"])
    return gift, None


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


def participant_usernames():
    """Players who actually joined (have a Player profile). Winner/loser markets
    settle among these, so the full-cast 0s that the board shows for players who
    never showed up aren't counted as a win or as last place."""
    return {
        p.user.username
        for p in Player.objects.select_related("user")
        if not is_admin_username(p.user.username)
    }


def quiz_winners(scores):
    participants = participant_usernames()
    entries = {n: s for n, s in scores.items() if n in participants}
    if not entries:
        return []
    mx = max(entries.values())
    if mx <= 0:
        return []
    return [n for n, s in entries.items() if s == mx]


def quiz_losers(scores):
    """Last place: the lowest score among players who joined. Empty until a round
    is scored (before then everyone is tied at 0 and there is no meaningful
    loser)."""
    participants = participant_usernames()
    entries = {n: s for n, s in scores.items() if n in participants}
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


def save_challenge_statuses(statuses):
    """Persist a batch of admin challenge verdicts at once, then settle the
    challenge bets a single time. Nothing is written (and no payout happens)
    until this is called — the admin drafts verdicts client-side and commits
    them here with the "save" button. `statuses` maps username -> status.
    Validates every entry before writing any, so a bad payload is a no-op.
    Returns (None, error)."""
    if not isinstance(statuses, dict):
        return None, "Ongeldige gegevens."
    valid = (Player.CHALLENGE_PENDING, Player.CHALLENGE_COMPLETED, Player.CHALLENGE_FAILED)
    resolved = {}
    for username, verdict in statuses.items():
        if verdict not in valid:
            return None, "Ongeldige status."
        name = resolve_contestant(username)
        if name is None or is_admin_username(name):
            return None, "Onbekende speler."
        # Canonical name keys the map, so mixed-casing dupes collapse to one.
        resolved[name] = verdict

    for name, verdict in resolved.items():
        user = User.objects.filter(username=name).first()
        if user is None:
            # A cast member who hasn't logged in has no account row yet. Pending
            # is already the default for them, so there's nothing to store; only
            # materialise the account (as login would) when there's a real
            # verdict to record — e.g. to settle a bet placed on their name.
            if verdict == Player.CHALLENGE_PENDING:
                continue
            user, _ = User.objects.get_or_create(username=name)
        player, _ = Player.objects.get_or_create(user=user)
        if player.challenge_status != verdict:
            player.challenge_status = verdict
            player.save(update_fields=["challenge_status"])
    settle_challenge_bets()
    return None, None


def reset_game():
    """Wipe the quiz + betting game for a fresh start. Keeps the roster."""
    Answer.objects.all().delete()
    Mark.objects.all().delete()
    Score.objects.all().delete()
    ScoreSnapshot.objects.all().delete()
    BudgetSnapshot.objects.all().delete()
    Bet.objects.all().delete()
    CoinPurchase.objects.all().delete()
    Gift.objects.all().delete()
    SlotDrink.objects.all().delete()
    CrashRound.objects.all().delete()
    ActivityEvent.objects.all().delete()
    # Reset each player's coins and challenge verdict. The board always lists the
    # full cast (see roster_usernames), so this doesn't hide anyone; in_roster is
    # kept for the register_player heartbeat.
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
