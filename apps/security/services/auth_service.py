from __future__ import annotations

from functools import wraps
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.http import HttpRequest, JsonResponse

from apps.core.services.state_service import get_api_key


def extract_api_key_from_request(request: HttpRequest) -> str | None:
    header_key = request.headers.get("X-API-Key")
    if header_key:
        return header_key
    query_key = request.GET.get("api_key")
    if query_key:
        return query_key
    return None


def api_key_required(view):
    @wraps(view)
    def wrapper(request: HttpRequest, *args, **kwargs):
        expected = get_api_key()
        if not expected:
            return JsonResponse({"detail": "setup required"}, status=403)
        provided = extract_api_key_from_request(request)
        if provided != expected:
            return JsonResponse({"detail": "invalid api key"}, status=401)
        return view(request, *args, **kwargs)

    return wrapper


def is_ws_authorized(scope: dict) -> bool:
    expected = get_api_key()
    if not expected:
        return False

    headers = {key.decode().lower(): value.decode() for key, value in scope.get("headers", [])}
    header_key = headers.get("x-api-key")

    query_string = scope.get("query_string", b"").decode()
    query = parse_qs(query_string)
    query_key = (query.get("api_key") or [None])[0]
    return header_key == expected or query_key == expected


@database_sync_to_async
def is_ws_authorized_async(scope: dict) -> bool:
    return is_ws_authorized(scope)
