from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from datetime import timedelta
from typing import Any, Iterable, Mapping, Optional, final

from django.utils import timezone

from apps.core.models import AllowlistEntry, BlacklistEntry, DenylistEntry, WafLogAction, WafLogEvent
from apps.core.services.state_service import get_settings_payload
from config.redis import get_sync_redis

# policy constants
RATE_LIMIT = 100
RATE_WINDOW = 60
BLACKLIST_TTL = 60 * 60
EWMA_ALPHA = 0.3
EWMA_TTL = 60 * 60 * 24
ADAPTIVE_MULTIPLIER = 0.8
ADAPTIVE_MIN = 5
SPIKE_FACTOR = 3
WAF_LOG_STREAM = "waf_logs"

_LOGGER = logging.getLogger("waf")

_INCR_WITH_EXPIRE_LUA = """
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v
"""
_SCRIPT_SHA: Optional[str] = None


class BaseThreatInspector(ABC):
    @final
    def is_malicious(self, value: str) -> bool:
        return self._is_malicious(value)

    @abstractmethod
    def _is_malicious(self, value: str) -> bool:
        raise NotImplementedError


class RegexThreatInspector(BaseThreatInspector):
    def __init__(self, patterns: Iterable[str]) -> None:
        self._compiled = [re.compile(pattern) for pattern in patterns]

    def _is_malicious(self, value: str) -> bool:
        raw = value.strip()
        return any(pattern.search(raw) for pattern in self._compiled)


_SQLI = RegexThreatInspector(
    [
        r"(?i)\b(select|union|insert|update|delete|drop|alter|create)\b",
        r"(--|;|\b(or|and)\b\s+[^=]+=[^\n]+)",
        r"(?i)exec\(|sp_executesql",
    ]
)
_XSS = RegexThreatInspector(
    [
        r"(?i)<\s*script\b",
        r"(?i)javascript:",
        r"(?i)on\w+\s*=",
        r"<[^>]+>.*<[^>]+>",
    ]
)

HONEYPOT_PATHS = [
    "/.env",
    "/wp-admin",
    "/config.php",
    "/phpinfo.php",
    "/.git",
]

_BOT_UA_COMPILED = [
    re.compile(pattern)
    for pattern in [
        r"(?i)^$",
        r"(?i)curl/",
        r"(?i)python-requests",
        r"(?i)wget/",
        r"(?i)libwww-perl",
        r"(?i)java/",
        r"(?i)scrapy",
        r"(?i)bot",
    ]
]

_SKIP_HEADER_PREFIXES = ("sec-", "sec-ch-")
_SKIP_HEADER_NAMES = {
    "accept",
    "accept-encoding",
    "accept-language",
    "user-agent",
    "upgrade-insecure-requests",
    "connection",
    "pragma",
    "cache-control",
    "cdn-loop",
}


def _is_malicious_value(value: str) -> bool:
    return _SQLI.is_malicious(value) or _XSS.is_malicious(value)


def get_waf_settings() -> dict[str, bool]:
    return get_settings_payload()


def _extract_country(headers: Optional[Mapping[str, str]]) -> Optional[str]:
    if not headers:
        return None
    candidates = (
        "x-country",
        "cf-ipcountry",
        "x-geo-country",
        "x-vercel-ip-country",
        "x-forwarded-country",
        "x-country-code",
        "x-geoip-country",
        "x-geoip-country-code",
        "x-countrycode",
    )
    for key in candidates:
        value = headers.get(key)
        if value:
            return value
    return None


def _log_event(ip: str, action: str, reason: str, **extra: str) -> None:
    redis = get_sync_redis()
    fields = {"ip": ip, "action": action, "reason": reason, **{k: str(v) for k, v in extra.items()}}
    stream_id = None
    try:
        stream_id = redis.xadd(WAF_LOG_STREAM, fields)
    except Exception:
        pass

    try:
        WafLogEvent.objects.create(
            stream_id=stream_id,
            ip=ip,
            action=action if action in WafLogAction.values else WafLogAction.ALLOW,
            reason=reason,
            method=extra.get("method", ""),
            path=extra.get("path", ""),
            user_agent=extra.get("ua", ""),
            country=extra.get("country", ""),
            details=fields,
        )
    except Exception:
        pass

    _LOGGER.info("waf_event %s %s %s", ip, action, json.dumps(fields, default=str))


