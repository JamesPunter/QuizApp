from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import JoinSerializer


class JoinView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = JoinSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        username = serializer.validated_data["username"]
        user, created = User.objects.get_or_create(username=username)
        token, _ = Token.objects.get_or_create(user=user)

        return Response(
            {
                "token": token.key,
                "username": user.username,
                "created": created,
            },
            status=status.HTTP_200_OK,
        )
