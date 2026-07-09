from django.urls import path

from . import views

urlpatterns = [
    # Player-facing
    path("game/state/", views.GameStateView.as_view(), name="game-state"),
    path("game/answer/", views.SubmitAnswerView.as_view(), name="game-answer"),
    path("bets/", views.PlaceBetView.as_view(), name="place-bet"),
    # Admin-facing (finn / james only)
    path("admin/advance/", views.AdvanceView.as_view(), name="admin-advance"),
    path("admin/close/", views.CloseEntryView.as_view(), name="admin-close"),
    path("admin/mark/", views.MarkView.as_view(), name="admin-mark"),
    path("admin/finalize/", views.FinalizeView.as_view(), name="admin-finalize"),
    path("admin/scores-visible/", views.ScoresVisibleView.as_view(), name="admin-scores-visible"),
    path("admin/market/", views.MarketView.as_view(), name="admin-market"),
    path("admin/settle/", views.SettleView.as_view(), name="admin-settle"),
    path("admin/challenge/", views.ChallengeDeclareView.as_view(), name="admin-challenge"),
    path("admin/reset/", views.ResetView.as_view(), name="admin-reset"),
]