def _incr_with_expire(key: str, window: int) -> int:
    global _SCRIPT_SHA
    redis = get_sync_redis()
    if _SCRIPT_SHA:
        try:
            result = redis.evalsha(_SCRIPT_SHA, 1, key, window)
            return int(result)
        except Exception:
            pass
    try:
        _SCRIPT_SHA = redis.script_load(_INCR_WITH_EXPIRE_LUA)
        result = redis.evalsha(_SCRIPT_SHA, 1, key, window)
        return int(result)
    except Exception:
        result = redis.eval(_INCR_WITH_EXPIRE_LUA, 1, key, window)
        return int(result)


def _update_ewma(ip: str, value: int) -> float:
    redis = get_sync_redis()
    key = f"ewma:{ip}"
    try:
        raw = redis.get(key)
        prev = float(raw) if raw is not None else 0.0
    except Exception:
        prev = 0.0
    new = EWMA_ALPHA * float(value) + (1.0 - EWMA_ALPHA) * prev
    try:
        redis.set(key, str(new), ex=EWMA_TTL)
    except Exception:
        pass
    return new


def _adaptive_threshold(ewma: float) -> int:
    try:
        return max(RATE_LIMIT, int(ewma * ADAPTIVE_MULTIPLIER) + ADAPTIVE_MIN)
    except Exception:
        return RATE_LIMIT


def _load_active_blacklist(ip: str) -> Optional[BlacklistEntry]:
    now = timezone.now()
    entry = BlacklistEntry.objects.filter(ip=ip).first()
    if not entry:
        return None
    if entry.expires_at is not None and entry.expires_at <= now:
        entry.delete()
        return None
    return entry


def _sync_blacklist_to_redis(ip: str, entry: BlacklistEntry) -> None:
    redis = get_sync_redis()
    if entry.expires_at is None:
        redis.set(f"blacklist:{ip}", 1)
        return
    ttl = entry.ttl_seconds
    if ttl > 0:
        redis.set(f"blacklist:{ip}", 1, ex=ttl)


def blacklist_ip(ip: str, reason: str, *, ttl_seconds: Optional[int] = None) -> None:
    expires_at = None
    if ttl_seconds is not None and ttl_seconds > 0:
        expires_at = timezone.now() + timedelta(seconds=ttl_seconds)
    BlacklistEntry.objects.update_or_create(
        ip=ip,
        defaults={"reason": reason, "expires_at": expires_at},
    )
    redis = get_sync_redis()
    if ttl_seconds is not None and ttl_seconds > 0:
        redis.set(f"blacklist:{ip}", 1, ex=ttl_seconds)
    else:
        redis.set(f"blacklist:{ip}", 1)
    redis.delete(f"rate:{ip}")


