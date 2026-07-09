"""Unit tests for the betting markets, run against an isolated test DB:

    venv/Scripts/python.exe manage.py test quiz

These cover the two markets added on top of "Wie wint de quiz?":
  - quiz_loser  ("Wie wordt laatste?") — inverse of the winner market.
  - challenge   ("Wie haalt zijn challenge?") — the per-bettor parlay.
"""

from django.contrib.auth.models import User
from django.test import TestCase

from . import services
from .models import (
    CHALLENGE_MARKET,
    QUIZ_LOSER_MARKET,
    QUIZ_WINNER_MARKET,
    Bet,
    Market,
    Player,
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
