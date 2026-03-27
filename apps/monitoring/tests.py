from __future__ import annotations

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.test import SimpleTestCase

from config.asgi import application


class WebsocketTests(SimpleTestCase):
    def test_ping_socket_returns_pong(self):
        async def scenario():
            communicator = WebsocketCommunicator(application, "/api/ws/ping")
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            payload = await communicator.receive_from()
            self.assertEqual(payload, "pong")
            await communicator.disconnect()

        async_to_sync(scenario)()
