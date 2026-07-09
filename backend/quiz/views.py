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

        from .models import Answer

        Answer.objects.update_or_create(
            question=question, player=request.user, defaults={"text": text}
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
        if username is None or correct is None:
            return Response(
                {"detail": "username en correct zijn verplicht."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        player = User.objects.filter(username=username).first()
        if player is None:
            return Response({"detail": "Onbekende speler."}, status=status.HTTP_404_NOT_FOUND)

        from .models import Mark

        Mark.objects.update_or_create(
            question=question, player=player, defaults={"correct": bool(correct)}
        )
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


class ChallengeDeclareView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        player, error = services.declare_challenge(
            request.data.get("username"), request.data.get("status")
        )
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(services.build_state(request.user))


class ResetView(APIView):
    permission_classes = [IsQuizAdmin]

    def post(self, request):
        services.reset_game()
        return Response(services.build_state(request.user))
