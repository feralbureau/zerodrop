from typing import Optional, Mapping, Iterable, Any, Tuple
import re
import json
import logging

from redis.asyncio.client import Redis

# policy constants
RATE_LIMIT = 100
RATE_WINDOW = 60
BLACKLIST_TTL = 60 * 60
# adaptive rate limiting parameters
EWMA_ALPHA = 0.3
EWMA_TTL = 60 * 60 * 24  # keep EWMA for 24h
# make adaptive threshold more conservative by default; multiplier <1 tightens threshold
ADAPTIVE_MULTIPLIER = 0.8
ADAPTIVE_MIN = 5
# immediate spike factor: if count > RATE_LIMIT * SPIKE_FACTOR, block immediately
SPIKE_FACTOR = 3


# lua script: incr and set expire only on create
_INCR_WITH_EXPIRE_LUA = """
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v
"""

# cached script sha
_SCRIPT_SHA: Optional[str] = None


def _compile_patterns() -> tuple[Iterable[re.Pattern], Iterable[re.Pattern]]:
    """compile basic sqli and xss patterns"""
    sqli = [
        r"(?i)\b(select|union|insert|update|delete|drop|alter|create)\b",
        r"(--|;|\b(or|and)\b\s+[^=]+=[^\n]+)",
        r"(?i)exec\(|sp_executesql",
    ]
    xss = [
        r"(?i)<\s*script\b",
        r"(?i)javascript:",
        r"(?i)on\w+\s*=",
        r"<[^>]+>.*<[^>]+>",
    ]
    return ([re.compile(p) for p in sqli], [re.compile(p) for p in xss])


_SQLI_PATTERNS, _XSS_PATTERNS = _compile_patterns()

# honeypot paths
HONEYPOT_PATHS = [
    "/.env",
    "/wp-admin",
    "/config.php",
    "/phpinfo.php",
    "/.git",
]

# bad user-agent patterns
_BOT_UA_PATTERNS = [
    r"(?i)^$",
    r"(?i)curl/",
    r"(?i)python-requests",
    r"(?i)wget/",
    r"(?i)libwww-perl",
    r"(?i)java/",
    r"(?i)scrapy",
    r"(?i)bot",
]
_BOT_UA_COMPILED = [re.compile(p) for p in _BOT_UA_PATTERNS]
WAF_LOG_STREAM = "waf_logs"
_LOGGER = logging.getLogger("waf")

# headers to skip when scanning for payloads (reduces false positives from browser client hints)
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
    "cdn-loop", # cloudflare shit
}

SETTINGS_KEY = "waf:settings"
DEFAULT_SETTINGS = {
    "allowlist_enabled": True,
    "honeypot_enabled": True,
    "bot_ua_enabled": True,
    "header_inspection_enabled": True,
    "query_inspection_enabled": True,
    "body_inspection_enabled": True,
    "rate_limit_enabled": True,
    "adaptive_rate_limit_enabled": True,
    "spike_rate_limit_enabled": True,
}


def _to_bool(value: str | bytes | None, fallback: bool) -> bool:
    if value is None:
        return fallback
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    v = str(value).strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return fallback


async def get_waf_settings(redis: Redis) -> dict:
    raw = await redis.hgetall(SETTINGS_KEY)
    settings = {}
    for key, default in DEFAULT_SETTINGS.items():
        settings[key] = _to_bool(raw.get(key), default)
    return settings


async def _log_event(redis: Redis, ip: str, action: str, reason: str, **extra: str) -> None:
    """Best-effort append an event to the Redis stream for auditing."""
    try:
        fields = {"ip": ip, "action": action, "reason": reason}
        for k, v in extra.items():
            fields[k] = str(v)
        await redis.xadd(WAF_LOG_STREAM, fields)
        try:
            # also emit to local logger so uvicorn captures it
            _LOGGER.info("waf_event %s %s %s", ip, action, json.dumps(fields, default=str))
        except Exception:
            pass
    except Exception:
        # never raise logging failures
        try:
            # best effort fallback write a warning to stdout so operator sees it
            print(f"[waf_log_error] failed to xadd event for {ip} reason={reason} extra={extra}")
        except Exception:
            pass


