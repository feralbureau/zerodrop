from __future__ import annotations

import time

import httpx
from django.core.management.base import BaseCommand

from apps.monitoring.services.anomaly_service import ANOMALY_INTERVAL, run_anomaly_tick
from apps.monitoring.services.uptime_service import CHECK_INTERVAL, run_uptime_tick


class Command(BaseCommand):
    help = "Run uptime and anomaly background loops."

    def handle(self, *args, **options):
        self.stdout.write("Starting monitoring loops")
        next_uptime = 0.0
        next_anomaly = 0.0
        with httpx.Client() as client:
            while True:
                now = time.time()
                if now >= next_uptime:
                    run_uptime_tick(client)
                    next_uptime = now + CHECK_INTERVAL
                if now >= next_anomaly:
                    run_anomaly_tick()
                    next_anomaly = now + ANOMALY_INTERVAL
                time.sleep(1)
