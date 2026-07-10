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
    SLOT_JACKPOT_MULTIPLIER,
    SLOT_SHOT,
    ActivityEvent,
    Bet,
    BudgetSnapshot,
    CrashRound,
    GameState,
    Mark,
    Market,
    Player,
    Question,
    RankReward,
    Score,
    ScoreSnapshot,
    SlotDrink,
    individual_bet_by_key,
    rank_coin_rewards,
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

    def test_completing_a_challenge_pays_the_player_the_reward(self):
        from .models import CHALLENGE_COMPLETION_REWARD

        before = self.budget("Niels")
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        self.assertEqual(self.budget("Niels"), before + CHALLENGE_COMPLETION_REWARD)
        self.assertTrue(
            Player.objects.get(user=self.users["Niels"]).challenge_reward_paid
        )

    def test_challenge_reward_is_paid_only_once_when_re_toggled(self):
        from .models import CHALLENGE_COMPLETION_REWARD

        before = self.budget("Niels")
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        # Admin corrects to pending, then re-approves — still one payout.
        services.declare_challenge("Niels", Player.CHALLENGE_PENDING)
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        self.assertEqual(self.budget("Niels"), before + CHALLENGE_COMPLETION_REWARD)

    def test_failed_challenge_pays_no_reward(self):
        before = self.budget("Niels")
        services.declare_challenge("Niels", Player.CHALLENGE_FAILED)
        self.assertEqual(self.budget("Niels"), before)
        self.assertFalse(
            Player.objects.get(user=self.users["Niels"]).challenge_reward_paid
        )

    def test_batch_save_pays_the_completion_reward(self):
        from .models import CHALLENGE_COMPLETION_REWARD

        before = self.budget("Niels")
        services.save_challenge_statuses({"Niels": Player.CHALLENGE_COMPLETED})
        self.assertEqual(self.budget("Niels"), before + CHALLENGE_COMPLETION_REWARD)
        # A second identical save must not pay again.
        services.save_challenge_statuses({"Niels": Player.CHALLENGE_COMPLETED})
        self.assertEqual(self.budget("Niels"), before + CHALLENGE_COMPLETION_REWARD)

    def test_save_statuses_persists_batch_and_settles_once(self):
        self._open_market(CHALLENGE_MARKET)
        bet, _ = services.place_challenge_bet(self.users["Stein"], ["Niels", "Ivar"], 50)
        # The panel posts the whole cast at once, including players who never
        # logged in (no account row) and stay pending — this must not error.
        _, err = services.save_challenge_statuses(
            {
                "Niels": Player.CHALLENGE_COMPLETED,
                "Ivar": Player.CHALLENGE_COMPLETED,
                "Max": Player.CHALLENGE_PENDING,  # no User row exists
            }
        )
        self.assertIsNone(err)
        self.assertEqual(
            Player.objects.get(user=self.users["Ivar"]).challenge_status,
            Player.CHALLENGE_COMPLETED,
        )
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.WON)

    def test_save_statuses_materialises_account_for_absent_player(self):
        # A real verdict on a cast member who hasn't logged in creates their
        # account+player row so the verdict (and any bet on them) can settle.
        self.assertFalse(User.objects.filter(username="Max").exists())
        _, err = services.save_challenge_statuses({"Max": Player.CHALLENGE_COMPLETED})
        self.assertIsNone(err)
        self.assertEqual(
            Player.objects.get(user__username="Max").challenge_status,
            Player.CHALLENGE_COMPLETED,
        )

    def test_save_statuses_can_revert_to_pending(self):
        services.declare_challenge("Niels", Player.CHALLENGE_COMPLETED)
        _, err = services.save_challenge_statuses({"Niels": Player.CHALLENGE_PENDING})
        self.assertIsNone(err)
        self.assertEqual(
            Player.objects.get(user=self.users["Niels"]).challenge_status,
            Player.CHALLENGE_PENDING,
        )

    def test_save_statuses_rejects_bad_payload_without_writing(self):
        _, err = services.save_challenge_statuses({"Niels": "bogus"})
        self.assertIsNotNone(err)
        self.assertEqual(
            Player.objects.get(user=self.users["Niels"]).challenge_status,
            Player.CHALLENGE_PENDING,
        )


