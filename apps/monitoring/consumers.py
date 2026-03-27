from __future__ import annotations

import asyncio
import contextlib
import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, AsyncWebsocketConsumer

from apps.core.models import UptimeMonitor
from apps.monitoring.constants import UPTIME_GROUP
from apps.monitoring.services.uptime_service import monitor_to_payload
from apps.security.services.auth_service import is_ws_authorized_async
from apps.security.services.waf_service import WAF_LOG_STREAM
from config.redis import get_async_redis


def _normalize_stream_fields(fields) -> dict:
    if not fields:
        return {}
    if isinstance(fields, dict):
        return {str(k): str(v) for k, v in fields.items()}
    if isinstance(fields, list):
        out = {}
        for pair in fields:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                out[str(pair[0])] = str(pair[1])
        return out
    return {}


class PingConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        await self.send(text_data="pong")
        await self.close()


class LogsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        if not await is_ws_authorized_async(self.scope):
            await self.close(code=1008)
            return
        await self.accept()
        self._last_id = "$"
        self._redis = get_async_redis()
        self._task = asyncio.create_task(self._stream())

    async def disconnect(self, close_code):
        task = getattr(self, "_task", None)
        if task:
            task.cancel()
            with contextlib.suppress(BaseException):
                await task

    async def _stream(self):
        while True:
            entries = await self._redis.xread({WAF_LOG_STREAM: self._last_id}, block=10000, count=100)
            if not entries:
                continue
            for _, messages in entries:
                for entry_id, fields in messages:
                    self._last_id = entry_id
                    normalized = _normalize_stream_fields(fields)
                    if normalized.get("action") != "block":
                        continue
                    entry_id_str = str(entry_id)
                    ts_part = entry_id_str.split("-", 1)[0]
                    payload = {"id": entry_id_str, "ts": int(ts_part), **normalized}
                    await self.send_json(payload)


class UptimeConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        if not await is_ws_authorized_async(self.scope):
            await self.close(code=1008)
            return
        await self.accept()
        await self.channel_layer.group_add(UPTIME_GROUP, self.channel_name)
        snapshot = await self._snapshot_payload()
        await self.send(text_data=json.dumps({"type": "snapshot", "monitors": snapshot}))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(UPTIME_GROUP, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        return

    async def uptime_message(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    @database_sync_to_async
    def _snapshot_payload(self):
        return [monitor_to_payload(monitor) for monitor in UptimeMonitor.objects.filter(is_active=True)]
