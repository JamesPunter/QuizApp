"""Unit tests for the betting markets, run against an isolated test DB:

    venv/Scripts/python.exe manage.py test quiz

These cover the two markets added on top of "Wie wint de quiz?":
  - quiz_loser  ("Wie wordt laatste?") — inverse of the winner market.
  - challenge   ("Wie haalt zijn challenge?") — the per-bettor parlay.
"""

from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from . import services
from .models import (
    CHALLENGE_MARKET,
    QUIZ_LOSER_MARKET,
    QUIZ_WINNER_MARKET,
    ActivityEvent,
    Bet,
    CrashRound,
    GameState,
    Mark,
    Market,
    Player,
    Question,
    Score,
    ScoreSnapshot,
)


class BettingMarketsTest(TestCase):
    def setUp(self):
        # Three players with distinct scores: Niels ahead, Stein middle, Ivar last.
        self.users = {}
        for name, points in [("Stein", 1), ("Niels", 2), ("Ivar", 0)]:
            user = User.objects.create(username=name)
            Player.objects.create(user=user, budget=1000, in_roster=True)
            Score.objects.create(player=user, points=points)
            self.users[name] = user
        # A scored round exists, so last place is meaningful.
        ScoreSnapshot.objects.create(round_index=0, scores=services.current_scores())

    def _open_market(self, key):
        Market.objects.create(key=key, is_open=True)

    def budget(self, name):
        return Player.objects.get(user=self.users[name]).budget

    # --- Loser market -------------------------------------------------------

    def test_loser_odds_favour_the_lowest_scorer(self):
        odds = services.quiz_loser_odds()
        # Lowest score = likeliest last place = shortest odds.
        self.assertLess(odds["Ivar"], odds["Stein"])
        self.assertLess(odds["Stein"], odds["Niels"])

    def test_settle_loser_pays_the_lowest_scorer(self):
        self._open_market(QUIZ_LOSER_MARKET)
        odds = services.quiz_loser_odds()["Ivar"]
        bet, err = services.place_bet(self.users["Stein"], QUIZ_LOSER_MARKET, "Ivar", 100)
        self.assertIsNone(err)
        self.assertEqual(self.budget("Stein"), 900)

        result = services.settle_quiz_loser()
        self.assertEqual(result["winners"], ["Ivar"])
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.WON)
        self.assertEqual(bet.payout, round(100 * odds))
        self.assertEqual(self.budget("Stein"), 900 + round(100 * odds))

    # --- Challenge parlay ---------------------------------------------------

    def test_challenge_odds_scale_exponentially_with_picks(self):
        self._open_market(CHALLENGE_MARKET)
        bet, err = services.place_challenge_bet(self.users["Stein"], ["Niels", "Ivar"], 50)
        self.assertIsNone(err)
        self.assertEqual(bet.odds, round(1.8 ** 2 * 100) / 100)
        self.assertEqual(sorted(bet.selections), ["Ivar", "Niels"])
        self.assertEqual(self.budget("Stein"), 950)

    def test_cannot_back_your_own_challenge(self):
        self._open_market(CHALLENGE_MARKET)
        bet, err = services.place_challenge_bet(self.users["Stein"], ["Stein"], 50)
        self.assertIsNone(bet)
        self.assertIn("eigen challenge", err)

    def test_only_one_challenge_entry_per_player(self):
        self._open_market(CHALLENGE_MARKET)
        services.place_challenge_bet(self.users["Stein"], ["Niels"], 50)
        bet, err = services.place_challenge_bet(self.users["Stein"], ["Ivar"], 50)
        self.assertIsNone(bet)
        self.assertIn("al geplaatst", err)

    def test_completing_all_picks_pays_out_instantly(self):
        self._open_market(CHALLENGE_MARKET)
        bet, _ = services.place_challenge_bet(self.users["Stein"], ["Niels", "Ivar"], 50)

        # One of two picks complete -> still open.
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.OPEN)

        # Last pick complete -> won, paid instantly.
        services.declare_challenge("Ivar", Player.CHALLENGE_COMPLETED)
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.WON)
        self.assertEqual(bet.payout, round(50 * bet.odds))
        self.assertEqual(self.budget("Stein"), 950 + round(50 * bet.odds))

    def test_any_failed_pick_loses_the_parlay(self):
        self._open_market(CHALLENGE_MARKET)
        bet, _ = services.place_challenge_bet(self.users["Stein"], ["Niels", "Ivar"], 50)
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        services.declare_challenge("Ivar", Player.CHALLENGE_FAILED)
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.LOST)
        self.assertEqual(bet.payout, 0)
        self.assertEqual(self.budget("Stein"), 950)  # stake not returned

    def test_cannot_pick_an_already_decided_player(self):
        self._open_market(CHALLENGE_MARKET)
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        bet, err = services.place_challenge_bet(self.users["Stein"], ["Niels"], 50)
        self.assertIsNone(bet)
        self.assertIn("al beslist", err)

    def test_reset_clears_challenge_verdicts(self):
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        services.reset_game()
        self.assertEqual(
            Player.objects.get(user=self.users["Niels"]).challenge_status,
            Player.CHALLENGE_PENDING,
        )


