from django.contrib.auth.models import User
from django.db import models

# The fixed cast. Contestants pick themselves from this list at login — no free
# text. Admins run the quiz and never play or bet. Names are the canonical
# display casing; matching is case-insensitive.
PLAYER_USERNAMES = ["Stein", "Niels", "Ivar", "Matta", "Levi", "Sep", "Max", "Tris"]
ADMIN_USERNAMES_DISPLAY = ["Finn", "James"]

# Lower-cased admin set for the case-insensitive is_admin check (mirrors the
# frontend's ADMIN_USERNAMES).
ADMIN_USERNAMES = {n.lower() for n in ADMIN_USERNAMES_DISPLAY}

# canonical-name lookup for both players and admins, keyed by lower-case.
_CONTESTANTS_BY_LOWER = {
    n.lower(): n for n in PLAYER_USERNAMES + ADMIN_USERNAMES_DISPLAY
}

# A device counts as "present" while it has polled within this window. The 1s
# poll acts as a heartbeat; if a device goes away its name frees up after this.
PRESENCE_TTL_SECONDS = 12

# Every player starts a betting game with this many coins.
STARTING_BUDGET = 1000

# --- End-of-quiz rank coin rewards -------------------------------------------
# Winning the quiz is only one way to end up with the most coins: when the final
# question is scored, every player who joined is paid (or docked) coins by their
# finishing position in the score ranking. RANK_COIN_REWARDS is the fixed table
# for the eight-strong cast (index 0 = 1st place); first place wins the most and
# the bottom two places are docked. Also shown on the Tussenstand throughout the
# game as the coins each position is currently playing for (see
# services.rank_reward_map / award_rank_coins).
RANK_COIN_REWARDS = [1000, 750, 500, 200, 100, 0, -250, -500]


def rank_coin_rewards(num_players):
    """Coins for finishing positions 1..num_players (index 0 = 1st place), taken
    from the fixed RANK_COIN_REWARDS table. One source of truth for both the
    payout and the Tussenstand preview."""
    return RANK_COIN_REWARDS[: max(0, num_players)]

# Markets, all keyed by these constants.
#  - quiz_winner: "Wie wint de quiz?"  — highest final score wins, settled at end.
#  - quiz_loser:  "Wie wordt laatste?" — lowest final score wins, settled at end.
#  - challenge:   "Wie haalt zijn challenge?" — a parlay: a bettor picks a set of
#    other players they think will complete their personal challenge. Pays out
#    instantly (per bettor) once every player they picked is declared complete,
#    and is lost the moment any picked player is declared failed.
QUIZ_WINNER_MARKET = "quiz_winner"
QUIZ_LOSER_MARKET = "quiz_loser"
CHALLENGE_MARKET = "challenge"

# Challenge parlay odds: each picked player multiplies the payout by this factor,
# so total decimal odds = CHALLENGE_ODDS_FACTOR ** (number of players picked).
CHALLENGE_ODDS_FACTOR = 1.8

# Coins paid to a player when the admins approve their personal challenge as
# completed. Handed out exactly once, the moment the verdict is set to completed
# (see services.award_challenge_reward); idempotent via
# Player.challenge_reward_paid so re-toggling the verdict never pays twice.
CHALLENGE_COMPLETION_REWARD = 500

# --- Minigames: slot machine -------------------------------------------------
# The slot has 3 reels. A spin wins only when all 3 reels land on the same
# symbol; the matched symbol decides the reward. The two coin symbols pay the
# stake back multiplied; the two drink symbols are physical rewards (no coins).
SLOT_COSTS = (50, 100, 200)
SLOT_2X = "coin2x"
SLOT_3X = "coin3x"
SLOT_SHOT = "shot"
SLOT_SIP = "sip"
SLOT_JACKPOT = "jackpot"
SLOT_SYMBOLS = [SLOT_2X, SLOT_3X, SLOT_SHOT, SLOT_SIP]
# Coin multiplier applied to the stake for a matching coin symbol (0 = no coins).
SLOT_MULTIPLIERS = {SLOT_2X: 2, SLOT_3X: 3, SLOT_SHOT: 0, SLOT_SIP: 0}
# Chance a spin is a win. Honest independent reels would only match ~1/16 of the
# time; we bias the roll so roughly half of spins land a prize.
SLOT_WIN_PROBABILITY = 0.5
# The jackpot: a big coin prize that lands roughly 1 in 20 spins. It sits outside
# SLOT_SYMBOLS so it can only appear via this roll. It pays a multiple of the
# STAKE (not a flat amount) so the house edge is the same at every stake tier — a
# flat jackpot made the cheap 50-coin spin wildly player-favourable. With this
# multiplier every spin returns 0.05*7 + 0.475*1.25 = 94.4% of the stake on
# average (a ~5.6% house edge), matching the crash game's edge.
SLOT_JACKPOT_PROBABILITY = 0.05
SLOT_JACKPOT_MULTIPLIER = 7

