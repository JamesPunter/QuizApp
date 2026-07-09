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

# --- Minigames: slot machine -------------------------------------------------
# The slot has 3 reels. A spin wins only when all 3 reels land on the same
# symbol; the matched symbol decides the reward. The two coin symbols pay the
# stake back multiplied; the two drink symbols are physical rewards (no coins).
SLOT_COSTS = (50, 100, 200)
SLOT_2X = "coin2x"
SLOT_3X = "coin3x"
SLOT_SHOT = "shot"
SLOT_SIP = "sip"
SLOT_SYMBOLS = [SLOT_2X, SLOT_3X, SLOT_SHOT, SLOT_SIP]
# Coin multiplier applied to the stake for a matching coin symbol (0 = no coins).
SLOT_MULTIPLIERS = {SLOT_2X: 2, SLOT_3X: 3, SLOT_SHOT: 0, SLOT_SIP: 0}
# Chance a spin is a win. Honest independent reels would only match ~1/16 of the
# time; we bias the roll so roughly half of spins land a prize.
SLOT_WIN_PROBABILITY = 0.5


def is_admin_username(username: str) -> bool:
    return (username or "").lower() in ADMIN_USERNAMES


def resolve_contestant(name: str):
    """Map any-casing input to the canonical contestant name, or None if the
    name isn't part of the fixed cast."""
    return _CONTESTANTS_BY_LOWER.get((name or "").strip().lower())


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


class ScoreSnapshot(models.Model):
    """One snapshot of all scores per finalized round, for the Tussenstand graph."""

    round_index = models.IntegerField()
    scores = models.JSONField()  # {username: points}
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]


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
