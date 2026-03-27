from __future__ import annotations

from typing import Optional

import redis
import redis.asyncio as aioredis
from django.conf import settings


_sync_client: Optional[redis.Redis] = None
_async_client: Optional[aioredis.Redis] = None


def get_sync_redis() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            health_check_interval=30,
            socket_connect_timeout=5,
        )
    return _sync_client


def get_async_redis() -> aioredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            health_check_interval=30,
            socket_connect_timeout=5,
        )
    return _async_client