async def _incr_with_expire(redis: Redis, key: str, window: int) -> int:
    """atomically incr key and set ttl on first create"""

    global _SCRIPT_SHA
    if _SCRIPT_SHA:
        try:
            res = await redis.evalsha(_SCRIPT_SHA, 1, key, window)
            return int(res)
        except Exception:
            pass

    try:
        _SCRIPT_SHA = await redis.script_load(_INCR_WITH_EXPIRE_LUA)
        res = await redis.evalsha(_SCRIPT_SHA, 1, key, window)
        return int(res)
    except Exception:
        res = await redis.eval(_INCR_WITH_EXPIRE_LUA, 1, key, window)
        return int(res)


async def _update_ewma(redis: Redis, ip: str, value: int) -> float:
    """Update and return EWMA for an IP based on the latest window count."""
    key = f"ewma:{ip}"
    try:
        raw = await redis.get(key)
        prev = float(raw) if raw is not None else 0.0
    except Exception:
        prev = 0.0

    new = EWMA_ALPHA * float(value) + (1.0 - EWMA_ALPHA) * prev
    try:
        # store as string; ensure TTL so it decays if IP disappears
        await redis.set(key, str(new), ex=EWMA_TTL)
    except Exception:
        pass
    return new


async def _adaptive_threshold(redis: Redis, ip: str, ewma: float) -> int:
    """Compute an adaptive threshold based on EWMA and configured multiplier."""
    base = RATE_LIMIT
    try:
        thr = max(base, int(ewma * ADAPTIVE_MULTIPLIER) + ADAPTIVE_MIN)
    except Exception:
        thr = base
    return thr


def _is_malicious_value(value: str) -> bool:
    v = value.strip()
    for p in _SQLI_PATTERNS:
        if p.search(v):
            return True
    for p in _XSS_PATTERNS:
        if p.search(v):
            return True
    return False


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


