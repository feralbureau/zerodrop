from contextlib import asynccontextmanager
import contextlib
import asyncio
from typing import AsyncGenerator
import logging
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from .core.config import settings
from .core.redis import create_redis_client, close_redis_client
from redis.asyncio.client import Redis
from .services.uptime_service import run_uptime_loop
from .services.anomaly_service import run_anomaly_loop
from .api.routes import _apply_caddy_config, _get_api_key


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
	"""Менеджер health циклу: створює кліент Redis при запуску i закриває при завершенні"""

	# configure basic logging so `waf` logger outputs to the uvicorn terminal
	root_logger = logging.getLogger()
	if not root_logger.handlers:
		handler = logging.StreamHandler(sys.stdout)
		formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
		handler.setFormatter(formatter)
		root_logger.addHandler(handler)
	root_logger.setLevel(logging.INFO)
	logging.getLogger("waf").setLevel(logging.INFO)

	# optimized redis client and attach to app.state
	app.state.redis: Redis = create_redis_client()

	# validate connectivity early with a timeout
	try:
		await asyncio.wait_for(app.state.redis.ping(), timeout=2.0)
	except Exception:
		await close_redis_client(app.state.redis)
		raise

	# reaply after reload cuz caddy is retarded
	try:
		existing_key = await _get_api_key(app.state.redis)
		await _apply_caddy_config(app.state.redis, existing_key)
	except Exception as exc:
		logging.getLogger("waf").warning("caddy sync on startup failed: %s", exc)

	app.state.uptime_clients = set()
	app.state.uptime_task = asyncio.create_task(run_uptime_loop(app))
	app.state.anomaly_task = asyncio.create_task(run_anomaly_loop(app))

	try:
		yield
	finally:
		uptime_task = getattr(app.state, "uptime_task", None)
		if uptime_task:
			uptime_task.cancel()
			with contextlib.suppress(Exception):
				await uptime_task
		anomaly_task = getattr(app.state, "anomaly_task", None)
		if anomaly_task:
			anomaly_task.cancel()
			with contextlib.suppress(Exception):
				await anomaly_task
		await close_redis_client(app.state.redis)


app = FastAPI(lifespan=lifespan)
app.add_middleware(
	CORSMiddleware,
	allow_origins=[
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# підключаємо WAF маршрути
from .api import routes as waf_routes

# mount waf routes under /api so nginx can call /api/check
app.include_router(waf_routes.router, prefix="/api", tags=["waf"])


@app.get("/health")
async def health() -> JSONResponse:
	"""Эндпоінт перевірки стану, який виконує пiнг до Redis і повертає статус"""

	redis: Redis = getattr(app.state, "redis", None)
	if redis is None:
		raise HTTPException(status_code=503, detail="redis not initialized")

	try:
		ok = await asyncio.wait_for(redis.ping(), timeout=1.0)
		return JSONResponse({"redis": "ok" if ok else "fail"})
	except Exception as exc:
		return JSONResponse({"redis": "fail", "detail": str(exc)}, status_code=503)


__all__ = ["app"]
