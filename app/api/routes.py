from urllib.parse import parse_qs, urlparse
from pathlib import Path
import os
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from redis.asyncio.client import Redis
from starlette.responses import JSONResponse

from ..core.security.auth import api_key_required
from ..schemas.waf import WafCheckResponse
from ..services.waf_service import WAF_LOG_STREAM, check_ip, get_waf_settings


class AllowListItem(BaseModel):
    type: str
    value: str


class DenyListItem(BaseModel):
    type: str
    value: str


class BlacklistAdd(BaseModel):
    ip: str
    minutes: int | None = None


class WafSettingsUpdate(BaseModel):
    allowlist_enabled: bool | None = None
    honeypot_enabled: bool | None = None
    bot_ua_enabled: bool | None = None
    header_inspection_enabled: bool | None = None
    query_inspection_enabled: bool | None = None
    body_inspection_enabled: bool | None = None
    rate_limit_enabled: bool | None = None
    adaptive_rate_limit_enabled: bool | None = None
    spike_rate_limit_enabled: bool | None = None


class ProfilePayload(BaseModel):
    nickname: str | None = None
    avatar_url: str | None = None
    target_site_url: str | None = None


class SettingsUpdate(WafSettingsUpdate):
    profile: ProfilePayload | None = None


class SetupPayload(BaseModel):
    api_key: str
    origin: str
    nickname: str
    avatar_url: str


router = APIRouter()


