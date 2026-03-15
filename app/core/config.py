from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
	"""Налаштування, завантажені з енваермента за допомогою pydantic settings
    `REDIS_URL` чекаэ URL у форматі redis://, сумісний з функцією `redis.asyncio.from_url`.
	"""

	REDIS_URL: str = "redis://localhost:6379/0"
	API_KEY: Optional[str] = None

	model_config = SettingsConfigDict(env_prefix="")

# singleton
settings = Settings()

__all__ = ["Settings", "settings"]
