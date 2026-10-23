"""Normalised domain records shared by ingestion, persistence and analysis."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class DataSource(StrEnum):
    ELEXON_API = "elexon_api"
    CSV_IMPORT = "csv_import"


@dataclass(frozen=True, slots=True)
class ActualRecord:
    """One FUELHH WIND half-hourly outturn value (average MW over the period)."""

    start_time: datetime
    generation_mw: float
    settlement_date: str | None = None
    settlement_period: int | None = None
    publish_time: datetime | None = None
    source: DataSource = DataSource.ELEXON_API


@dataclass(frozen=True, slots=True)
class ForecastRecord:
    """One WINDFOR forecast value for a target time from a specific publication."""

    start_time: datetime
    publish_time: datetime
    generation_mw: float
    source: DataSource = DataSource.ELEXON_API


@dataclass(frozen=True, slots=True)
class RejectedRow:
    row: int
    reason: str
    raw: dict[str, object] | None = None


@dataclass(slots=True)
class ParseResult[T]:
    records: list[T] = field(default_factory=list)
    rejected: list[RejectedRow] = field(default_factory=list)
    received: int = 0
    filtered_out: int = 0
    duplicates: int = 0
    duplicate_conflicts: int = 0
    missing_publish_time: int = 0

    @property
    def rejected_count(self) -> int:
        return len(self.rejected)
