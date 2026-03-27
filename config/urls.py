from django.urls import include, path

from apps.core.views import health


urlpatterns = [
    path("health", health),
    path("api/", include("apps.core.urls")),
]
