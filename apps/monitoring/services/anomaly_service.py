from __future__ import annotations

import json
import time

from apps.core.models import ProtectedDomain
from config.redis import get_sync_redis

ANOMALY_INTERVAL = 60
WINDOW_MINUTES = 5
RETENTION_SECONDS = 24 * 60 * 60
RAW_TTL_SECONDS = 25 * 60 * 60
SPIKE_MULTIPLIER = 3


def _count_key(domain: str, minute_ts: int) -> str:
    return f"rpm:count:{domain}:{minute_ts}"


def _series_key(domain: str) -> str:
    return f"rpm:series:{domain}"


def _anomalies_key(domain: str) -> str:
    return f"rpm:anomalies:{domain}"


def _first_seen_key(domain: str) -> str:
    return f"rpm:first_seen:{domain}"


def record_request(domain: str, now_ts: int | None = None) -> None:
    if not domain:
        return
    redis = get_sync_redis()
    now = int(now_ts or time.time())
    minute_ts = (now // 60) * 60
    key = _count_key(domain, minute_ts)
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, RAW_TTL_SECONDS)
    pipe.setnx(_first_seen_key(domain), str(now))
    pipe.execute()


def _get_counts(domain: str, minute_ts: int, minutes: int) -> list[int]:
    redis = get_sync_redis()
    keys = [_count_key(domain, minute_ts - 60 * offset) for offset in range(minutes)]
    values = redis.mget(keys)
    out: list[int] = []
    for value in values:
        raw = str(value) if value is not None else ""
        out.append(int(raw) if raw.isdigit() else 0)
    return out


def run_anomaly_tick() -> None:
    redis = get_sync_redis()
    now = int(time.time())
    current_minute = ((now // 60) - 1) * 60
    domains = ProtectedDomain.objects.filter(is_active=True).values_list("domain", flat=True)
    for domain in domains:
        first_seen_raw = redis.get(_first_seen_key(domain)) or ""
        if str(first_seen_raw).isdigit():
            first_seen = int(first_seen_raw)
            if now - first_seen < WINDOW_MINUTES * 60:
                continue

        current_count_raw = redis.get(_count_key(domain, current_minute)) or "0"
        current_rpm = int(current_count_raw) if str(current_count_raw).isdigit() else 0

        window_counts = _get_counts(domain, current_minute - 60, WINDOW_MINUTES)
        baseline = (sum(window_counts) / WINDOW_MINUTES) if window_counts else 0

        series_key = _series_key(domain)
        series_payload = json.dumps({"ts": current_minute, "rpm": current_rpm})
        redis.zremrangebyscore(series_key, current_minute, current_minute)
        redis.zadd(series_key, {series_payload: current_minute})
        redis.zremrangebyscore(series_key, 0, now - RETENTION_SECONDS)

        if baseline >= 1 and current_rpm >= baseline * SPIKE_MULTIPLIER:
            anomalies_key = _anomalies_key(domain)
            payload = {
                "ts": current_minute,
                "rpm": current_rpm,
                "baseline": round(baseline, 2),
                "multiplier": SPIKE_MULTIPLIER,
            }
            redis.zremrangebyscore(anomalies_key, current_minute, current_minute)
            redis.zadd(anomalies_key, {json.dumps(payload): current_minute})
            redis.zremrangebyscore(anomalies_key, 0, now - RETENTION_SECONDS)
