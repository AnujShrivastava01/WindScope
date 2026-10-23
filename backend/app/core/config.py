"""Application configuration loaded from environment variables."""

from __future__ import annotations

from datetime import date, time
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    app_name: str = "WindScope API"
    app_version: str = "1.0.0"
    environment: str = Field(default="development", alias="APP_ENV")
    log_level: str = "INFO"

    # Elexon Insights Solution (BMRS) public API. No API key is required.
    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    elexon_timeout_seconds: float = 30.0
    elexon_max_retries: int = 3
    elexon_backoff_seconds: float = 1.0
    elexon_chunk_days: int = 7

    database_path: Path = BACKEND_ROOT / "data" / "windscope.db"

    # Comma separated list of allowed browser origins.
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    cors_origin_regex: str | None = None

    # Procurement decision window required by the challenge (UK local dates).
    decision_date_start: date = date(2026, 1, 1)
    decision_date_end: date = date(2026, 1, 31)

    # Assumed day-ahead decision cutoff. This is a configurable analysis assumption,
    # not an official Elexon or market rule.
    default_cutoff_time: time = time(10, 0)
    default_cutoff_days_before: int = 1

    auto_ingest_on_startup: bool = True
    stale_after_hours: float = 24.0

    @field_validator("default_cutoff_days_before")
    @classmethod
    def _validate_days_before(cls, value: int) -> int:
        if not 1 <= value <= 3:
            raise ValueError("default_cutoff_days_before must be between 1 and 3")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
