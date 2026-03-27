from __future__ import annotations

import json
import socket
import time
from datetime import datetime
from urllib.parse import urlparse

import httpx
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

from apps.core.models import UptimeMonitor
from apps.monitoring.constants import UPTIME_GROUP

HISTORY_LIMIT = 20
CHECK_INTERVAL = 30
DEFAULT_CODES = set(range(200, 400))


def parse_success_codes(raw: str) -> set[int]:
    if not raw:
        return set()
    items = [item.strip() for item in raw.split(",") if item.strip()]
    if not items:
        return set()

    codes: set[int] = set()
    for item in items:
        if "-" in item:
            start_raw, end_raw = item.split("-", 1)
            start = int(start_raw.strip())
            end = int(end_raw.strip())
            if start > end:
                raise ValueError("invalid status range")
            for code in range(start, end + 1):
                codes.add(code)
            continue
        codes.add(int(item))

    for code in codes:
        if code < 100 or code > 599:
            raise ValueError("invalid status code")
    return codes


def monitor_to_payload(monitor: UptimeMonitor) -> dict:
    checked_at = None
    if monitor.checked_at is not None:
        checked_at = int(monitor.checked_at.timestamp())
    return {
        "id": str(monitor.id),
        "name": monitor.name,
        "url": monitor.url,
        "check_type": monitor.check_type,
        "success_codes": monitor.success_codes,
        "history": monitor.history or [],
        "latency_history": monitor.latency_history or [],
        "checked_at_history": monitor.checked_at_history or [],
        "last_status": monitor.last_status,
        "last_latency": monitor.last_latency,
        "checked_at": checked_at,
    }


def _check_http(client: httpx.Client, url: str, success_codes: set[int]) -> tuple[bool, int]:
    try:
        start = time.perf_counter()
        response = client.get(url, timeout=6.0, follow_redirects=True)
        latency_ms = int((time.perf_counter() - start) * 1000)
        return response.status_code in success_codes, latency_ms
    except Exception:
        return False, -1


def _check_tcp(host: str, port: int) -> tuple[bool, int]:
    try:
        start = time.perf_counter()
        with socket.create_connection((host, port), timeout=3.5):
            pass
        latency_ms = int((time.perf_counter() - start) * 1000)
        return True, latency_ms
    except Exception:
        return False, -1


def _broadcast_uptime(payload: dict) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        UPTIME_GROUP,
        {
            "type": "uptime.message",
            "payload": payload,
        },
    )


def broadcast_snapshot() -> None:
    payload = {
        "type": "snapshot",
        "monitors": [monitor_to_payload(monitor) for monitor in UptimeMonitor.objects.filter(is_active=True)],
    }
    _broadcast_uptime(payload)


def check_and_update(monitor: UptimeMonitor, client: httpx.Client, *, broadcast: bool = True) -> dict | None:
    url = monitor.url
    check_type = monitor.check_type or "http"
    success_raw = monitor.success_codes or ""
    if not url:
        return None

    status = 0
    latency_ms = -1
    normalized_url = url

    if check_type == "tcp":
        parsed = urlparse(url if "://" in url else f"tcp://{url}")
        if not parsed.hostname:
            return None
        port = parsed.port or 443
        ok, latency_ms = _check_tcp(parsed.hostname, port)
        status = 1 if ok else 0
    else:
        if "://" not in url:
            normalized_url = f"https://{url}"
        parsed = urlparse(normalized_url)
        if not parsed.scheme or not parsed.netloc:
            return None
        try:
            success_codes = parse_success_codes(success_raw) or DEFAULT_CODES
        except ValueError:
            success_codes = DEFAULT_CODES
        ok, latency_ms = _check_http(client, normalized_url, success_codes)
        status = 1 if ok else 0

    history = list(monitor.history or [])
    latency_history = list(monitor.latency_history or [])
    checked_at_history = list(monitor.checked_at_history or [])

    history.append(status)
    history = history[-HISTORY_LIMIT:]
    latency_history.append(latency_ms)
    latency_history = latency_history[-HISTORY_LIMIT:]
    checked_at_dt = timezone.now()
    checked_at_ts = int(checked_at_dt.timestamp())
    checked_at_history.append(checked_at_ts)
    checked_at_history = checked_at_history[-HISTORY_LIMIT:]

    monitor.history = history
    monitor.latency_history = latency_history
    monitor.checked_at_history = checked_at_history
    monitor.last_status = status
    monitor.checked_at = checked_at_dt
    if latency_ms >= 0:
        monitor.last_latency = latency_ms
    if normalized_url != url:
        monitor.url = normalized_url
    monitor.save()

    payload = monitor_to_payload(monitor)
    if broadcast:
        _broadcast_uptime(payload)
    return payload


def run_uptime_tick(client: httpx.Client) -> None:
    monitors = UptimeMonitor.objects.filter(is_active=True)
    for monitor in monitors:
        check_and_update(monitor, client, broadcast=True)
