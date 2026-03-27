from __future__ import annotations

from django.test import TestCase

from apps.core.models import BlacklistEntry, DenylistEntry, WafSetting
from apps.security.services import waf_service


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.streams = []
        self._counter = 0

    def xadd(self, key, fields):
        self._counter += 1
        stream_id = f"{self._counter}-0"
        self.streams.append((stream_id, fields))
        return stream_id

    def exists(self, key):
        return 1 if key in self.values else 0

    def set(self, key, value, ex=None):
        self.values[key] = str(value)

    def delete(self, *keys):
        removed = 0
        for key in keys:
            if key in self.values:
                removed += 1
                del self.values[key]
        return removed

    def get(self, key):
        return self.values.get(key)

    def evalsha(self, *args, **kwargs):
        raise RuntimeError("not implemented in fake")

    def script_load(self, script):
        return "sha"

    def eval(self, *args, **kwargs):
        key = args[2]
        count = int(self.values.get(key, "0")) + 1
        self.values[key] = str(count)
        return count


class WafServiceTests(TestCase):
    def setUp(self):
        self.fake_redis = FakeRedis()
        self._old_get_sync_redis = waf_service.get_sync_redis
        waf_service.get_sync_redis = lambda: self.fake_redis
        WafSetting.objects.create(
            name="default",
            rate_limit_enabled=False,
            adaptive_rate_limit_enabled=False,
            spike_rate_limit_enabled=False,
        )

    def tearDown(self):
        waf_service.get_sync_redis = self._old_get_sync_redis

    def test_denylist_country_blocks(self):
        DenylistEntry.objects.create(entry_type="country", value="UA")
        allowed, reason = waf_service.check_ip(
            "8.8.8.8",
            path="/",
            method="GET",
            headers={"user-agent": "Mozilla/5.0", "cf-ipcountry": "UA"},
            query_params={},
            body=b"",
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "denylist_country")

    def test_malicious_query_blacklists_ip(self):
        allowed, reason = waf_service.check_ip(
            "9.9.9.9",
            path="/",
            method="GET",
            headers={"user-agent": "Mozilla/5.0"},
            query_params={"q": "1 or 1=1"},
            body=b"",
        )
        self.assertFalse(allowed)
        self.assertEqual(reason, "malicious_query")
        self.assertTrue(BlacklistEntry.objects.filter(ip="9.9.9.9").exists())