class IndividualBetsTest(TestCase):
    """The eight yes/no "betjes": odds that double over the quiz, yes/no
    settlement, and unlimited re-betting on one market."""

    def setUp(self):
        self.users = {}
        for name in ("Stein", "Niels", "Ivar"):
            user = User.objects.create(username=name)
            Player.objects.create(user=user, budget=1000, in_roster=True)
            self.users[name] = user
        self.admin = User.objects.create(username="James")
        # Five questions, so the final question is index 4.
        for i in range(1, 6):
            Question.objects.create(order=i, type=Question.TEXT, text=f"Q{i}")

    def budget(self, name):
        return Player.objects.get(user=self.users[name]).budget

    def _set_index(self, idx):
        game = GameState.get()
        game.current_index = idx
        game.entry_state = GameState.OPEN
        game.save()

    def test_multiplier_rises_from_one_to_two(self):
        self._set_index(-1)  # not started
        self.assertEqual(services.individual_bet_multiplier(), 1.0)
        self._set_index(0)  # first question
        self.assertEqual(services.individual_bet_multiplier(), 1.0)
        self._set_index(2)  # halfway (index 2 of 0..4)
        self.assertEqual(services.individual_bet_multiplier(), 1.5)
        self._set_index(4)  # final question
        self.assertEqual(services.individual_bet_multiplier(), 2.0)

    def test_odds_double_by_the_final_question(self):
        cfg = individual_bet_by_key("ind_stein")  # initial odds 2×
        self._set_index(0)
        self.assertEqual(services.individual_bet_odds(cfg), 2.0)
        self._set_index(4)
        self.assertEqual(services.individual_bet_odds(cfg), 4.0)

    def test_bet_locks_the_odds_at_placement(self):
        self._set_index(0)
        Market.objects.create(key="ind_stein", is_open=True)
        bet, err = services.place_bet(self.users["Niels"], "ind_stein", "Stein", 100)
        self.assertIsNone(err)
        self.assertEqual(bet.odds, 2.0)  # placed early, low odds
        self.assertEqual(self.budget("Niels"), 900)

    def test_bet_requires_the_subject_as_selection(self):
        self._set_index(0)
        Market.objects.create(key="ind_stein", is_open=True)
        bet, err = services.place_bet(self.users["Niels"], "ind_stein", "Niels", 100)
        self.assertIsNone(bet)
        self.assertIn("Ongeldige keuze", err)

    def test_settle_yes_pays_the_backers(self):
        self._set_index(4)
        Market.objects.create(key="ind_stein", is_open=True)
        odds = services.individual_bet_odds(individual_bet_by_key("ind_stein"))
        bet, _ = services.place_bet(self.users["Niels"], "ind_stein", "Stein", 100)
        result = services.settle_market("ind_stein", True)
        self.assertEqual(result["winners"], ["Stein"])
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.WON)
        self.assertEqual(bet.payout, round(100 * odds))
        self.assertEqual(self.budget("Niels"), 900 + round(100 * odds))

    def test_settle_no_loses_the_backers(self):
        self._set_index(0)
        Market.objects.create(key="ind_stein", is_open=True)
        bet, _ = services.place_bet(self.users["Niels"], "ind_stein", "Stein", 100)
        result = services.settle_market("ind_stein", False)
        self.assertEqual(result["winners"], [])
        bet.refresh_from_db()
        self.assertEqual(bet.status, Bet.LOST)
        self.assertEqual(bet.payout, 0)
        self.assertEqual(self.budget("Niels"), 900)  # stake stays lost

    def test_multiple_bets_allowed_on_one_market(self):
        self._set_index(0)
        Market.objects.create(key="ind_stein", is_open=True)
        services.place_bet(self.users["Niels"], "ind_stein", "Stein", 100)
        bet2, err = services.place_bet(self.users["Niels"], "ind_stein", "Stein", 50)
        self.assertIsNone(err)
        self.assertIsNotNone(bet2)
        self.assertEqual(
            Bet.objects.filter(bettor=self.users["Niels"], market="ind_stein").count(), 2
        )

    def test_state_lists_all_eight_markets(self):
        state = services.build_state(self.admin)
        markets = state["individual_bets"]["markets"]
        self.assertEqual(len(markets), 8)
        self.assertIn("ind_tris", {m["key"] for m in markets})
        # Every subject is a real cast member.
        for m in markets:
            self.assertIn(m["subject"], services.roster_usernames())

    def test_reset_clears_individual_bets_and_markets(self):
        self._set_index(0)
        Market.objects.create(key="ind_stein", is_open=True)
        services.place_bet(self.users["Niels"], "ind_stein", "Stein", 100)
        services.reset_game()
        self.assertFalse(Bet.objects.filter(market="ind_stein").exists())
        self.assertFalse(Market.objects.get(key="ind_stein").is_open)


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


