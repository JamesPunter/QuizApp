from django.urls import path

from . import views

urlpatterns = [
    # Player-facing
    path("game/state/", views.GameStateView.as_view(), name="game-state"),
    path("game/answer/", views.SubmitAnswerView.as_view(), name="game-answer"),
    path("bets/", views.PlaceBetView.as_view(), name="place-bet"),
    path("minigames/slot/", views.SlotSpinView.as_view(), name="minigame-slot"),
    path("minigames/crash/start/", views.CrashStartView.as_view(), name="minigame-crash-start"),
    path("minigames/crash/cashout/", views.CrashCashoutView.as_view(), name="minigame-crash-cashout"),
    path("minigames/roulette/", views.RoulettePlayView.as_view(), name="minigame-roulette"),
    path("store/buy-coins/", views.BuyCoinsView.as_view(), name="store-buy-coins"),
    path("store/gift/", views.GiveDrinkView.as_view(), name="store-gift"),
    path("store/gift/ack/", views.AckGiftView.as_view(), name="store-gift-ack"),
    # Admin-facing (finn / james only)
    path("admin/advance/", views.AdvanceView.as_view(), name="admin-advance"),
    path("admin/close/", views.CloseEntryView.as_view(), name="admin-close"),
    path("admin/mark/", views.MarkView.as_view(), name="admin-mark"),
    path("admin/finalize/", views.FinalizeView.as_view(), name="admin-finalize"),
    path("admin/scores-visible/", views.ScoresVisibleView.as_view(), name="admin-scores-visible"),
    path("admin/store-open/", views.StoreOpenView.as_view(), name="admin-store-open"),
    path("admin/minigames-open/", views.MinigamesOpenView.as_view(), name="admin-minigames-open"),
    path("admin/market/", views.MarketView.as_view(), name="admin-market"),
    path("admin/settle/", views.SettleView.as_view(), name="admin-settle"),
    path("admin/payout/", views.PayoutView.as_view(), name="admin-payout"),
    path("admin/challenge/", views.ChallengeDeclareView.as_view(), name="admin-challenge"),
    path("admin/challenge/save/", views.ChallengeSaveView.as_view(), name="admin-challenge-save"),
    path("admin/confirm-purchase/", views.ConfirmPurchaseView.as_view(), name="admin-confirm-purchase"),
    path("admin/confirm-slot-drink/", views.ConfirmSlotDrinkView.as_view(), name="admin-confirm-slot-drink"),
    path("admin/reset/", views.ResetView.as_view(), name="admin-reset"),
]
