from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from quiz import services
from quiz.models import (
    ADMIN_USERNAMES_DISPLAY,
    PLAYER_USERNAMES,
    check_contestant_password,
    is_admin_username,
    resolve_contestant,
)


class RosterView(APIView):
    """Public: the fixed cast plus who's currently claimed, so the login picker
    can grey out names that are already taken on another device."""

    permission_classes = [AllowAny]

    def get(self, request):
        present = set(services.present_usernames())

        def entry(name):
            return {"name": name, "taken": name in present}

        return Response(
            {
                "players": [entry(n) for n in PLAYER_USERNAMES],
                "admins": [entry(n) for n in ADMIN_USERNAMES_DISPLAY],
            }
        )


class ClaimView(APIView):
    """Claim a contestant name with its account password. Rejected on a wrong
    password, or if that name is already live on another device (one name = one
    device)."""

    permission_classes = [AllowAny]

    def post(self, request):
        canonical = resolve_contestant(request.data.get("name"))
        if canonical is None:
            return Response(
                {"detail": "Onbekende deelnemer."}, status=status.HTTP_400_BAD_REQUEST
            )

        if not check_contestant_password(canonical, request.data.get("password") or ""):
            return Response(
                {"detail": "Onjuist wachtwoord."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user, _ = User.objects.get_or_create(username=canonical)
        if services.is_present(user):
            return Response(
                {"detail": f"{canonical} is al ingelogd op een ander apparaat."},
                status=status.HTTP_409_CONFLICT,
            )

        token, _ = Token.objects.get_or_create(user=user)
        services.register_player(user)
        services.touch_presence(user)

        return Response(
            {
                "token": token.key,
                "username": canonical,
                "is_admin": is_admin_username(canonical),
            },
            status=status.HTTP_200_OK,
        )


class ReleaseView(APIView):
    """Free the caller's name immediately on logout (otherwise it frees itself
    once the poll heartbeat lapses)."""

    def post(self, request):
        services.release_presence(request.user)
        return Response({"released": True}, status=status.HTTP_200_OK)
