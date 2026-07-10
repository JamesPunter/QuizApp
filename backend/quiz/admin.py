from django.contrib import admin

from .models import (
    Answer,
    Bet,
    BudgetSnapshot,
    GameState,
    Mark,
    Market,
    Player,
    Question,
    Score,
    ScoreSnapshot,
)

admin.site.register(Question)
admin.site.register(GameState)
admin.site.register(Answer)
admin.site.register(Mark)
admin.site.register(Score)
admin.site.register(ScoreSnapshot)
admin.site.register(BudgetSnapshot)
admin.site.register(Player)
admin.site.register(Market)
admin.site.register(Bet)