class SlotDrinkTest(TestCase):
    """Landing three drink symbols on the slot files a drink for the quizmaster
    to confirm and locks the player's machine until they do."""

    def setUp(self):
        self.user = User.objects.create(username="Stein")
        Player.objects.create(user=self.user, budget=1000, in_roster=True)
        self.admin = User.objects.create(username="James")

    def _spin_shot(self):
        # Miss the jackpot roll (first random() above its threshold), then force
        # an ordinary win (second random() below the win threshold) landing on the
        # shot symbol (random.choice returns it), so all three reels are shots.
        with mock.patch(
            "quiz.services.random.random", side_effect=[0.99, 0.0]
        ), mock.patch("quiz.services.random.choice", return_value=SLOT_SHOT):
            return services.spin_slot(self.user, 100)

    def test_jackpot_pays_a_multiple_of_the_stake(self):
        # The first random() lands inside the jackpot band, so the spin is a
        # jackpot: it pays SLOT_JACKPOT_MULTIPLIER * stake minus the stake. The
        # prize scales with the stake so the house edge is equal at every tier.
        budget_before = Player.objects.get(user=self.user).budget
        with mock.patch("quiz.services.random.random", return_value=0.0):
            result, err = services.spin_slot(self.user, 100)
        expected_win = 100 * SLOT_JACKPOT_MULTIPLIER
        self.assertIsNone(err)
        self.assertTrue(result["win"])
        self.assertEqual(result["symbol"], "jackpot")
        self.assertEqual(result["reels"], ["jackpot", "jackpot", "jackpot"])
        self.assertEqual(result["coins_won"], expected_win)
        self.assertEqual(
            Player.objects.get(user=self.user).budget,
            budget_before + expected_win - 100,
        )
        # A jackpot is a coin prize, not a drink — nothing to confirm.
        self.assertFalse(SlotDrink.objects.filter(player=self.user).exists())

    def test_three_drinks_files_a_pending_drink_and_locks_further_spins(self):
        result, err = self._spin_shot()
        self.assertIsNone(err)
        self.assertTrue(result["win"])
        self.assertEqual(result["symbol"], "shot")
        self.assertEqual(
            SlotDrink.objects.filter(player=self.user, status=SlotDrink.PENDING).count(), 1
        )

        # The machine is now locked: a second spin is rejected and no stake moves.
        budget_before = Player.objects.get(user=self.user).budget
        result2, err2 = services.spin_slot(self.user, 100)
        self.assertIsNone(result2)
        self.assertIn("beheerder", err2)
        self.assertEqual(Player.objects.get(user=self.user).budget, budget_before)

    def test_admin_confirming_the_drink_unlocks_the_machine(self):
        self._spin_shot()
        drink = SlotDrink.objects.get()

        _, err = services.confirm_slot_drink(drink.id)
        self.assertIsNone(err)
        drink.refresh_from_db()
        self.assertEqual(drink.status, SlotDrink.CONFIRMED)

        # Spinning works again once confirmed (result depends on the real RNG,
        # but it's no longer blocked by the lock).
        _, err2 = services.spin_slot(self.user, 100)
        self.assertIsNone(err2)

    def test_confirming_an_already_confirmed_drink_is_rejected(self):
        self._spin_shot()
        drink = SlotDrink.objects.get()
        services.confirm_slot_drink(drink.id)
        _, err = services.confirm_slot_drink(drink.id)
        self.assertIsNotNone(err)

    def test_pending_drink_shows_for_admins_and_locks_the_player_state(self):
        self._spin_shot()

        admin_state = services.build_state(self.admin)
        self.assertEqual(len(admin_state["pending_slot_drinks"]), 1)
        self.assertEqual(admin_state["pending_slot_drinks"][0]["username"], "Stein")
        self.assertEqual(admin_state["pending_slot_drinks"][0]["kind"], "shot")

        player_state = services.build_state(self.user)
        self.assertEqual(player_state["you"]["slot_lock"], {"kind": "shot"})
        # Players never see the admin queue.
        self.assertEqual(player_state["pending_slot_drinks"], [])

    def test_reset_clears_pending_drinks(self):
        self._spin_shot()
        self.assertTrue(SlotDrink.objects.exists())
        services.reset_game()
        self.assertFalse(SlotDrink.objects.exists())


