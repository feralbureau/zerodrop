from __future__ import annotations

import json
import logging
import time
from datetime import timedelta
from urllib.parse import parse_qs, urlparse
from uuid import UUID, uuid4

import httpx
from django.db import transaction
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.core.models import (
    AllowlistEntry,
    ApiCredential,
    BlacklistEntry,
    DenylistEntry,
    Profile,
    ProtectedDomain,
    UptimeMonitor,
    WafLogEvent,
    WafSetting,
)
from apps.core.services.caddy_service import apply_caddy_config, list_domains
from apps.core.services.normalize import normalize_domain, normalize_origin
from apps.core.services.state_service import (
    get_api_key,
    get_profile_payload,
    get_settings_payload,
    set_api_key,
    update_profile,
    update_settings,
)
from apps.monitoring.services.anomaly_service import record_request
from apps.monitoring.services.uptime_service import check_and_update, monitor_to_payload, parse_success_codes
from apps.security.services.auth_service import api_key_required
from apps.security.services.waf_service import WAF_LOG_STREAM, blacklist_ip, check_ip
from config.redis import get_sync_redis


logger = logging.getLogger("waf.api")


def endpoint(methods: list[str]):
    def decorator(view):
        return csrf_exempt(require_http_methods(methods)(view))

    return decorator


def _json_body(request: HttpRequest) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except Exception:
        return {}


