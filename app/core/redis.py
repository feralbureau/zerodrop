from typing import Optional

import redis.asyncio as aioredis
from redis.asyncio.client import Redis

from .config import settings


def create_redis_client(url: Optional[str] = None, *, max_connections: int = 50, **kwargs) -> Redis:
	"""Створює клієнт `redis.asyncio.Redis` з умними налаштуваннями

	Використовує `redis.asyncio.from_url`, який надає ефективний пул коннекшинiв
	та асинхронний АПI. Налаштування (розмір пулу, таймаути) можна передати
	через `kwargs`.
	"""

	url = url or settings.REDIS_URL

	client: Redis = aioredis.from_url(
		url,
		decode_responses=True,
		max_connections=max_connections,
		health_check_interval=30,
		socket_connect_timeout=5,
		**kwargs,
	)

	return client


async def close_redis_client(client: Optional[Redis]) -> None:
	"""Акуратно закриває клієнт Redis та його пул коннектiв."""
	if not client:
		return
	try:
		await client.close()
	finally:
		# besteffort disconnect the pool
		try:
			await client.connection_pool.disconnect()
		except Exception:
			pass


__all__ = ["create_redis_client", "close_redis_client"]
