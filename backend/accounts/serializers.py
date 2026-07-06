from rest_framework import serializers


class JoinSerializer(serializers.Serializer):
    username = serializers.CharField(
        min_length=2,
        max_length=50,
        trim_whitespace=True,
    )
