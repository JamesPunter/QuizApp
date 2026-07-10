from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import (
    CHALLENGE_MARKET,
    QUIZ_WINNER_MARKET,
    GameState,
    Market,
    Question,
    is_admin_username,
)
from .permissions import IsQuizAdmin


def _current_question():
    game = GameState.get()
    questions = list(Question.objects.all())
    if 0 <= game.current_index < len(questions):
        return game, questions[game.current_index]
    return game, None


# --- Player-facing -----------------------------------------------------------


class GameStateView(APIView):
    """The polling endpoint. Every device hits this on a timer."""

    def get(self, request):
        return Response(services.build_state(request.user))


class SubmitAnswerView(APIView):
    def post(self, request):
        if is_admin_username(request.user.username):
            return Response({"detail": "Beheerders dienen geen antwoorden in."}, status=status.HTTP_400_BAD_REQUEST)

        game, question = _current_question()
        if question is None:
            return Response({"detail": "Geen actieve vraag."}, status=status.HTTP_400_BAD_REQUEST)
        if game.entry_state != GameState.OPEN:
            return Response({"detail": "Inzenden is niet open."}, status=status.HTTP_400_BAD_REQUEST)

        text = (request.data.get("answer") or "").strip()
        if not text:
            return Response({"detail": "Antwoord is verplicht."}, status=status.HTTP_400_BAD_REQUEST)

        # text_bonus questions carry a second, optional answer.
        bonus_text = (request.data.get("bonus") or "").strip()

        from .models import Answer

        Answer.objects.update_or_create(
            question=question,
            player=request.user,
            defaults={"text": text, "bonus_text": bonus_text},
        )
        return Response(services.build_state(request.user))