def _decode_value(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode()
    return str(value)


def _normalize_stream_fields(fields) -> dict:
    if not fields:
        return {}
    if isinstance(fields, dict):
        return {_decode_value(key): _decode_value(value) for key, value in fields.items()}
    if isinstance(fields, list):
        out = {}
        for pair in fields:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                key, value = pair
                out[_decode_value(key)] = _decode_value(value)
        return out
    return {}


def _extract_client_ip(request: Request) -> str:
    headers = request.headers
    x_real = headers.get("x-real-ip")
    if x_real:
        return x_real.strip()
    xff = headers.get("x-forwarded-for")
    if xff:
        return xff.split(",", 1)[0].strip()
    client = request.client
    return client.host if client else "unknown"


def _parse_query_params(query: str) -> dict:
    parsed = parse_qs(query)
    out = {}
    for key, value in parsed.items():
        if isinstance(value, list) and value:
            out[key] = value[0]
        elif isinstance(value, str):
            out[key] = value
        else:
            out[key] = ""
    return out


async def _get_profile(redis: Redis) -> dict:
    raw = await redis.get("profile:default")
    if not raw:
        return {
            "nickname": "Hiro Kamori",
            "avatar_url": "",
            "target_site_url": "",
        }
    try:
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode()
        return json.loads(raw)
    except Exception:
        return {
            "nickname": "Hiro Kamori",
            "avatar_url": "",
            "target_site_url": "",
        }


async def _set_profile(redis: Redis, profile: dict) -> None:
    await redis.set("profile:default", json.dumps(profile))


async def _get_api_key(redis: Redis) -> str | None:
    raw = await redis.get("waf:api_key")
    if not raw:
        return None
    return _decode_value(raw)


async def _is_ws_authorized(socket: WebSocket, redis: Redis) -> bool:
    expected = await _get_api_key(redis)
    if not expected:
        return False
    header_key = socket.headers.get("x-api-key")
    query_key = socket.query_params.get("api_key")
    return header_key == expected or query_key == expected


@router.post("/setup")
async def setup(request: Request, payload: SetupPayload) -> JSONResponse:
    redis: Redis = request.app.state.redis
    existing = await _get_api_key(redis)
    if existing:
        return JSONResponse({"configured": True}, status_code=409)

    api_key = payload.api_key.strip()
    origin = payload.origin.strip()
    nickname = payload.nickname.strip()
    avatar_url = payload.avatar_url.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key required")
    if not origin:
        raise HTTPException(status_code=400, detail="origin required")
    if not nickname:
        raise HTTPException(status_code=400, detail="nickname required")
    if not avatar_url:
        raise HTTPException(status_code=400, detail="avatar_url required")

    parsed_origin = urlparse(origin)
    if not parsed_origin.scheme or not parsed_origin.netloc:
        raise HTTPException(status_code=400, detail="origin must be a valid URL")

    profile = {
        "nickname": nickname,
        "avatar_url": avatar_url,
        "target_site_url": origin,
    }
    await redis.set("waf:api_key", api_key)
    await _set_profile(redis, profile)
    await redis.set("waf:origin", origin)
    template_path = Path(os.getenv("NGINX_TEMPLATE_PATH", "/app/nginx/nginx.conf.template"))
    output_path = Path(os.getenv("NGINX_OUTPUT_PATH", "/shared_nginx/waf.conf"))
    template = template_path.read_text(encoding="utf-8")
    rendered = (
        template.replace("{{API_KEY}}", api_key)
        .replace("{{ORIGIN_URL}}", origin)
        .replace("{{ORIGIN_HOST}}", parsed_origin.netloc)
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
    settings = await get_waf_settings(redis)
    return JSONResponse({"configured": True, "profile": profile, "settings": settings})


@router.get("/key/validate")
async def validate_key(request: Request, x_api_key: str | None = Header(None)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    expected = await _get_api_key(redis)
    if not expected:
        return JSONResponse({"configured": False, "valid": False})
    return JSONResponse({"configured": True, "valid": x_api_key == expected})


@router.api_route("/check", methods=["GET", "POST", "HEAD", "OPTIONS"])
async def check_request(request: Request, _=Depends(api_key_required)) -> Response:
    ip = _extract_client_ip(request)
    redis: Redis = request.app.state.redis
    orig_uri = request.headers.get("x-original-uri") or str(request.url)
    parsed = urlparse(orig_uri)
    query_params = _parse_query_params(parsed.query)

    try:
        body = await request.body()
        allowed, reason = await check_ip(
            redis,
            ip,
            path=parsed.path,
            method=request.headers.get("x-original-method") or request.method,
            headers=request.headers,
            query_params=query_params,
            body=body,
        )
        if allowed:
            resp_body = WafCheckResponse(allowed=True, reason=reason).json()
            return Response(
                content=resp_body,
                media_type="application/json",
                status_code=200,
                headers={"X-WAF-Reason": reason or "allowed"},
            )
        resp_body = WafCheckResponse(allowed=False, reason=reason).json()
        return Response(
            content=resp_body,
            media_type="application/json",
            status_code=403,
            headers={"X-WAF-Reason": reason or "blocked"},
        )
    except Exception:
        body = WafCheckResponse(allowed=True, reason="redis_error").json()
        return Response(content=body, media_type="application/json", status_code=200)


@router.post("/unban")
async def unban_ip(request: Request, ip: str | None = None, _=Depends(api_key_required)) -> JSONResponse:
    target_ip = ip or _extract_client_ip(request)
    redis: Redis = request.app.state.redis

    try:
        deleted = await redis.delete(f"blacklist:{target_ip}", f"rate:{target_ip}")
        return JSONResponse({"unbanned": True if deleted else False, "ip": target_ip})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/blacklist/add")
async def add_blacklist(request: Request, payload: BlacklistAdd, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    ip = payload.ip
    if not ip:
        raise HTTPException(status_code=400, detail="ip required")
    minutes = payload.minutes
    try:
        if minutes and minutes > 0:
            await redis.set(f"blacklist:{ip}", 1, ex=minutes * 60)
        else:
            await redis.set(f"blacklist:{ip}", 1)
        await redis.delete(f"rate:{ip}")
        ttl = await redis.ttl(f"blacklist:{ip}")
        return JSONResponse({"added": True, "ip": ip, "ttl": ttl})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/ban/extend")
async def extend_ban(request: Request, ip: str, minutes: int, _=Depends(api_key_required)) -> JSONResponse:
    if minutes <= 0:
        raise HTTPException(status_code=400, detail="minutes must be positive")
    redis: Redis = request.app.state.redis
    key = f"blacklist:{ip}"
    try:
        exists = await redis.exists(key)
        if not exists:
            raise HTTPException(status_code=404, detail="ip not blacklisted")
        seconds = minutes * 60
        await redis.expire(key, seconds)
        ttl = await redis.ttl(key)
        return JSONResponse({"updated": True, "ip": ip, "ttl": ttl})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/logs")
async def list_logs(request: Request, limit: int = 200, action: str | None = None, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        action_filter = action.lower() if action else None
        logs = []
        next_max = "+"
        target = None if limit <= 0 else limit
        while target is None or len(logs) < target:
            entries = await redis.xrevrange(WAF_LOG_STREAM, max=next_max, min="-", count=500)
            if not entries:
                break
            for entry_id, fields in entries:
                entry_id_str = _decode_value(entry_id)
                normalized = _normalize_stream_fields(fields)
                if action_filter and normalized.get("action", "").lower() != action_filter:
                    continue
                logs.append({"id": entry_id_str, "fields": normalized})
                if target is not None and len(logs) >= target:
                    break
            next_max = f"({_decode_value(entries[-1][0])}"
        return JSONResponse({"logs": logs})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/blacklist")
async def list_blacklist(request: Request, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        items = []
        async for key in redis.scan_iter(match="blacklist:*"):
            ip = _decode_value(key).split(":", 1)[1]
            ttl = await redis.ttl(key)
            items.append({"ip": ip, "ttl": ttl})

        return JSONResponse({"blacklist": items})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/settings")
async def get_settings(request: Request, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        settings = await get_waf_settings(redis)
        profile = await _get_profile(redis)
        return JSONResponse({"settings": settings, "profile": profile})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.put("/settings")
async def update_settings(request: Request, update: SettingsUpdate, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        payload = update.model_dump(exclude_unset=True)
        profile_payload = payload.pop("profile", None)
        if payload:
            for key, value in payload.items():
                await redis.hset("waf:settings", key, "1" if value else "0")
        if profile_payload is not None:
            current = await _get_profile(redis)
            current.update({k: v for k, v in profile_payload.items() if v is not None})
            await _set_profile(redis, current)
        settings = await get_waf_settings(redis)
        profile = await _get_profile(redis)
        return JSONResponse({"settings": settings, "profile": profile})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.websocket("/ws/logs")
async def stream_logs(socket: WebSocket) -> None:
    await socket.accept()
    redis: Redis = socket.app.state.redis
    if not await _is_ws_authorized(socket, redis):
        await socket.close(code=1008)
        return

    last_id = "$"

    try:
        while True:
            entries = await redis.xread({WAF_LOG_STREAM: last_id}, block=10000, count=100)
            if not entries:
                continue
            for _, messages in entries:
                for entry_id, fields in messages:
                    last_id = entry_id
                    normalized = _normalize_stream_fields(fields)
                    if normalized.get("action") != "block":
                        continue
                    entry_id_str = _decode_value(entry_id)
                    ts_part = entry_id_str.split("-", 1)[0]
                    payload = {"id": entry_id_str, "ts": int(ts_part), **normalized}
                    await socket.send_json(payload)
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await socket.close(code=1011)
        except Exception:
            return


@router.post("/allowlist")
async def add_allowlist(request: Request, item: AllowListItem, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    if item.type not in ("ua", "ip"):
        raise HTTPException(status_code=400, detail="type must be 'ua' or 'ip'")
    try:
        key = f"allow:{item.type}"
        await redis.sadd(key, item.value)
        return JSONResponse({"added": True, "type": item.type, "value": item.value})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/allowlist/remove")
async def remove_allowlist(request: Request, item: AllowListItem, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    if item.type not in ("ua", "ip"):
        raise HTTPException(status_code=400, detail="type must be 'ua' or 'ip'")
    try:
        key = f"allow:{item.type}"
        removed = await redis.srem(key, item.value)
        return JSONResponse({"removed": True if removed else False, "type": item.type, "value": item.value})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/denylist")
async def add_denylist(request: Request, item: DenyListItem, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    if item.type not in ("ua", "country"):
        raise HTTPException(status_code=400, detail="type must be 'ua' or 'country'")
    try:
        key = f"deny:{item.type}"
        await redis.sadd(key, item.value)
        return JSONResponse({"added": True, "type": item.type, "value": item.value})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/denylist/remove")
async def remove_denylist(request: Request, item: DenyListItem, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    if item.type not in ("ua", "country"):
        raise HTTPException(status_code=400, detail="type must be 'ua' or 'country'")
    try:
        key = f"deny:{item.type}"
        removed = await redis.srem(key, item.value)
        return JSONResponse({"removed": True if removed else False, "type": item.type, "value": item.value})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/allowlist")
async def list_allowlist(request: Request, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        ua = [_decode_value(v) async for v in redis.sscan_iter("allow:ua")]
        ip = [_decode_value(v) async for v in redis.sscan_iter("allow:ip")]
        return JSONResponse({"allow": {"ua": ua, "ip": ip}})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/denylist")
async def list_denylist(request: Request, _=Depends(api_key_required)) -> JSONResponse:
    redis: Redis = request.app.state.redis
    try:
        ua = [_decode_value(v) async for v in redis.sscan_iter("deny:ua")]
        country = [_decode_value(v) async for v in redis.sscan_iter("deny:country")]
        return JSONResponse({"deny": {"ua": ua, "country": country}})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
