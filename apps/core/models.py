from __future__ import annotations

from typing import final
from uuid import uuid4

from django.db import models
from django.utils import timezone


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ApiCredential(BaseModel):
    name = models.CharField(max_length=32, unique=True, default="default")
    key = models.CharField(max_length=255, unique=True)
    is_active = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"ApiCredential<{self.name}>"

    @property
    def masked_key(self) -> str:
        if len(self.key) <= 8:
            return self.key
        return f"{self.key[:4]}...{self.key[-4:]}"


class Profile(BaseModel):
    name = models.CharField(max_length=32, unique=True, default="default")
    nickname = models.CharField(max_length=120)
    avatar_url = models.TextField(blank=True, default="")

    def __str__(self) -> str:
        return self.nickname


class WafSetting(BaseModel):
    name = models.CharField(max_length=32, unique=True, default="default")
    allowlist_enabled = models.BooleanField(default=True)
    honeypot_enabled = models.BooleanField(default=True)
    bot_ua_enabled = models.BooleanField(default=True)
    header_inspection_enabled = models.BooleanField(default=True)
    query_inspection_enabled = models.BooleanField(default=True)
    body_inspection_enabled = models.BooleanField(default=True)
    rate_limit_enabled = models.BooleanField(default=True)
    adaptive_rate_limit_enabled = models.BooleanField(default=True)
    spike_rate_limit_enabled = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"WafSetting<{self.name}>"

    @final
    def as_dict(self) -> dict[str, bool]:
        return {
            "allowlist_enabled": self.allowlist_enabled,
            "honeypot_enabled": self.honeypot_enabled,
            "bot_ua_enabled": self.bot_ua_enabled,
            "header_inspection_enabled": self.header_inspection_enabled,
            "query_inspection_enabled": self.query_inspection_enabled,
            "body_inspection_enabled": self.body_inspection_enabled,
            "rate_limit_enabled": self.rate_limit_enabled,
            "adaptive_rate_limit_enabled": self.adaptive_rate_limit_enabled,
            "spike_rate_limit_enabled": self.spike_rate_limit_enabled,
        }


class ProtectedDomain(BaseModel):
    domain = models.CharField(max_length=255, unique=True, db_index=True)
    origin = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["domain"]

    def __str__(self) -> str:
        return f"{self.domain} -> {self.origin}"


class AllowlistEntryType(models.TextChoices):
    IP = "ip", "IP"
    UA = "ua", "User Agent"


class AllowlistEntry(BaseModel):
    entry_type = models.CharField(max_length=16, choices=AllowlistEntryType.choices)
    value = models.CharField(max_length=255, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["entry_type", "value"], name="uniq_allowlist_entry"),
        ]
        ordering = ["entry_type", "value"]

    def __str__(self) -> str:
        return f"Allow<{self.entry_type}:{self.value}>"


class DenylistEntryType(models.TextChoices):
    UA = "ua", "User Agent"
    COUNTRY = "country", "Country"


class DenylistEntry(BaseModel):
    entry_type = models.CharField(max_length=16, choices=DenylistEntryType.choices)
    value = models.CharField(max_length=255, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["entry_type", "value"], name="uniq_denylist_entry"),
        ]
        ordering = ["entry_type", "value"]

    def __str__(self) -> str:
        return f"Deny<{self.entry_type}:{self.value}>"


class BlacklistEntry(BaseModel):
    ip = models.CharField(max_length=64, db_index=True)
    reason = models.CharField(max_length=128, blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["ip"], name="uniq_blacklist_ip"),
        ]

    def __str__(self) -> str:
        return f"Blacklist<{self.ip}>"

    @property
    def is_active(self) -> bool:
        if self.expires_at is None:
            return True
        return self.expires_at > timezone.now()

    @property
    def ttl_seconds(self) -> int:
        if self.expires_at is None:
            return -1
        delta = int((self.expires_at - timezone.now()).total_seconds())
        return max(0, delta)


class WafLogAction(models.TextChoices):
    ALLOW = "allow", "Allow"
    BLOCK = "block", "Block"


class WafLogEvent(BaseModel):
    stream_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    ip = models.CharField(max_length=64, db_index=True)
    action = models.CharField(max_length=16, choices=WafLogAction.choices)
    reason = models.CharField(max_length=128, blank=True, default="")
    method = models.CharField(max_length=16, blank=True, default="")
    path = models.CharField(max_length=512, blank=True, default="")
    user_agent = models.CharField(max_length=512, blank=True, default="")
    country = models.CharField(max_length=8, blank=True, default="")
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action.upper()} {self.ip} {self.reason}"


class UptimeCheckType(models.TextChoices):
    HTTP = "http", "HTTP"
    TCP = "tcp", "TCP"


class UptimeMonitor(BaseModel):
    name = models.CharField(max_length=120)
    url = models.CharField(max_length=255)
    check_type = models.CharField(max_length=16, choices=UptimeCheckType.choices, default=UptimeCheckType.HTTP)
    success_codes = models.CharField(max_length=255, blank=True, default="")
    history = models.JSONField(default=list, blank=True)
    latency_history = models.JSONField(default=list, blank=True)
    checked_at_history = models.JSONField(default=list, blank=True)
    last_status = models.IntegerField(null=True, blank=True)
    last_latency = models.IntegerField(null=True, blank=True)
    checked_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "created_at"]

    def __str__(self) -> str:
        return f"Uptime<{self.name}>"
