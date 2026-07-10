from django.contrib import admin
from django.urls import path, include
from django.db import connection
from django.http import JsonResponse


def health(_request):
    """Lightweight liveness probe. Runs a trivial query so an external uptime
    pinger (e.g. cron-job.org) keeps both Render and the Neon DB warm, avoiding
    cold-start latency on the first real page load."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        db_ok = True
    except Exception:
        db_ok = False
    return JsonResponse({"status": "ok", "db": db_ok})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("quiz.urls")),
]
