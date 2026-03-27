from __future__ import annotations

from typing import Optional

from django.db import transaction

from apps.core.models import ApiCredential, Profile, WafSetting


DEFAULT_PROFILE = {
    "nickname": "Yoshimi Murayama",
    "avatar_url": "",
}


def get_or_create_profile() -> Profile:
    profile, _ = Profile.objects.get_or_create(
        name="default",
        defaults=DEFAULT_PROFILE,
    )
    return profile


def get_or_create_settings() -> WafSetting:
    settings, _ = WafSetting.objects.get_or_create(name="default")
    return settings


def get_active_api_credential() -> Optional[ApiCredential]:
    return ApiCredential.objects.filter(name="default", is_active=True).order_by("-created_at").first()


def get_api_key() -> Optional[str]:
    credential = get_active_api_credential()
    return credential.key if credential else None


@transaction.atomic
def set_api_key(value: str) -> ApiCredential:
    credential = get_active_api_credential()
    if credential:
        credential.key = value
        credential.save(update_fields=["key", "updated_at"])
        return credential
    return ApiCredential.objects.create(name="default", key=value, is_active=True)


def get_profile_payload() -> dict[str, str]:
    profile = get_or_create_profile()
    return {
        "nickname": profile.nickname,
        "avatar_url": profile.avatar_url,
    }


def update_profile(payload: dict) -> dict[str, str]:
    profile = get_or_create_profile()
    nickname = payload.get("nickname")
    avatar_url = payload.get("avatar_url")
    dirty = False
    if nickname is not None:
        profile.nickname = str(nickname).strip()
        dirty = True
    if avatar_url is not None:
        profile.avatar_url = str(avatar_url).strip()
        dirty = True
    if dirty:
        profile.save()
    return get_profile_payload()


def get_settings_payload() -> dict[str, bool]:
    return get_or_create_settings().as_dict()


def update_settings(payload: dict) -> dict[str, bool]:
    settings = get_or_create_settings()
    for key, value in payload.items():
        if hasattr(settings, key):
            setattr(settings, key, bool(value))
    settings.save()
    return settings.as_dict()