class RankRewardTest(TestCase):
    """At the end of the quiz every player is paid (or docked) coins by their
    finishing position in the score ranking."""

    def setUp(self):
        # The full eight-strong cast with distinct, descending scores, so the
        # ranking maps cleanly onto the fixed 1..8 reward table.
        self.users = {}
        for name, points in [
            ("Niels", 8), ("Stein", 7), ("Ivar", 6), ("Matta", 5),
            ("Levi", 4), ("Sep", 3), ("Max", 2), ("Tris", 1),
        ]:
            user = User.objects.create(username=name)
            Player.objects.create(user=user, budget=1000, in_roster=True)
            Score.objects.create(player=user, points=points)
            self.users[name] = user

    def budget(self, name):
        return Player.objects.get(user=self.users[name]).budget

    def test_schedule_is_the_fixed_table(self):
        self.assertEqual(
            rank_coin_rewards(8), [1000, 750, 500, 200, 100, 0, -250, -500]
        )
        # Fewer players take the top of the table.
        self.assertEqual(rank_coin_rewards(3), [1000, 750, 500])

    def test_award_pays_each_player_by_position(self):
        services.award_rank_coins()
        rewards = rank_coin_rewards(8)
        for i, name in enumerate(
            ["Niels", "Stein", "Ivar", "Matta", "Levi", "Sep", "Max", "Tris"]
        ):
            self.assertEqual(self.budget(name), 1000 + rewards[i])
        # A RankReward row is recorded per player, ranked 1..8.
        self.assertEqual(RankReward.objects.count(), 8)
        self.assertEqual(RankReward.objects.get(player=self.users["Niels"]).rank, 1)
        self.assertEqual(RankReward.objects.get(player=self.users["Tris"]).rank, 8)

    def test_award_is_idempotent(self):
        services.award_rank_coins()
        first = self.budget("Niels")
        services.award_rank_coins()  # second call must be a no-op
        self.assertEqual(self.budget("Niels"), first)
        self.assertEqual(RankReward.objects.count(), 8)

    def test_tied_players_split_their_positions_rewards(self):
        # Put Stein level with Niels at the top: they tie for 1st, sharing the
        # 1st- and 2nd-place amounts evenly.
        Score.objects.filter(player=self.users["Stein"]).update(points=8)
        schedule = rank_coin_rewards(8)
        share = round((schedule[0] + schedule[1]) / 2)
        services.award_rank_coins()
        self.assertEqual(self.budget("Niels"), 1000 + share)
        self.assertEqual(self.budget("Stein"), 1000 + share)
        # Both are recorded at the shared top position.
        self.assertEqual(RankReward.objects.get(player=self.users["Niels"]).rank, 1)
        self.assertEqual(RankReward.objects.get(player=self.users["Stein"]).rank, 1)

    def test_docking_last_place_never_goes_below_zero(self):
        Player.objects.filter(user=self.users["Tris"]).update(budget=100)
        services.award_rank_coins()  # last place is docked 500, floored at 0
        self.assertEqual(self.budget("Tris"), 0)

    def test_finalizing_the_last_question_does_not_auto_pay_out(self):
        # Scoring the final question no longer pays out on its own — the payout is
        # the admin's separate "Uitbetalen" button (award_rank_coins).
        question = Question.objects.create(order=1, type=Question.TEXT, text="Q")
        game = GameState.get()
        game.current_index = 0
        game.entry_state = GameState.CLOSED
        game.save()
        Mark.objects.create(question=question, player=self.users["Niels"], correct=True)

        services.finalize(game, question)

        game.refresh_from_db()
        self.assertFalse(game.rank_coins_awarded)
        self.assertEqual(RankReward.objects.count(), 0)

    def test_preview_matches_the_eventual_payout(self):
        preview = services.rank_reward_map(services.current_scores())
        services.award_rank_coins()
        for name, coins in preview.items():
            self.assertEqual(
                RankReward.objects.get(player=self.users[name]).coins, coins
            )

    def test_results_published_only_after_all_three_payouts(self):
        admin = User.objects.create(username="James")
        self.assertFalse(services.build_state(admin)["results_published"])

        # Two of three: both outcome markets settled, rank coins not yet paid.
        Market.objects.create(key=QUIZ_WINNER_MARKET, is_open=True)
        Market.objects.create(key=QUIZ_LOSER_MARKET, is_open=True)
        services.settle_market(QUIZ_WINNER_MARKET)
        services.settle_market(QUIZ_LOSER_MARKET)
        self.assertFalse(services.build_state(admin)["results_published"])

        # The third payout publishes the standings.
        services.award_rank_coins()
        self.assertTrue(services.build_state(admin)["results_published"])

    def test_reset_clears_rank_rewards_and_the_flag(self):
        services.award_rank_coins()
        self.assertTrue(RankReward.objects.exists())
        services.reset_game()
        self.assertFalse(RankReward.objects.exists())
        self.assertFalse(GameState.get().rank_coins_awarded)