class PlaceBetView(APIView):
    def post(self, request):
        market = request.data.get("market")
        if market == CHALLENGE_MARKET:
            bet, error = services.place_challenge_bet(
                request.user,
                request.data.get("selections"),
                request.data.get("amount"),
            )
        else:
            bet, error = services.place_bet(
                request.user,
                market,
                request.data.get("selection"),
                request.data.get("amount"),
            )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class SlotSpinView(APIView):
    """Minigame: one slot-machine spin. Returns the fresh state plus a `spin`
    field carrying the reels + reward so the client can animate the result."""

    def post(self, request):
        result, error = services.spin_slot(request.user, request.data.get("cost"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        state = services.build_state(request.user)
        state["spin"] = result
        return Response(state)


class CrashStartView(APIView):
    """Minigame: begin a live crash round. Charges the stake and opens a round;
    the response carries no crash point, so the client animates the climb blind
    and the player taps CrashCashoutView to bank it."""

    def post(self, request):
        result, error = services.start_crash(request.user, request.data.get("cost"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        state = services.build_state(request.user)
        state["crash"] = result
        return Response(state)


class CrashCashoutView(APIView):
    """Minigame: cash out the player's live crash round. Settled server-side on
    the elapsed-time multiplier; the response's `crash` field reveals the
    outcome (win + multiplier, or bust + crash point)."""

    def post(self, request):
        result, error = services.cashout_crash(request.user)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        state = services.build_state(request.user)
        state["crash"] = result
        return Response(state)


class RoulettePlayView(APIView):
    """Minigame: one roulette spin. Returns the fresh state plus a `roulette`
    field carrying the landed number + colour so the client can animate it."""

    def post(self, request):
        result, error = services.play_roulette(
            request.user, request.data.get("cost"), request.data.get("bet")
        )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        state = services.build_state(request.user)
        state["roulette"] = result
        return Response(state)


class BuyCoinsView(APIView):
    """Store: file a pending coin pack (paid via Tikkie, confirmed by an admin)."""

    def post(self, request):
        _, error = services.request_coin_purchase(request.user)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class GiveDrinkView(APIView):
    """Store: spend coins to make another contestant drink."""

    def post(self, request):
        _, error = services.give_drink(
            request.user, request.data.get("kind"), request.data.get("recipient")
        )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class AckGiftView(APIView):
    """Store: dismiss one of my drink notifications."""

    def post(self, request):
        _, error = services.acknowledge_gift(request.user, request.data.get("id"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


# --- Admin-facing ------------------------------------------------------------


class AdvanceView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        try:
            index = int(request.data.get("index"))
        except (TypeError, ValueError):
            return Response({"detail": "index is verplicht."}, status=status.HTTP_400_BAD_REQUEST)

        total = Question.objects.count()
        if not (0 <= index < total):
            return Response({"detail": "index buiten bereik."}, status=status.HTTP_400_BAD_REQUEST)

        game = GameState.get()
        game.current_index = index
        game.entry_state = GameState.OPEN
        game.save(update_fields=["current_index", "entry_state"])
        # Record everyone's coins entering this round (once) for the budget graph.
        services.snapshot_round_budgets(index)
        return Response(services.build_state(request.user))


class CloseEntryView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        game, question = _current_question()
        if question is None:
            return Response({"detail": "Geen actieve vraag."}, status=status.HTTP_400_BAD_REQUEST)
        game.entry_state = GameState.CLOSED
        game.save(update_fields=["entry_state"])
        return Response(services.build_state(request.user))


class MarkView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        game, question = _current_question()
        if question is None:
            return Response({"detail": "Geen actieve vraag."}, status=status.HTTP_400_BAD_REQUEST)

        username = request.data.get("username")
        correct = request.data.get("correct")
        # `bonus` marks the bonus answer of a text_bonus question; it is set
        # independently of the main mark, so at least one of the two is required.
        has_bonus = "bonus" in request.data
        bonus = request.data.get("bonus")
        if username is None or (correct is None and not has_bonus):
            return Response(
                {"detail": "username en correct/bonus zijn verplicht."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        player = User.objects.filter(username=username).first()
        if player is None:
            return Response({"detail": "Onbekende speler."}, status=status.HTTP_404_NOT_FOUND)

        from .models import Mark

        # Update only the provided field(s) so marking the bonus doesn't clobber
        # the main mark (and vice versa). A brand-new row needs a main verdict,
        # so default it to False until the admin sets it.
        mark, _ = Mark.objects.get_or_create(
            question=question, player=player, defaults={"correct": False}
        )
        if correct is not None:
            mark.correct = bool(correct)
        if has_bonus:
            mark.bonus_correct = None if bonus is None else bool(bonus)
        mark.save(update_fields=["correct", "bonus_correct"])
        return Response(services.build_state(request.user))


class FinalizeView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        game, question = _current_question()
        if question is None:
            return Response({"detail": "Geen actieve vraag."}, status=status.HTTP_400_BAD_REQUEST)
        services.finalize(game, question)
        return Response(services.build_state(request.user))


class ScoresVisibleView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        game = GameState.get()
        game.scores_visible = bool(request.data.get("visible"))
        game.save(update_fields=["scores_visible"])
        return Response(services.build_state(request.user))


class MarketView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        key = request.data.get("key")
        if not key:
            return Response({"detail": "key is verplicht."}, status=status.HTTP_400_BAD_REQUEST)

        market, _ = Market.objects.get_or_create(key=key)
        if market.is_settled:
            return Response(
                {"detail": "Deze markt is afgerekend."}, status=status.HTTP_400_BAD_REQUEST
            )
        market.is_open = bool(request.data.get("open"))
        market.save(update_fields=["is_open"])
        return Response(services.build_state(request.user))


class SettleView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        # Backwards-compatible: no key settles the quiz-winner market.
        key = request.data.get("key") or QUIZ_WINNER_MARKET
        result = services.settle_market(key)
        state = services.build_state(request.user)
        state["settlement"] = result
        return Response(state)


class PayoutView(APIView):
    """Admin: the third end-of-quiz payout — hand out the coins each player has
    earned for their finishing position in the score ranking (last place is
    docked). Idempotent; once this and both outcome markets are settled the
    final scores + budgets are published to every player."""

    permission_classes = [IsQuizAdmin]

    def post(self, request):
        services.award_rank_coins()
        return Response(services.build_state(request.user))


class ChallengeDeclareView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        player, error = services.declare_challenge(
            request.data.get("username"), request.data.get("status")
        )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class ChallengeSaveView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        _, error = services.save_challenge_statuses(request.data.get("statuses"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class ConfirmPurchaseView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        _, error = services.confirm_coin_purchase(request.data.get("id"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class ConfirmSlotDrinkView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        _, error = services.confirm_slot_drink(request.data.get("id"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class ResetView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        services.reset_game()
        return Response(services.build_state(request.user))