# All three minigames share the same stake tiers.
MINIGAME_COSTS = SLOT_COSTS

# --- Minigames: crash --------------------------------------------------------
# A live round climbs from 1.00x over time until it "crashes"; the player taps
# Cash Out to bank stake * (current multiplier). Cash out before the crash and
# you win, after it and the stake is lost. The crash point is committed when the
# round starts (see CrashRound) and sent to the client so it can animate the
# crash, but cash-outs are settled server-side on the server clock. It is drawn
# so the house keeps a small edge: P(crash >= m) = (1 - CRASH_HOUSE_EDGE) / m.
# The multiplier is a function of elapsed time, doubling every
# CRASH_GROWTH_HALF_LIFE seconds.
CRASH_HOUSE_EDGE = 0.05
CRASH_MAX_MULTIPLIER = 50.0
CRASH_GROWTH_HALF_LIFE = 1.5  # seconds for the multiplier to double

# --- Minigames: roulette -----------------------------------------------------
# European single-zero wheel (0-36). The outside even-money bets pay 2x the
# stake; a straight bet on green 0 pays 36x. The zero is the house edge.
ROULETTE_RED_NUMBERS = frozenset(
    {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
)
# bet key -> total stake multiple returned on a win.
ROULETTE_PAYOUTS = {
    "red": 2,
    "black": 2,
    "even": 2,
    "odd": 2,
    "low": 2,
    "high": 2,
    "green": 36,
}

# --- Store -------------------------------------------------------------------
# The store sells two kinds of thing:
#  - coin packs, paid for with real money via a Tikkie link. The app can't see
#    the euro land, so a purchase is filed as pending and a quizmaster confirms
#    it, which credits the coins (see CoinPurchase).
#  - drinks ("uitdelen"): the buyer spends coins to make another contestant (a
#    player or a quizmaster) drink; the target gets an in-app notification
#    (see Gift).
COIN_PACK_COINS = 50
COIN_PACK_PRICE_EUR = 1
GIFT_SHOT = "shot"
GIFT_SIP = "sip"
STORE_DRINK_PRICES = {GIFT_SHOT: 200, GIFT_SIP: 35}


# Per-account login passwords, keyed by canonical name. This is a LAN quiz on a
# trusted network (see CORS_ALLOW_ALL_ORIGINS), so plaintext here is acceptable
# for the threat model — it only stops the wrong friend from grabbing your name.
CONTESTANT_PASSWORDS = {
    "James": "Jimmy2002",
    "Finn": "Yobbe2003",
    "Stein": "Marit1234",
    "Niels": "Celia3333",
    "Ivar": "Barber2222",
    "Tris": "Sude7890",
    "Levi": "Tara2343",
    "Max": "Sacha1122",
    "Matta": "DT0099",  # Matthijs
    "Sep": "Rippen5566",
}


def is_admin_username(username: str) -> bool:
    return (username or "").lower() in ADMIN_USERNAMES


def resolve_contestant(name: str):
    """Map any-casing input to the canonical contestant name, or None if the
    name isn't part of the fixed cast."""
    return _CONTESTANTS_BY_LOWER.get((name or "").strip().lower())


def check_contestant_password(name: str, password: str) -> bool:
    """True if `password` matches the account named `name` (canonical casing).
    Case-sensitive on the password; the name must resolve to a known account."""
    expected = CONTESTANT_PASSWORDS.get(name)
    return expected is not None and password == expected


class Question(models.Model):
    TEXT = "text"
    MULTIPLE_CHOICE = "multiple_choice"
    # A text question with an extra "bonus" answer field. Scores 2 points when
    # both the main answer and the bonus are correct, 1 point when only the main
    # answer is correct, and 0 otherwise (see services.finalize).
    TEXT_BONUS = "text_bonus"
    TYPE_CHOICES = [
        (TEXT, "Text"),
        (MULTIPLE_CHOICE, "Multiple choice"),
        (TEXT_BONUS, "Text with bonus"),
    ]

    # 1-based display order; the game's current_index is a 0-based position
    # into the ordered question list.
    order = models.PositiveIntegerField(unique=True)
    text = models.TextField()
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    options = models.JSONField(default=list, blank=True)  # only for multiple_choice
    # Prompt shown above the second input, only for text_bonus questions.
    bonus_prompt = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"Q{self.order}: {self.text[:40]}"


class GameState(models.Model):
    """Singleton row (pk=1) holding the one live quiz's state."""

    OPEN = "open"
    CLOSED = "closed"
    FINALIZED = "finalized"
    ENTRY_CHOICES = [(OPEN, "Open"), (CLOSED, "Closed"), (FINALIZED, "Finalized")]

    current_index = models.IntegerField(default=-1)  # -1 = waiting / not started
    entry_state = models.CharField(max_length=20, choices=ENTRY_CHOICES, default=OPEN)
    scores_visible = models.BooleanField(default=False)
    # Set once the end-of-quiz rank coins have been handed out (when the final
    # question is scored), so the payout runs exactly once. Cleared on reset.
    rank_coins_awarded = models.BooleanField(default=False)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"GameState(index={self.current_index}, {self.entry_state})"


class Answer(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="answers")
    player = models.ForeignKey(User, on_delete=models.CASCADE, related_name="answers")
    text = models.CharField(max_length=500)
    # Second answer for text_bonus questions; blank for all other types.
    bonus_text = models.CharField(max_length=500, blank=True, default="")
    submitted_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("question", "player")


class Mark(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="marks")
    player = models.ForeignKey(User, on_delete=models.CASCADE, related_name="marks")
    correct = models.BooleanField()
    # Admin verdict on the bonus answer (text_bonus only). None = not judged / N/A;
    # the bonus point counts only when `correct` is also True.
    bonus_correct = models.BooleanField(null=True, blank=True, default=None)

    class Meta:
        unique_together = ("question", "player")


class Score(models.Model):
    player = models.OneToOneField(User, on_delete=models.CASCADE, related_name="score")
    points = models.IntegerField(default=0)


class RankReward(models.Model):
    """The end-of-quiz coin award for one player: their finishing position and
    the coins credited (docked when negative). Written once when the final
    question is scored (see services.award_rank_coins) so the app can show the
    final "coins per position" breakdown. Cleared on reset."""

    player = models.ForeignKey(User, on_delete=models.CASCADE, related_name="rank_rewards")
    rank = models.PositiveIntegerField()
    coins = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["rank"]


class ScoreSnapshot(models.Model):
    """One snapshot of all scores per finalized round, for the Tussenstand graph."""

    round_index = models.IntegerField()
    scores = models.JSONField()  # {username: points}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


class BudgetSnapshot(models.Model):
    """One snapshot of every player's coins at the START of a round, for the
    Tussenstand budget graph. Captured the first time a round is opened (see
    services.snapshot_round_budgets), so it reflects all betting/minigame/store
    activity up to that point — including the initial STARTING_BUDGET each at the
    start of round 1. Keyed uniquely by round so re-visiting a round never
    overwrites its start-of-round figure."""

    round_index = models.IntegerField(unique=True)
    budgets = models.JSONField()  # {username: coins}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["round_index"]


class Player(models.Model):
    """Betting-side profile: roster membership + coin budget. Non-admins only."""

    CHALLENGE_PENDING = "pending"
    CHALLENGE_COMPLETED = "completed"
    CHALLENGE_FAILED = "failed"
    CHALLENGE_CHOICES = [
        (CHALLENGE_PENDING, "Pending"),
        (CHALLENGE_COMPLETED, "Completed"),
        (CHALLENGE_FAILED, "Failed"),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="player")
    budget = models.IntegerField(default=STARTING_BUDGET)
    in_roster = models.BooleanField(default=True)
    # Admin verdict on this player's personal challenge (drives the challenge bet).
    challenge_status = models.CharField(
        max_length=10, choices=CHALLENGE_CHOICES, default=CHALLENGE_PENDING
    )
    # Set once the CHALLENGE_COMPLETION_REWARD coins have been paid for a
    # completed challenge, so the reward lands exactly once no matter how often
    # the admin re-toggles the verdict. Cleared on reset.
    challenge_reward_paid = models.BooleanField(default=False)


class Presence(models.Model):
    """Heartbeat for the login picker's "one name = one device" rule. Updated on
    every poll; `last_seen` NULL (or older than PRESENCE_TTL_SECONDS) means the
    name is free to claim."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="presence")
    last_seen = models.DateTimeField(null=True, blank=True)


class Market(models.Model):
    key = models.CharField(max_length=50, unique=True)
    is_open = models.BooleanField(default=False)
    is_settled = models.BooleanField(default=False)

    def __str__(self):
        return self.key


class Bet(models.Model):
    OPEN = "open"
    WON = "won"
    LOST = "lost"
    STATUS_CHOICES = [(OPEN, "Open"), (WON, "Won"), (LOST, "Lost")]

    bettor = models.ForeignKey(User, on_delete=models.CASCADE, related_name="bets")
    market = models.CharField(max_length=50)
    # Single-pick markets (winner/loser) use `selection`. Parlay markets
    # (challenge) store the full pick list in `selections`; `selection` then
    # holds a human-readable joined copy for display/admin.
    selection = models.CharField(max_length=150)
    selections = models.JSONField(default=list, blank=True)
    amount = models.IntegerField()
    odds = models.FloatField()  # decimal odds locked in at placement time
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    payout = models.IntegerField(default=0)
    placed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["placed_at"]


class CoinPurchase(models.Model):
    """A real-money coin pack bought via Tikkie. Filed as pending when the player
    taps the item; a quizmaster confirms it once the euro lands, which credits
    the coins to the buyer (see services.confirm_coin_purchase)."""

    PENDING = "pending"
    CONFIRMED = "confirmed"
    STATUS_CHOICES = [(PENDING, "Pending"), (CONFIRMED, "Confirmed")]

    buyer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="coin_purchases")
    coins = models.IntegerField(default=COIN_PACK_COINS)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]


class Gift(models.Model):
    """A drink handed out via the store: the buyer spends coins to make the
    recipient (a player or a quizmaster) drink. The recipient sees it as an
    in-app notification until they acknowledge it."""

    KIND_CHOICES = [(GIFT_SHOT, "Shot"), (GIFT_SIP, "Sip")]

    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name="gifts_sent")
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name="gifts_received")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    acknowledged = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class SlotDrink(models.Model):
    """A physical drink (shot or slok) a player landed by matching three drink
    symbols on the slot machine. Filed as pending the moment it's hit; a
    quizmaster confirms it once the player has actually drunk. The player can't
    spin again until it's confirmed (see services.spin_slot)."""

    KIND_CHOICES = [(SLOT_SHOT, "Shot"), (SLOT_SIP, "Slok")]
    PENDING = "pending"
    CONFIRMED = "confirmed"
    STATUS_CHOICES = [(PENDING, "Pending"), (CONFIRMED, "Confirmed")]

    player = models.ForeignKey(User, on_delete=models.CASCADE, related_name="slot_drinks")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    cost = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]


class ActivityEvent(models.Model):
    """A log line of something a player did — placing a bet, playing a minigame,
    or using the store. Shown live on the admin-only Activity page. Purely
    informational: no game logic reads it back, and reset clears it."""

    BET = "bet"
    MINIGAME = "minigame"
    PURCHASE = "purchase"
    GIFT = "gift"
    KIND_CHOICES = [
        (BET, "Bet"),
        (MINIGAME, "Minigame"),
        (PURCHASE, "Purchase"),
        (GIFT, "Gift"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="activity_events")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    # Human-readable Dutch description, built where the event is recorded.
    text = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class CrashRound(models.Model):
    """One live crash round. The stake is charged when the round starts and the
    crash_point is committed then (and sent to the client so it can animate the
    crash). Cash-outs are settled server-side by comparing the elapsed-time
    multiplier against crash_point (see services.cashout_crash)."""

    player = models.ForeignKey(User, on_delete=models.CASCADE, related_name="crash_rounds")
    cost = models.PositiveIntegerField()
    crash_point = models.FloatField()
    started_at = models.DateTimeField(auto_now_add=True)
    # Cleared once the round is cashed out, busted, or forfeited by a new round.
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-started_at"]
