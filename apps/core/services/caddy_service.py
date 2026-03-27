from __future__ import annotations

from urllib.parse import urlparse

import httpx
from django.conf import settings

from apps.core.models import ProtectedDomain


def list_domains() -> list[dict[str, str]]:
    return [
        {"domain": item.domain, "origin": item.origin}
        for item in ProtectedDomain.objects.filter(is_active=True).order_by("domain")
    ]


def build_caddy_config(api_key: str | None, domains: list[dict[str, str]]) -> str:
    dashboard_host = settings.DASHBOARD_HOST.strip()
    if dashboard_host and "://" in dashboard_host:
        parsed_host = urlparse(dashboard_host)
        dashboard_host = parsed_host.netloc or parsed_host.path
    if not dashboard_host:
        dashboard_host = "localhost"

    caddyfile = f"""{{
    admin 0.0.0.0:2019
}}

http://{dashboard_host} {{
    handle /api/* {{
        reverse_proxy api:8000
    }}
    handle {{
        root * /srv
        try_files {{path}} /index.html
        file_server
    }}
}}"""

    if api_key:
        for item in domains:
            domain = item["domain"]
            origin = item["origin"]
            parsed = urlparse(origin)
            scheme = parsed.scheme or "https"
            origin_host = parsed.hostname or parsed.netloc
            port = parsed.port or (443 if scheme == "https" else 80)

            transport_block = ""
            if scheme == "https":
                transport_block = f"""
        transport http {{
            tls
            tls_server_name {origin_host}
        }}"""

            caddyfile += f"""
{domain} {{
    forward_auth api:8000 {{
        uri /api/check?api_key={api_key}
        copy_headers X-WAF-Reason
        @waf_block status 403
        handle_response @waf_block {{
            abort
        }}
    }}
    reverse_proxy {origin_host}:{port} {{
        header_up Host {origin_host}
        header_up X-Forwarded-Host {{http.request.host}}
        header_up X-Forwarded-Proto {{http.request.scheme}}{transport_block}
    }}
}}"""
    return caddyfile


def apply_caddy_config(api_key: str | None) -> None:
    domains = list_domains()
    config_text = build_caddy_config(api_key, domains)
    response = httpx.post(
        f"{settings.CADDY_ADMIN_URL}/load",
        content=config_text,
        headers={"Content-Type": "text/caddyfile"},
        timeout=8.0,
    )
    response.raise_for_status()