def check_ip(
    ip: str,
    *,
    path: Optional[str] = None,
    method: Optional[str] = None,
    headers: Optional[Mapping[str, str]] = None,
    query_params: Optional[Mapping[str, str]] = None,
    body: Optional[bytes] = None,
) -> tuple[bool, Optional[str]]:
    redis = get_sync_redis()
    settings = get_waf_settings()
    headers = headers or {}
    ua = headers.get("user-agent", "")

    if settings["allowlist_enabled"]:
        if ua and AllowlistEntry.objects.filter(entry_type="ua", value=ua).exists():
            _log_event(ip, action="allow", reason="allowlist_ua", ua=ua, method=method or "", path=path or "")
            return True, "allowlist_ua"
        if AllowlistEntry.objects.filter(entry_type="ip", value=ip).exists():
            _log_event(ip, action="allow", reason="allowlist_ip", method=method or "", path=path or "")
            return True, "allowlist_ip"

    if ua and DenylistEntry.objects.filter(entry_type="ua", value=ua).exists():
        _log_event(ip, action="block", reason="denylist_ua", ua=ua, method=method or "", path=path or "")
        return False, "denylist_ua"
    country = _extract_country(headers)
    if country:
        normalized = country.strip().upper()
        if DenylistEntry.objects.filter(entry_type="country", value=normalized).exists():
            _log_event(ip, action="block", reason="denylist_country", country=normalized, method=method or "", path=path or "")
            return False, "denylist_country"

    redis_key = f"blacklist:{ip}"
    try:
        if redis.exists(redis_key):
            _log_event(ip, action="block", reason="already_blacklisted", method=method or "", path=path or "")
            return False, "already_blacklisted"
    except Exception:
        pass

    orm_blacklist = _load_active_blacklist(ip)
    if orm_blacklist:
        _sync_blacklist_to_redis(ip, orm_blacklist)
        _log_event(ip, action="block", reason="already_blacklisted", method=method or "", path=path or "")
        return False, "already_blacklisted"

    if settings["honeypot_enabled"] and path:
        p = path.lower()
        for hp in HONEYPOT_PATHS:
            if p == hp or p.startswith(hp + "/"):
                blacklist_ip(ip, reason="honeypot_path")
                _log_event(ip, action="block", reason="honeypot_path", path=path, method=method or "")
                return False, "honeypot_path"

    if settings["bot_ua_enabled"]:
        for pat in _BOT_UA_COMPILED:
            if pat.search(ua or ""):
                blacklist_ip(ip, reason="bad_user_agent")
                _log_event(ip, action="block", reason="bad_user_agent", ua=ua, method=method or "", path=path or "")
                return False, "bad_user_agent"

    if settings["header_inspection_enabled"] and headers:
        for key, value in headers.items():
            key_l = key.lower()
            if key_l in _SKIP_HEADER_NAMES or any(key_l.startswith(prefix) for prefix in _SKIP_HEADER_PREFIXES):
                continue
            if _is_malicious_value(key) or _is_malicious_value(value):
                blacklist_ip(ip, reason="malicious_header")
                _log_event(
                    ip,
                    action="block",
                    reason="malicious_header",
                    header_key=key,
                    header_value=str(value),
                    method=method or "",
                    path=path or "",
                )
                return False, "malicious_header"

    if settings["query_inspection_enabled"] and query_params:
        for key, value in query_params.items():
            if _is_malicious_value(key) or _is_malicious_value(value):
                blacklist_ip(ip, reason="malicious_query")
                _log_event(
                    ip,
                    action="block",
                    reason="malicious_query",
                    param=key,
                    value=str(value),
                    method=method or "",
                    path=path or "",
                )
                return False, "malicious_query"

    if settings["body_inspection_enabled"] and body:
        try:
            parsed = json.loads(body)

            def iter_values(node: Any) -> Iterable[str]:
                if isinstance(node, dict):
                    for value in node.values():
                        yield from iter_values(value)
                elif isinstance(node, list):
                    for item in node:
                        yield from iter_values(item)
                else:
                    yield str(node)

            for value in iter_values(parsed):
                if _is_malicious_value(value):
                    blacklist_ip(ip, reason="malicious_body_json")
                    _log_event(ip, action="block", reason="malicious_body_json", snippet=value[:200], method=method or "", path=path or "")
                    return False, "malicious_body_json"
        except Exception:
            try:
                raw = body.decode(errors="ignore")
                if _is_malicious_value(raw):
                    blacklist_ip(ip, reason="malicious_body_raw")
                    _log_event(ip, action="block", reason="malicious_body_raw", snippet=raw[:200], method=method or "", path=path or "")
                    return False, "malicious_body_raw"
            except Exception:
                pass

    if settings["rate_limit_enabled"]:
        key = f"rate:{ip}"
        count = _incr_with_expire(key, RATE_WINDOW)
        ewma = float(count)
        threshold = RATE_LIMIT

        if settings["adaptive_rate_limit_enabled"]:
            ewma = _update_ewma(ip, count)
            threshold = _adaptive_threshold(ewma)

        if settings["spike_rate_limit_enabled"] and count > (RATE_LIMIT * SPIKE_FACTOR):
            blacklist_ip(ip, reason="spike_rate_limit", ttl_seconds=BLACKLIST_TTL)
            _log_event(
                ip,
                action="block",
                reason="spike_rate_limit",
                count=str(count),
                threshold=str(threshold),
                ewma=str(ewma),
                method=method or "",
                path=path or "",
            )
            return False, "spike_rate_limit"

        if count > threshold:
            reason = "adaptive_rate_limit" if settings["adaptive_rate_limit_enabled"] else "rate_limit"
            blacklist_ip(ip, reason=reason, ttl_seconds=BLACKLIST_TTL)
            _log_event(
                ip,
                action="block",
                reason=reason,
                count=str(count),
                threshold=str(threshold),
                ewma=str(ewma),
                method=method or "",
                path=path or "",
            )
            return False, reason

        _log_event(
            ip,
            action="allow",
            reason="allowed",
            count=str(count),
            threshold=str(threshold),
            ewma=str(ewma),
            method=method or "",
            path=path or "",
        )
        return True, "allowed"

    _log_event(ip, action="allow", reason="allowed", method=method or "", path=path or "")
    return True, "allowed"