class BudgetSnapshotTest(TestCase):
    """Opening a round records everyone's coins entering it, once, for the
    Tussenstand budget-over-rounds graph."""

    def setUp(self):
        self.user = User.objects.create(username="Stein")
        self.player = Player.objects.create(user=self.user, budget=1000, in_roster=True)

    def test_opening_a_round_snapshots_current_budgets_once(self):
        services.snapshot_round_budgets(0)
        self.assertEqual(BudgetSnapshot.objects.count(), 1)
        snap = BudgetSnapshot.objects.get()
        # Full cast is present at the starting budget.
        self.assertEqual(snap.budgets["Stein"], 1000)
        self.assertIn("Niels", snap.budgets)

        # Spend some coins, then re-open the same round: the start-of-round figure
        # is frozen, not overwritten.
        self.player.budget = 700
        self.player.save(update_fields=["budget"])
        services.snapshot_round_budgets(0)
        self.assertEqual(BudgetSnapshot.objects.count(), 1)
        self.assertEqual(BudgetSnapshot.objects.get().budgets["Stein"], 1000)

    def test_each_round_captures_the_budget_at_its_start(self):
        services.snapshot_round_budgets(0)  # start of round 1: 1000
        self.player.budget = 800
        self.player.save(update_fields=["budget"])
        services.snapshot_round_budgets(1)  # start of round 2: 800

        history = services.build_state(self.user)["budget_history"]
        self.assertEqual([h["round"] for h in history], [1, 2])
        self.assertEqual(history[0]["budgets"]["Stein"], 1000)
        self.assertEqual(history[1]["budgets"]["Stein"], 800)

    def test_reset_clears_budget_snapshots(self):
        services.snapshot_round_budgets(0)
        self.assertTrue(BudgetSnapshot.objects.exists())
        services.reset_game()
        self.assertFalse(BudgetSnapshot.objects.exists())
