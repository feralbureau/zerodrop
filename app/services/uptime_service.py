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
        history = _parse_history(_decode(data.get(b"history") or data.get("history")))
        last_status = _decode(data.get(b"last_status") or data.get("last_status"))
        checked_at = _decode(data.get(b"checked_at") or data.get("checked_at"))
        items.append(
            {
                "id": monitor_id,
                "name": name,
                "url": url,
                "history": history,
                "last_status": int(last_status) if last_status else None,
                "checked_at": int(checked_at) if checked_at else None,
            }
        )
    return items


async def _check_url(client: httpx.AsyncClient, url: str) -> bool:
    try:
        resp = await client.get(url, timeout=6.0, follow_redirects=True)
        return resp.status_code < 500
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


async def run_uptime_loop(app) -> None:
    redis: Redis = app.state.redis
    async with httpx.AsyncClient() as client:
        while True:
            try:
                ids = await redis.smembers(UPTIME_SET_KEY)
                for raw_id in ids:
                    monitor_id = _decode(raw_id)
                    key = f"uptime:monitor:{monitor_id}"
                    data = await redis.hgetall(key)
                    if not data:
                        continue
                    url = _decode(data.get(b"url") or data.get("url"))
                    if not url:
                        continue
                    parsed = urlparse(url)
                    if not parsed.scheme or not parsed.netloc:
                        continue
                    status = 1 if await _check_url(client, url) else 0
                    history = _parse_history(_decode(data.get(b"history") or data.get("history")))
                    history.append(status)
                    history = history[-HISTORY_LIMIT:]
                    checked_at = int(time.time())
                    await redis.hset(
                        key,
                        mapping={
                            "history": json.dumps(history),
                            "last_status": str(status),
                            "checked_at": str(checked_at),
                        },
                    )
                    await _broadcast(
                        app,
                        {
                            "id": monitor_id,
                            "history": history,
                            "last_status": status,
                            "checked_at": checked_at,
                        },
                    )
            except Exception as exc:
                logger.info("uptime loop error %s", exc)
            await asyncio.sleep(CHECK_INTERVAL)