async def check_ip(
    redis: Redis,
    ip: str,
    *,
    path: Optional[str] = None,
    method: Optional[str] = None,
    headers: Optional[Mapping[str, str]] = None,
    query_params: Optional[Mapping[str, str]] = None,
    body: Optional[bytes] = None,
) -> Tuple[bool, Optional[str]]:
    """Check ip against blacklist, payloads, and rate-limit. Returns True if allowed.

    If malicious payload detected in headers or query params, the IP is added
    to a permanent blacklist.
    """

    settings = await get_waf_settings(redis)

    # allowlist checks (ip or user-agent) - stored as Redis sets `allow:ip` and `allow:ua`
    try:
        if settings["allowlist_enabled"] and headers:
            ua = headers.get("user-agent", "")
            if ua and await redis.sismember("allow:ua", ua):
                await _log_event(redis, ip, action="allow", reason="allowlist_ua", ua=ua)
                return True, "allowlist_ua"
        if settings["allowlist_enabled"] and await redis.sismember("allow:ip", ip):
            await _log_event(redis, ip, action="allow", reason="allowlist_ip")
            return True, "allowlist_ip"
    except Exception:
        # ignore allowlist failures (fail-open)
        pass

    # denylist checks (ua, country)
    try:
        if headers:
            ua = headers.get("user-agent", "")
            if ua and await redis.sismember("deny:ua", ua):
                await _log_event(redis, ip, action="block", reason="denylist_ua", ua=ua)
                return False, "denylist_ua"
            country = _extract_country(headers)
            # ts is not working
            # TODO: fix
            if country:
                normalized = country.strip().upper()
                if await redis.sismember("deny:country", normalized) or await redis.sismember(
                    "deny:country", normalized.lower()
                ):
                    await _log_event(redis, ip, action="block", reason="denylist_country", country=normalized)
                    return False, "denylist_country"
    except Exception:
        pass

    # check blacklist
    if await redis.exists(f"blacklist:{ip}"):
        reason = "already_blacklisted"
        await _log_event(redis, ip, action="block", reason=reason)
        return False, reason

    # honeypot: immediate permaban on sensitive paths
    if settings["honeypot_enabled"] and path:
        p = path.lower()
        for hp in HONEYPOT_PATHS:
            if p == hp or p.startswith(hp + "/"):
                await redis.set(f"blacklist:{ip}", 1)
                reason = "honeypot_path"
                await _log_event(redis, ip, action="block", reason=reason, path=path)
                return False, reason

    # bad bot detection via user-agent
    if settings["bot_ua_enabled"] and headers:
        ua = headers.get("user-agent", "")
        for pat in _BOT_UA_COMPILED:
            if pat.search(ua or ""):
                await redis.set(f"blacklist:{ip}", 1)
                reason = "bad_user_agent"
                await _log_event(redis, ip, action="block", reason=reason, ua=ua)
                return False, reason

    # inspect headers (skip common browser/client headers to avoid false positives)
    if settings["header_inspection_enabled"] and headers:
        for k, v in headers.items():
            kl = k.lower()
            if kl in _SKIP_HEADER_NAMES or any(kl.startswith(p) for p in _SKIP_HEADER_PREFIXES):
                continue
            if _is_malicious_value(k) or _is_malicious_value(v):
                # permanent blacklist (no ex)
                await redis.set(f"blacklist:{ip}", 1)
                reason = "malicious_header"
                await _log_event(redis, ip, action="block", reason=reason, header_key=k, header_value=str(v))
                return False, reason

    # inspect query params
    if settings["query_inspection_enabled"] and query_params:
        for k, v in query_params.items():
            if _is_malicious_value(k) or _is_malicious_value(v):
                await redis.set(f"blacklist:{ip}", 1)
                reason = "malicious_query"
                await _log_event(redis, ip, action="block", reason=reason, param=k, value=str(v))
                return False, reason

    # inspect body for POST/PUT etc.
    if settings["body_inspection_enabled"] and body:
        # try json
        try:
            parsed = json.loads(body)
            # flatten values
            def _iter_values(obj: Any):
                if isinstance(obj, dict):
                    for val in obj.values():
                        yield from _iter_values(val)
                elif isinstance(obj, list):
                    for it in obj:
                        yield from _iter_values(it)
                else:
                    yield str(obj)

            for v in _iter_values(parsed):
                if _is_malicious_value(v):
                    await redis.set(f"blacklist:{ip}", 1)
                    reason = "malicious_body_json"
                    await _log_event(redis, ip, action="block", reason=reason, snippet=str(v)[:200])
                    return False, reason
        except Exception:
            # not json, inspect raw body string
            try:
                s = body.decode(errors="ignore")
                if _is_malicious_value(s):
                    await redis.set(f"blacklist:{ip}", 1)
                    reason = "malicious_body_raw"
                    await _log_event(redis, ip, action="block", reason=reason, snippet=s[:200])
                    return False, reason
            except Exception:
                pass

    # NOTE: header/query/body inspection already performed above; no-op here to avoid double-logging

    if settings["rate_limit_enabled"]:
        key = f"rate:{ip}"
        count = await _incr_with_expire(redis, key, RATE_WINDOW)

        ewma = float(count)
        threshold = RATE_LIMIT
        if settings["adaptive_rate_limit_enabled"]:
            try:
                ewma = await _update_ewma(redis, ip, count)
                threshold = await _adaptive_threshold(redis, ip, ewma)
            except Exception:
                ewma = float(count)
                threshold = RATE_LIMIT

        if settings["spike_rate_limit_enabled"]:
            try:
                if count > (RATE_LIMIT * SPIKE_FACTOR):
                    await redis.set(f"blacklist:{ip}", 1, ex=BLACKLIST_TTL)
                    reason = "spike_rate_limit"
                    await _log_event(redis, ip, action="block", reason=reason, count=str(count), threshold=str(threshold), ewma=str(ewma))
                    return False, reason
            except Exception:
                pass

        if count > threshold:
            await redis.set(f"blacklist:{ip}", 1, ex=BLACKLIST_TTL)
            reason = "adaptive_rate_limit" if settings["adaptive_rate_limit_enabled"] else "rate_limit"
            await _log_event(redis, ip, action="block", reason=reason, count=str(count), threshold=str(threshold), ewma=str(ewma))
            return False, reason

        await _log_event(redis, ip, action="allow", reason="allowed", count=str(count), threshold=str(threshold), ewma=str(ewma))
        return True, "allowed"

    await _log_event(redis, ip, action="allow", reason="allowed")
    return True, "allowed"


__all__ = ["check_ip", "get_waf_settings", "DEFAULT_SETTINGS"]