class MinigameTest(TestCase):
    """Crash and roulette both charge the stake up front and settle instantly."""

    def setUp(self):
        self.user = User.objects.create(username="Stein")
        Player.objects.create(user=self.user, budget=1000, in_roster=True)
        self.admin = User.objects.create(username="James")

    def budget(self):
        return Player.objects.get(user=self.user).budget

    # --- Crash --------------------------------------------------------------

    def _age_round(self, seconds):
        """Backdate the player's live round so `seconds` appear to have passed."""
        round = CrashRound.objects.filter(player=self.user, active=True).latest("started_at")
        CrashRound.objects.filter(pk=round.pk).update(
            started_at=timezone.now() - timedelta(seconds=seconds)
        )
        return round

    def test_crash_start_charges_the_stake_and_opens_a_round(self):
        result, err = services.start_crash(self.user, 100)
        self.assertIsNone(err)
        self.assertEqual(result["active"], True)
        self.assertEqual(self.budget(), 900)  # stake gone up front
        self.assertTrue(CrashRound.objects.filter(player=self.user, active=True).exists())
        # The crash point rides back so the client can animate the crash.
        self.assertGreaterEqual(result["crash_point"], 1.0)

    def test_crash_cashout_before_the_crash_banks_the_multiplier(self):
        # A generous crash point (well above where we cash out) guarantees a win.
        with mock.patch("quiz.services.random.random", return_value=0.001):
            services.start_crash(self.user, 100)
        self._age_round(1.5)  # ~2× on the doubling-every-1.5s curve

        result, err = services.cashout_crash(self.user)
        self.assertIsNone(err)
        self.assertTrue(result["win"])
        self.assertGreaterEqual(result["multiplier"], 2.0)
        self.assertEqual(result["coins_won"], int(100 * result["multiplier"]))
        self.assertEqual(self.budget(), 900 + result["coins_won"])
        # Round is closed afterwards.
        self.assertFalse(CrashRound.objects.filter(player=self.user, active=True).exists())

    def test_crash_cashout_after_the_crash_busts(self):
        # random ~1 pushes the crash point down to an instant bust at 1.00×.
        with mock.patch("quiz.services.random.random", return_value=0.999):
            services.start_crash(self.user, 100)
        self._age_round(1.0)  # already past a 1.00× crash

        result, err = services.cashout_crash(self.user)
        self.assertIsNone(err)
        self.assertFalse(result["win"])
        self.assertEqual(result["coins_won"], 0)
        self.assertEqual(result["crash_point"], 1.0)
        self.assertEqual(self.budget(), 900)  # stake stays lost

    def test_crash_cashout_without_a_round_errors(self):
        result, err = services.cashout_crash(self.user)
        self.assertIsNone(result)
        self.assertIn("actieve ronde", err)

    def test_crash_starting_again_forfeits_the_open_round(self):
        services.start_crash(self.user, 100)
        services.start_crash(self.user, 50)
        self.assertEqual(
            CrashRound.objects.filter(player=self.user, active=True).count(), 1
        )
        self.assertEqual(self.budget(), 1000 - 100 - 50)  # both stakes charged

    def test_crash_rejects_bad_stake_and_admins(self):
        self.assertIsNone(services.start_crash(self.user, 33)[0])
        self.assertIsNone(services.start_crash(self.admin, 100)[0])
        self.assertEqual(self.budget(), 1000)

    # --- Roulette -----------------------------------------------------------

    def test_roulette_red_bet_pays_double_on_red(self):
        with mock.patch("quiz.services.random.randint", return_value=1):  # 1 is red
            result, err = services.play_roulette(self.user, 100, "red")
        self.assertIsNone(err)
        self.assertEqual(result["color"], "red")
        self.assertTrue(result["win"])
        self.assertEqual(result["coins_won"], 200)
        self.assertEqual(self.budget(), 1100)

    def test_roulette_zero_busts_even_money_bets(self):
        with mock.patch("quiz.services.random.randint", return_value=0):
            result, err = services.play_roulette(self.user, 100, "red")
        self.assertIsNone(err)
        self.assertEqual(result["color"], "green")
        self.assertFalse(result["win"])
        self.assertEqual(self.budget(), 900)

    def test_roulette_green_straight_pays_36x(self):
        with mock.patch("quiz.services.random.randint", return_value=0):
            result, err = services.play_roulette(self.user, 100, "green")
        self.assertIsNone(err)
        self.assertTrue(result["win"])
        self.assertEqual(result["coins_won"], 3600)
        self.assertEqual(self.budget(), 1000 - 100 + 3600)

    def test_roulette_rejects_unknown_bet(self):
        result, err = services.play_roulette(self.user, 100, "purple")
        self.assertIsNone(result)
        self.assertEqual(self.budget(), 1000)


