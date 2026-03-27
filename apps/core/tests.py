from __future__ import annotations

import json
from unittest.mock import patch

from django.test import TestCase

from apps.core.models import BlacklistEntry, ProtectedDomain, Profile, WafSetting
from apps.core.services.state_service import get_api_key


class _FakeRedis:
    def __init__(self):
        self.values = {}

    def set(self, key, value, ex=None):
        self.values[key] = str(value)

    def delete(self, *keys):
        removed = 0
        for key in keys:
            if key in self.values:
                removed += 1
                del self.values[key]
        return removed

    def exists(self, key):
        return 1 if key in self.values else 0

    def xadd(self, key, fields):
        return "1-0"

    def get(self, key):
        return self.values.get(key)

    def evalsha(self, *args, **kwargs):
        raise RuntimeError("sha not loaded")

    def script_load(self, script):
        return "sha"

    def eval(self, *args, **kwargs):
        key = args[2]
        value = int(self.values.get(key, "0")) + 1
        self.values[key] = str(value)
        return value


class ModelTests(TestCase):
    def test_profile_and_settings_have_metadata(self):
        profile = Profile.objects.create(name="default", nickname="Zero", avatar_url="")
        settings = WafSetting.objects.create(name="default")
        self.assertIsNotNone(profile.created_at)
        self.assertIsNotNone(profile.updated_at)
        self.assertIsNotNone(settings.created_at)
        self.assertIsNotNone(settings.updated_at)
        self.assertEqual(str(profile), "Zero")
        self.assertIn("allowlist_enabled", settings.as_dict())


class ApiContractTests(TestCase):
    @patch("apps.core.views.apply_caddy_config")
    def test_setup_and_validate_contract(self, mock_apply):
        payload = {
            "api_key": "abc123",
            "domain": "example.com",
            "origin": "https://origin.example.com",
            "nickname": "Tester",
            "avatar_url": "https://img.test/avatar.png",
        }
        response = self.client.post("/api/setup", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["configured"])
        self.assertEqual(data["profile"]["nickname"], "Tester")
        self.assertEqual(get_api_key(), "abc123")

        response = self.client.get("/api/key/validate", HTTP_X_API_KEY="abc123")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["valid"])
        mock_apply.assert_called()

    @patch("apps.core.views.apply_caddy_config")
    @patch("apps.core.views.record_request")
    @patch("apps.core.views.check_ip", return_value=(False, "test_block"))
    def test_check_endpoint_keeps_contract(self, mock_check, mock_record, mock_apply):
        setup_payload = {
            "api_key": "abc123",
            "domain": "example.com",
            "origin": "https://origin.example.com",
            "nickname": "Tester",
            "avatar_url": "https://img.test/avatar.png",
        }
        self.client.post("/api/setup", data=json.dumps(setup_payload), content_type="application/json")
        response = self.client.get(
            "/api/check?api_key=abc123",
            HTTP_X_FORWARDED_HOST="example.com",
            HTTP_X_ORIGINAL_URI="/.env",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.headers["X-WAF-Reason"], "test_block")
        mock_check.assert_called()
        mock_record.assert_called()

    @patch("apps.core.views.apply_caddy_config")
    def test_domains_contract(self, mock_apply):
        payload = {
            "api_key": "abc123",
            "domain": "example.com",
            "origin": "https://origin.example.com",
            "nickname": "Tester",
            "avatar_url": "https://img.test/avatar.png",
        }
        self.client.post("/api/setup", data=json.dumps(payload), content_type="application/json")
        response = self.client.post(
            "/api/domains",
            data=json.dumps({"domain": "new.example.com", "origin": "https://new-origin.example.com"}),
            content_type="application/json",
            HTTP_X_API_KEY="abc123",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["added"])
        self.assertTrue(ProtectedDomain.objects.filter(domain="new.example.com").exists())

        response = self.client.get("/api/domains", HTTP_X_API_KEY="abc123")
        self.assertEqual(response.status_code, 200)
        self.assertIn("domains", response.json())

    @patch("apps.core.views.apply_caddy_config")
    @patch("apps.security.services.waf_service.get_sync_redis")
    def test_blacklist_contract(self, mock_get_redis, mock_apply):
        mock_get_redis.return_value = _FakeRedis()
        payload = {
            "api_key": "abc123",
            "domain": "example.com",
            "origin": "https://origin.example.com",
            "nickname": "Tester",
            "avatar_url": "https://img.test/avatar.png",
        }
        self.client.post("/api/setup", data=json.dumps(payload), content_type="application/json")
        response = self.client.post(
            "/api/blacklist/add",
            data=json.dumps({"ip": "1.2.3.4", "minutes": 60}),
            content_type="application/json",
            HTTP_X_API_KEY="abc123",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["added"])
        self.assertTrue(BlacklistEntry.objects.filter(ip="1.2.3.4").exists())
