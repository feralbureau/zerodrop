from django.urls import re_path

from apps.monitoring.consumers import LogsConsumer, PingConsumer, UptimeConsumer


websocket_urlpatterns = [
    re_path(r"^api/ws/logs/?$", LogsConsumer.as_asgi()),
    re_path(r"^api/ws/ping/?$", PingConsumer.as_asgi()),
    re_path(r"^api/ws/uptime/?$", UptimeConsumer.as_asgi()),
]