class BonusScoringTest(TestCase):
    """A text_bonus question scores 2 (both correct), 1 (main only), or 0."""

    def setUp(self):
        self.users = {
            name: User.objects.create(username=name) for name in ("Both", "MainOnly", "Wrong")
        }
        for u in self.users.values():
            Score.objects.create(player=u, points=0)
        self.question = Question.objects.create(
            order=1, type=Question.TEXT_BONUS, text="Q", bonus_prompt="Bonus?"
        )
        self.game = GameState.get()
        self.game.current_index = 0
        self.game.entry_state = GameState.CLOSED
        self.game.save()

    def _points(self, name):
        return Score.objects.get(player=self.users[name]).points

    def test_bonus_awards_two_one_or_zero(self):
        Mark.objects.create(question=self.question, player=self.users["Both"], correct=True, bonus_correct=True)
        Mark.objects.create(question=self.question, player=self.users["MainOnly"], correct=True, bonus_correct=False)
        Mark.objects.create(question=self.question, player=self.users["Wrong"], correct=False, bonus_correct=True)

        services.finalize(self.game, self.question)

        self.assertEqual(self._points("Both"), 2)
        self.assertEqual(self._points("MainOnly"), 1)
        # A correct bonus never counts when the main answer is wrong.
        self.assertEqual(self._points("Wrong"), 0)


class ActivityFeedTest(TestCase):
    """Player actions log a line to the admin-only Activity feed."""

    def setUp(self):
        self.user = User.objects.create(username="Stein")
        Player.objects.create(user=self.user, budget=1000, in_roster=True)
        self.admin = User.objects.create(username="James")

    def test_minigame_logs_an_event_visible_to_admins_only(self):
        services.play_roulette(self.user, 100, "red")
        self.assertEqual(ActivityEvent.objects.count(), 1)

        event = ActivityEvent.objects.get()
        self.assertEqual(event.user, self.user)
        self.assertEqual(event.kind, ActivityEvent.MINIGAME)

        # The admin poll carries the feed; a player's does not.
        admin_state = services.build_state(self.admin)
        self.assertEqual(len(admin_state["activity"]), 1)
        self.assertEqual(admin_state["activity"][0]["username"], "Stein")

        player_state = services.build_state(self.user)
        self.assertEqual(player_state["activity"], [])

    def test_reset_clears_the_activity_feed(self):
        services.play_roulette(self.user, 50, "black")
        self.assertTrue(ActivityEvent.objects.exists())
        services.reset_game()
        self.assertFalse(ActivityEvent.objects.exists())
