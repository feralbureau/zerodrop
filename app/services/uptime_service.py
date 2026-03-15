import asyncio
import json
import logging
import time
from urllib.parse import urlparse

import httpx
from redis.asyncio.client import Redis

UPTIME_SET_KEY = "uptime:monitors"
HISTORY_LIMIT = 20
CHECK_INTERVAL = 30
DEFAULT_CODES = set(range(200, 400))

logger = logging.getLogger("waf.uptime")


def _decode(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        return value.decode()
    return str(value)


def _parse_history(raw: str) -> list[int]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [1 if int(item) else 0 for item in parsed][-HISTORY_LIMIT:]
    except Exception:
        return []
    return []


def _parse_success_codes(raw: str) -> set[int]:
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


async def list_monitors(redis: Redis) -> list[dict]:
    items: list[dict] = []
    ids = await redis.smembers(UPTIME_SET_KEY)
    for raw_id in ids:
        monitor_id = _decode(raw_id)
        key = f"uptime:monitor:{monitor_id}"
        data = await redis.hgetall(key)
        if not data:
            continue
        name = _decode(data.get(b"name") or data.get("name"))
        url = _decode(data.get(b"url") or data.get("url"))
        check_type = _decode(data.get(b"check_type") or data.get("check_type")) or "http"
        success_codes = _decode(data.get(b"success_codes") or data.get("success_codes"))
        history = _parse_history(_decode(data.get(b"history") or data.get("history")))
        last_status = _decode(data.get(b"last_status") or data.get("last_status"))
        checked_at = _decode(data.get(b"checked_at") or data.get("checked_at"))
        items.append(
            {
                "id": monitor_id,
                "name": name,
                "url": url,
                "check_type": check_type,
                "success_codes": success_codes,
                "history": history,
                "last_status": int(last_status) if last_status else None,
                "checked_at": int(checked_at) if checked_at else None,
            }
        )
    return items


async def _check_http(client: httpx.AsyncClient, url: str, success_codes: set[int]) -> bool:
    try:
        resp = await client.get(url, timeout=6.0, follow_redirects=True)
        return resp.status_code in success_codes
    except Exception:
        return False


async def _check_tcp(host: str, port: int) -> bool:
    try:
        await asyncio.wait_for(asyncio.open_connection(host, port), timeout=3.5)
        return True
    except Exception:
        return False


async def _broadcast(app, payload: dict) -> None:
    clients = getattr(app.state, "uptime_clients", set())
    if not clients:
        return
    dead = []
    for socket in clients:
        try:
            await socket.send_json(payload)
        except Exception:
            dead.append(socket)
    for socket in dead:
        clients.discard(socket)


async def check_and_update(redis: Redis, monitor_id: str, client: httpx.AsyncClient, app=None) -> dict | None:
    key = f"uptime:monitor:{monitor_id}"
    data = await redis.hgetall(key)
    if not data:
        return None
    url = _decode(data.get(b"url") or data.get("url"))
    check_type = _decode(data.get(b"check_type") or data.get("check_type")) or "http"
    success_raw = _decode(data.get(b"success_codes") or data.get("success_codes"))
    if not url:
        return None
    status = 0
    normalized_url = url
    if check_type == "tcp":
        parsed = urlparse(url if "://" in url else f"tcp://{url}")
        if not parsed.hostname:
            return None
        port = parsed.port or 443
        status = 1 if await _check_tcp(parsed.hostname, port) else 0
    else:
        if "://" not in url:
            normalized_url = f"https://{url}"
        parsed = urlparse(normalized_url)
        if not parsed.scheme or not parsed.netloc:
            return None
        try:
            success_codes = _parse_success_codes(success_raw) or DEFAULT_CODES
        except ValueError:
            success_codes = DEFAULT_CODES
        status = 1 if await _check_http(client, normalized_url, success_codes) else 0
    history = _parse_history(_decode(data.get(b"history") or data.get("history")))
    history.append(status)
    history = history[-HISTORY_LIMIT:]
    checked_at = int(time.time())
    updates = {
        "history": json.dumps(history),
        "last_status": str(status),
        "checked_at": str(checked_at),
    }
    if normalized_url != url:
        updates["url"] = normalized_url
    await redis.hset(key, mapping=updates)
    payload = {
        "id": monitor_id,
        "history": history,
        "last_status": status,
        "checked_at": checked_at,
    }
    if app is not None:
        await _broadcast(app, payload)
    return payload


async def run_uptime_loop(app) -> None:
    redis: Redis = app.state.redis
    async with httpx.AsyncClient() as client:
        while True:
            try:
                ids = await redis.smembers(UPTIME_SET_KEY)
                for raw_id in ids:
                    monitor_id = _decode(raw_id)
                    await check_and_update(redis, monitor_id, client, app=app)
            except Exception as exc:
                logger.info("uptime loop error %s", exc)
            await asyncio.sleep(CHECK_INTERVAL)
