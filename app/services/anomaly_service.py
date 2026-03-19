import asyncio
import json
import time

from redis.asyncio.client import Redis

from redis.asyncio.client import Redis

ANOMALY_INTERVAL = 60
WINDOW_MINUTES = 5
RETENTION_SECONDS = 24 * 60 * 60
RAW_TTL_SECONDS = 25 * 60 * 60
SPIKE_MULTIPLIER = 3


def _decode(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        return value.decode()
    return str(value)


def _count_key(domain: str, minute_ts: int) -> str:
    return f"rpm:count:{domain}:{minute_ts}"


def _series_key(domain: str) -> str:
    return f"rpm:series:{domain}"


def _anomalies_key(domain: str) -> str:
    return f"rpm:anomalies:{domain}"


def _first_seen_key(domain: str) -> str:
    return f"rpm:first_seen:{domain}"


async def record_request(redis: Redis, domain: str, now_ts: int | None = None) -> None:
    if not domain:
        return
    now = int(now_ts or time.time())
    minute_ts = (now // 60) * 60
    key = _count_key(domain, minute_ts)
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, RAW_TTL_SECONDS)
    pipe.setnx(_first_seen_key(domain), str(now))
    await pipe.execute()


async def _get_counts(redis: Redis, domain: str, minute_ts: int, minutes: int) -> list[int]:
    keys = [_count_key(domain, minute_ts - 60 * offset) for offset in range(minutes)]
    values = await redis.mget(keys)
    out = []
    for value in values:
        raw = _decode(value)
        out.append(int(raw) if raw.isdigit() else 0)
    return out


async def run_anomaly_loop(app) -> None:
    redis: Redis = app.state.redis
    while True:
        try:
            now = int(time.time())
            current_minute = ((now // 60) - 1) * 60
            domains = await redis.hkeys("waf:domains")
            for raw_domain in domains:
                domain = _decode(raw_domain)
                if not domain:
                    continue
                first_seen_raw = _decode(await redis.get(_first_seen_key(domain)))
                if first_seen_raw.isdigit():
                    first_seen = int(first_seen_raw)
                    if now - first_seen < WINDOW_MINUTES * 60:
                        continue

                current_count_raw = _decode(await redis.get(_count_key(domain, current_minute)))
                current_rpm = int(current_count_raw) if current_count_raw.isdigit() else 0

                window_counts = await _get_counts(redis, domain, current_minute - 60, WINDOW_MINUTES)
                baseline = sum(window_counts) / WINDOW_MINUTES if window_counts else 0

                series_key = _series_key(domain)
                series_payload = json.dumps({"ts": current_minute, "rpm": current_rpm})
                await redis.zremrangebyscore(series_key, current_minute, current_minute)
                await redis.zadd(series_key, {series_payload: current_minute})
                await redis.zremrangebyscore(series_key, 0, now - RETENTION_SECONDS)

                if baseline >= 1 and current_rpm >= baseline * SPIKE_MULTIPLIER:
                    anomalies_key = _anomalies_key(domain)
                    payload = {
                        "ts": current_minute,
                        "rpm": current_rpm,
                        "baseline": round(baseline, 2),
                        "multiplier": SPIKE_MULTIPLIER,
                    }
                    await redis.zremrangebyscore(anomalies_key, current_minute, current_minute)
                    await redis.zadd(anomalies_key, {json.dumps(payload): current_minute})
                    await redis.zremrangebyscore(anomalies_key, 0, now - RETENTION_SECONDS)
        except Exception:
            pass
        await asyncio.sleep(ANOMALY_INTERVAL)
