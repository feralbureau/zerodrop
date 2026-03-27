from django.urls import path

from . import views


urlpatterns = [
    path("setup", views.setup),
    path("origin", views.update_origin),
    path("key/regenerate", views.regenerate_key),
    path("reset", views.reset_system),
    path("key/validate", views.validate_key),
    path("domains", views.domains),
    path("domains/<str:domain>", views.delete_domain),
    path("check", views.check_request),
    path("unban", views.unban_ip),
    path("blacklist/add", views.add_blacklist),
    path("ban/extend", views.extend_ban),
    path("logs", views.list_logs),
    path("rpm", views.get_rpm),
    path("anomalies", views.get_anomalies),
    path("blacklist", views.list_blacklist),
    path("settings", views.settings_view),
    path("uptime", views.uptime_view),
    path("uptime/<uuid:monitor_id>", views.delete_uptime),
    path("allowlist", views.allowlist_view),
    path("allowlist/remove", views.remove_allowlist),
    path("denylist", views.denylist_view),
    path("denylist/remove", views.remove_denylist),
]
