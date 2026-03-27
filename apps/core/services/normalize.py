from __future__ import annotations

from urllib.parse import urlparse


def normalize_domain(value: str) -> str:
    if not value:
        return ""
    raw = value.strip().lower()
    if not raw:
        return ""
    if "://" in raw:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
    else:
        host = raw.split("/", 1)[0]
    host = host.split(":", 1)[0]
    return host.strip()


def normalize_origin(value: str) -> str:
    if not value:
        return ""
    raw = value.strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return raw