def _extract_client_ip(request: HttpRequest) -> str:
    x_real = request.headers.get("X-Real-IP")
    if x_real:
        return x_real.strip()
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",", 1)[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def _parse_query_params(query: str) -> dict[str, str]:
    parsed = parse_qs(query)
    out: dict[str, str] = {}
    for key, value in parsed.items():
        if isinstance(value, list) and value:
            out[key] = str(value[0])
        elif isinstance(value, str):
            out[key] = value
        else:
            out[key] = ""
    return out


def _normalize_stream_fields(fields) -> dict[str, str]:
    if not fields:
        return {}
    if isinstance(fields, dict):
        return {str(k): str(v) for k, v in fields.items()}
    if isinstance(fields, list):
        out: dict[str, str] = {}
        for pair in fields:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                out[str(pair[0])] = str(pair[1])
        return out
    return {}


def _active_blacklist_entries() -> list[BlacklistEntry]:
    now = timezone.now()
    expired = BlacklistEntry.objects.filter(expires_at__isnull=False, expires_at__lte=now)
    if expired.exists():
        expired.delete()
    return list(BlacklistEntry.objects.filter(expires_at__isnull=True) | BlacklistEntry.objects.filter(expires_at__gt=now))


def _blacklist_ttl(entry: BlacklistEntry) -> int:
    if entry.expires_at is None:
        return -1
    return max(0, int((entry.expires_at - timezone.now()).total_seconds()))


@endpoint(["GET"])
def health(request: HttpRequest) -> JsonResponse:
    redis = get_sync_redis()
    try:
        ok = redis.ping()
        return JsonResponse({"redis": "ok" if ok else "fail"})
    except Exception as exc:
        return JsonResponse({"redis": "fail", "detail": str(exc)}, status=503)


@endpoint(["POST"])
def setup(request: HttpRequest) -> JsonResponse:
    existing = get_api_key()
    if existing:
        return JsonResponse({"configured": True}, status=409)

    payload = _json_body(request)
    api_key = str(payload.get("api_key", "")).strip()
    domain = normalize_domain(str(payload.get("domain", "")))
    origin = normalize_origin(str(payload.get("origin", "")))
    nickname = str(payload.get("nickname", "")).strip()
    avatar_url = str(payload.get("avatar_url", "")).strip()

    if not api_key:
        return JsonResponse({"detail": "api_key required"}, status=400)
    if not domain:
        return JsonResponse({"detail": "domain required"}, status=400)
    if not origin:
        return JsonResponse({"detail": "origin required"}, status=400)
    if not nickname:
        return JsonResponse({"detail": "nickname required"}, status=400)
    if not avatar_url:
        return JsonResponse({"detail": "avatar_url required"}, status=400)

    set_api_key(api_key)
    update_profile({"nickname": nickname, "avatar_url": avatar_url})
    ProtectedDomain.objects.update_or_create(domain=domain, defaults={"origin": origin, "is_active": True})
    logger.info("setup domain=%s origin=%s", domain, origin)

    try:
        apply_caddy_config(api_key)
    except Exception as exc:
        return JsonResponse({"detail": f"caddy load failed: {exc}"}, status=502)

    return JsonResponse({"configured": True, "profile": get_profile_payload(), "settings": get_settings_payload()})


@endpoint(["PUT"])
@api_key_required
def update_origin(request: HttpRequest) -> JsonResponse:
    payload = _json_body(request)
    origin = normalize_origin(str(payload.get("origin", "")))
    if not origin:
        return JsonResponse({"detail": "origin required"}, status=400)

    domains = list(ProtectedDomain.objects.filter(is_active=True))
    if len(domains) != 1:
        return JsonResponse({"detail": "use /api/domains to update origins"}, status=409)

    domain = domains[0]
    domain.origin = origin
    domain.save(update_fields=["origin", "updated_at"])

    api_key = get_api_key()
    if api_key:
        try:
            apply_caddy_config(api_key)
        except Exception as exc:
            return JsonResponse({"detail": f"caddy load failed: {exc}"}, status=502)
    return JsonResponse({"updated": True, "origin": origin, "domain": domain.domain})


@endpoint(["POST"])
@api_key_required
def regenerate_key(request: HttpRequest) -> JsonResponse:
    new_key = str(uuid4())
    set_api_key(new_key)
    try:
        apply_caddy_config(new_key)
    except Exception as exc:
        return JsonResponse({"detail": f"caddy load failed: {exc}"}, status=502)
    return JsonResponse({"regenerated": True, "api_key": new_key})


@endpoint(["POST"])
@api_key_required
def reset_system(request: HttpRequest) -> JsonResponse:
    with transaction.atomic():
        ApiCredential.objects.all().delete()
        Profile.objects.all().delete()
        ProtectedDomain.objects.all().delete()
        WafSetting.objects.all().delete()
        AllowlistEntry.objects.all().delete()
        DenylistEntry.objects.all().delete()
        BlacklistEntry.objects.all().delete()
        WafLogEvent.objects.all().delete()
        UptimeMonitor.objects.all().delete()
    try:
        get_sync_redis().flushdb()
    except Exception:
        pass
    try:
        apply_caddy_config(None)
    except Exception:
        pass
    return JsonResponse({"reset": True})


@endpoint(["GET"])
def validate_key(request: HttpRequest) -> JsonResponse:
    expected = get_api_key()
    if not expected:
        return JsonResponse({"configured": False, "valid": False})
    x_api_key = request.headers.get("X-API-Key")
    return JsonResponse({"configured": True, "valid": x_api_key == expected})


@endpoint(["GET", "POST"])
@api_key_required
def domains(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return JsonResponse({"domains": list_domains()})

    payload = _json_body(request)
    domain = normalize_domain(str(payload.get("domain", "")))
    origin = normalize_origin(str(payload.get("origin", "")))
    if not domain:
        return JsonResponse({"detail": "domain required"}, status=400)
    if not origin:
        return JsonResponse({"detail": "origin required"}, status=400)

    api_key = get_api_key()
    if not api_key:
        return JsonResponse({"detail": "api key not configured"}, status=400)

    ProtectedDomain.objects.update_or_create(domain=domain, defaults={"origin": origin, "is_active": True})
    try:
        apply_caddy_config(api_key)
    except Exception as exc:
        return JsonResponse({"detail": f"caddy load failed: {exc}"}, status=502)
    return JsonResponse({"added": True, "domain": domain, "origin": origin})


@endpoint(["DELETE"])
@api_key_required
def delete_domain(request: HttpRequest, domain: str) -> JsonResponse:
    normalized = normalize_domain(domain)
    if not normalized:
        return JsonResponse({"detail": "domain required"}, status=400)
    removed, _ = ProtectedDomain.objects.filter(domain=normalized).delete()
    api_key = get_api_key()
    if api_key:
        try:
            apply_caddy_config(api_key)
        except Exception as exc:
            return JsonResponse({"detail": f"caddy load failed: {exc}"}, status=502)
    return JsonResponse({"deleted": True if removed else False, "domain": normalized})


@endpoint(["GET", "POST", "HEAD", "OPTIONS"])
@api_key_required
def check_request(request: HttpRequest) -> HttpResponse:
    ip = _extract_client_ip(request)
    headers = {str(k).lower(): str(v) for k, v in request.headers.items()}
    forwarded_host = headers.get("x-forwarded-host") or headers.get("host")
    orig_uri = (
        headers.get("x-original-uri")
        or headers.get("x-forwarded-uri")
        or headers.get("x-forwarded-url")
        or headers.get("x-rewrite-url")
        or request.build_absolute_uri()
    )
    parsed = urlparse(orig_uri)
    query_params = _parse_query_params(parsed.query)
    domain = (forwarded_host or parsed.netloc or parsed.path).split(":")[0].strip()

    try:
        try:
            record_request(domain)
        except Exception:
            pass
        body = request.body or b""
        allowed, reason = check_ip(
            ip,
            path=parsed.path,
            method=headers.get("x-original-method") or headers.get("x-forwarded-method") or request.method,
            headers=headers,
            query_params=query_params,
            body=body,
        )
        if allowed:
            response = HttpResponse(status=200)
            response["X-WAF-Reason"] = reason or "allowed"
            return response
        response = HttpResponse(status=403)
        response["X-WAF-Reason"] = reason or "blocked"
        return response
    except Exception:
        response = HttpResponse(status=200)
        response["X-WAF-Reason"] = "redis_error"
        return response


@endpoint(["POST"])
@api_key_required
def unban_ip(request: HttpRequest) -> JsonResponse:
    target_ip = request.GET.get("ip") or _extract_client_ip(request)
    redis = get_sync_redis()
    try:
        redis_deleted = redis.delete(f"blacklist:{target_ip}", f"rate:{target_ip}")
        db_deleted, _ = BlacklistEntry.objects.filter(ip=target_ip).delete()
        unbanned = bool(redis_deleted or db_deleted)
        return JsonResponse({"unbanned": unbanned, "ip": target_ip})
    except Exception as exc:
        return JsonResponse({"detail": str(exc)}, status=500)


@endpoint(["POST"])
@api_key_required
def add_blacklist(request: HttpRequest) -> JsonResponse:
    payload = _json_body(request)
    ip = str(payload.get("ip", "")).strip()
    if not ip:
        return JsonResponse({"detail": "ip required"}, status=400)
    minutes = payload.get("minutes")
    ttl_seconds = None
    if minutes is not None:
        try:
            minutes_int = int(minutes)
            if minutes_int > 0:
                ttl_seconds = minutes_int * 60
        except Exception:
            return JsonResponse({"detail": "minutes must be integer"}, status=400)

    blacklist_ip(ip, reason="manual_blacklist", ttl_seconds=ttl_seconds)
    entry = BlacklistEntry.objects.filter(ip=ip).first()
    ttl = entry.ttl_seconds if entry else -1
    return JsonResponse({"added": True, "ip": ip, "ttl": ttl})


@endpoint(["POST"])
@api_key_required
def extend_ban(request: HttpRequest) -> JsonResponse:
    ip = str(request.GET.get("ip", "")).strip()
    minutes_raw = request.GET.get("minutes")
    if not ip:
        return JsonResponse({"detail": "ip required"}, status=400)
    try:
        minutes = int(minutes_raw or "0")
    except Exception:
        return JsonResponse({"detail": "minutes must be positive"}, status=400)
    if minutes <= 0:
        return JsonResponse({"detail": "minutes must be positive"}, status=400)

    now = timezone.now()
    entry = BlacklistEntry.objects.filter(ip=ip).first()
    if not entry or (entry.expires_at is not None and entry.expires_at <= now):
        if entry:
            entry.delete()
        return JsonResponse({"detail": "ip not blacklisted"}, status=404)

    entry.expires_at = now + timedelta(minutes=minutes)
    entry.save(update_fields=["expires_at", "updated_at"])
    ttl = max(0, int((entry.expires_at - now).total_seconds()))
    get_sync_redis().set(f"blacklist:{ip}", 1, ex=ttl)
    return JsonResponse({"updated": True, "ip": ip, "ttl": ttl})


@endpoint(["GET"])
@api_key_required
def list_logs(request: HttpRequest) -> JsonResponse:
    redis = get_sync_redis()
    try:
        limit = int(request.GET.get("limit", "200"))
    except Exception:
        limit = 200
    action_filter = (request.GET.get("action") or "").lower() or None

    try:
        logs = []
        next_max = "+"
        target = None if limit <= 0 else limit
        while target is None or len(logs) < target:
            entries = redis.xrevrange(WAF_LOG_STREAM, max=next_max, min="-", count=500)
            if not entries:
                break
            for entry_id, fields in entries:
                entry_id_str = str(entry_id)
                normalized = _normalize_stream_fields(fields)
                if action_filter and normalized.get("action", "").lower() != action_filter:
                    continue
                logs.append({"id": entry_id_str, "fields": normalized})
                if target is not None and len(logs) >= target:
                    break
            next_max = f"({entries[-1][0]}"
        return JsonResponse({"logs": logs})
    except Exception as exc:
        return JsonResponse({"detail": str(exc)}, status=500)


@endpoint(["GET"])
@api_key_required
def get_rpm(request: HttpRequest) -> JsonResponse:
    redis = get_sync_redis()
    domain = request.GET.get("domain", "")
    now = int(time.time())
    since = now - 24 * 60 * 60
    key = f"rpm:series:{domain}"
    try:
        items = redis.zrangebyscore(key, since, now)
        series = []
        for raw in items:
            try:
                payload = json.loads(raw)
                if isinstance(payload, dict) and "ts" in payload and "rpm" in payload:
                    series.append({"ts": int(payload["ts"]), "rpm": int(payload["rpm"])})
            except Exception:
                continue
        return JsonResponse({"domain": domain, "series": series})
    except Exception as exc:
        return JsonResponse({"detail": str(exc)}, status=500)


@endpoint(["GET"])
@api_key_required
def get_anomalies(request: HttpRequest) -> JsonResponse:
    redis = get_sync_redis()
    domain = request.GET.get("domain", "")
    now = int(time.time())
    since = now - 24 * 60 * 60
    key = f"rpm:anomalies:{domain}"
    try:
        items = redis.zrangebyscore(key, since, now)
        anomalies = []
        for raw in items:
            try:
                payload = json.loads(raw)
                if isinstance(payload, dict):
                    anomalies.append(payload)
            except Exception:
                continue
        return JsonResponse({"domain": domain, "anomalies": anomalies})
    except Exception as exc:
        return JsonResponse({"detail": str(exc)}, status=500)


@endpoint(["GET"])
@api_key_required
def list_blacklist(request: HttpRequest) -> JsonResponse:
    try:
        items = []
        for entry in _active_blacklist_entries():
            items.append({"ip": entry.ip, "ttl": _blacklist_ttl(entry)})
        return JsonResponse({"blacklist": items})
    except Exception as exc:
        return JsonResponse({"detail": str(exc)}, status=500)


@endpoint(["GET", "PUT"])
@api_key_required
def settings_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        return JsonResponse({"settings": get_settings_payload(), "profile": get_profile_payload()})

    payload = _json_body(request)
    profile_payload = payload.pop("profile", None)
    known_setting_keys = {
        "allowlist_enabled",
        "honeypot_enabled",
        "bot_ua_enabled",
        "header_inspection_enabled",
        "query_inspection_enabled",
        "body_inspection_enabled",
        "rate_limit_enabled",
        "adaptive_rate_limit_enabled",
        "spike_rate_limit_enabled",
    }
    settings_updates = {key: value for key, value in payload.items() if key in known_setting_keys}
    if settings_updates:
        update_settings(settings_updates)
    if profile_payload is not None and isinstance(profile_payload, dict):
        update_profile(profile_payload)

    return JsonResponse({"settings": get_settings_payload(), "profile": get_profile_payload()})


@endpoint(["GET", "POST"])
@api_key_required
def uptime_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        monitors = [monitor_to_payload(monitor) for monitor in UptimeMonitor.objects.filter(is_active=True)]
        return JsonResponse({"monitors": monitors})

    payload = _json_body(request)
    name = str(payload.get("name", "")).strip()
    url = str(payload.get("url", "")).strip()
    check_type = str(payload.get("check_type", "http")).strip().lower() or "http"
    success_codes = str(payload.get("success_codes", "")).strip()
    if not name:
        return JsonResponse({"detail": "name required"}, status=400)
    if not url:
        return JsonResponse({"detail": "url required"}, status=400)
    if check_type not in ("http", "tcp"):
        return JsonResponse({"detail": "check_type must be http or tcp"}, status=400)

    normalized_url = url
    parsed = urlparse(url if "://" in url else f"tcp://{url}")
    if check_type == "http":
        if "://" not in url:
            normalized_url = f"https://{url}"
            parsed = urlparse(normalized_url)
        if not parsed.scheme or not parsed.netloc:
            return JsonResponse({"detail": "url must be valid"}, status=400)
    if check_type == "tcp" and not parsed.hostname:
        return JsonResponse({"detail": "tcp url must include host"}, status=400)
    if check_type == "http" and success_codes:
        try:
            parse_success_codes(success_codes)
        except ValueError:
            return JsonResponse({"detail": "invalid success codes"}, status=400)

    monitor = UptimeMonitor.objects.create(
        name=name,
        url=normalized_url,
        check_type=check_type,
        success_codes=success_codes if check_type == "http" else "",
        history=[],
        latency_history=[],
        checked_at_history=[],
    )
    with httpx.Client() as client:
        check_and_update(monitor, client, broadcast=True)
    monitor.refresh_from_db()
    return JsonResponse({"monitor": monitor_to_payload(monitor)})


@endpoint(["DELETE"])
@api_key_required
def delete_uptime(request: HttpRequest, monitor_id: UUID) -> JsonResponse:
    deleted, _ = UptimeMonitor.objects.filter(id=monitor_id).delete()
    return JsonResponse({"deleted": bool(deleted), "id": str(monitor_id)})


@endpoint(["GET", "POST"])
@api_key_required
def allowlist_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        ua = list(AllowlistEntry.objects.filter(entry_type="ua").values_list("value", flat=True))
        ip = list(AllowlistEntry.objects.filter(entry_type="ip").values_list("value", flat=True))
        return JsonResponse({"allow": {"ua": ua, "ip": ip}})

    payload = _json_body(request)
    entry_type = str(payload.get("type", "")).strip()
    value = str(payload.get("value", "")).strip()
    if entry_type not in ("ua", "ip"):
        return JsonResponse({"detail": "type must be 'ua' or 'ip'"}, status=400)
    if not value:
        return JsonResponse({"detail": "value required"}, status=400)
    AllowlistEntry.objects.update_or_create(entry_type=entry_type, value=value)
    return JsonResponse({"added": True, "type": entry_type, "value": value})


@endpoint(["POST"])
@api_key_required
def remove_allowlist(request: HttpRequest) -> JsonResponse:
    payload = _json_body(request)
    entry_type = str(payload.get("type", "")).strip()
    value = str(payload.get("value", "")).strip()
    if entry_type not in ("ua", "ip"):
        return JsonResponse({"detail": "type must be 'ua' or 'ip'"}, status=400)
    removed, _ = AllowlistEntry.objects.filter(entry_type=entry_type, value=value).delete()
    return JsonResponse({"removed": bool(removed), "type": entry_type, "value": value})


@endpoint(["GET", "POST"])
@api_key_required
def denylist_view(request: HttpRequest) -> JsonResponse:
    if request.method == "GET":
        ua = list(DenylistEntry.objects.filter(entry_type="ua").values_list("value", flat=True))
        country = list(DenylistEntry.objects.filter(entry_type="country").values_list("value", flat=True))
        return JsonResponse({"deny": {"ua": ua, "country": country}})

    payload = _json_body(request)
    entry_type = str(payload.get("type", "")).strip()
    value = str(payload.get("value", "")).strip()
    if entry_type not in ("ua", "country"):
        return JsonResponse({"detail": "type must be 'ua' or 'country'"}, status=400)
    if entry_type == "country":
        value = value.upper()
    if not value:
        return JsonResponse({"detail": "value required"}, status=400)
    DenylistEntry.objects.update_or_create(entry_type=entry_type, value=value)
    return JsonResponse({"added": True, "type": entry_type, "value": value})


@endpoint(["POST"])
@api_key_required
def remove_denylist(request: HttpRequest) -> JsonResponse:
    payload = _json_body(request)
    entry_type = str(payload.get("type", "")).strip()
    value = str(payload.get("value", "")).strip()
    if entry_type not in ("ua", "country"):
        return JsonResponse({"detail": "type must be 'ua' or 'country'"}, status=400)
    if entry_type == "country":
        value = value.upper()
    if not value:
        return JsonResponse({"detail": "value required"}, status=400)
    removed, _ = DenylistEntry.objects.filter(entry_type=entry_type, value=value).delete()
    return JsonResponse({"removed": bool(removed), "type": entry_type, "value": value})
