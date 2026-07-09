from rest_framework.permissions import BasePermission

from .models import is_admin_username


class IsQuizAdmin(BasePermission):
    """Only the quiz admins (finn / james) may drive the quiz."""

    message = "Admin access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and is_admin_username(user.username))
