from django.urls import path
from .views import ClaimView, ReleaseView, RosterView

urlpatterns = [
    path("claim/", ClaimView.as_view(), name="claim"),
    path("roster/", RosterView.as_view(), name="roster"),
    path("release/", ReleaseView.as_view(), name="release"),
]
