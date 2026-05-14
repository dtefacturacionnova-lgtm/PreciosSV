"""
app/core/config.py
Configuración central usando Pydantic Settings.
Lee variables desde .env automáticamente.
"""
from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Aplicación ───────────────────────────────────────────
    app_env: str = "development"
    app_name: str = "PrecioSV"
    app_version: str = "1.0.0"
    secret_key: str = "dev-secret-key"
    debug: bool = True

    # ── Base de datos ────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://preciosv:preciosv123@localhost:5432/preciosv_db"
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # ── Redis & Celery ───────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ── Scraping ─────────────────────────────────────────────
    scraper_delay_seconds: float = 1.5
    scraper_max_retries: int = 3
    scraper_timeout_seconds: int = 30
    scraper_headless: bool = True

    # ── IA ───────────────────────────────────────────────────
    anthropic_api_key: str = ""
    matching_model: str = "claude-sonnet-4-6"
    matching_enabled: bool = True

    # ── Email ────────────────────────────────────────────────
    sendgrid_api_key: str = ""
    email_from: str = "alertas@preciosv.com"
    email_from_name: str = "PrecioSV"

    # ── CORS ─────────────────────────────────────────────────
    allowed_origins: List[str] = ["http://localhost:3000"]

    # ── Scheduler ────────────────────────────────────────────
    scrape_interval_hours: int = 6
    scrape_start_hour: int = 0

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache()
def get_settings() -> Settings:
    """Singleton: la configuración se lee una sola vez."""
    return Settings()


settings = get_settings()
