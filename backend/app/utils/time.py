"""Timezone helpers.

All timestamps are stored and compared as timezone-aware UTC values. UK local
time (Europe/London) is used only to define delivery days, decision cutoffs and
for display. Settlement days follow UK local midnight, so a day contains 46
periods on the spring clock change and 50 on the autumn clock change.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")
SETTLEMENT_PERIOD = timedelta(minutes=30)


class TimestampError(ValueError):
    """Raised when a timestamp cannot be parsed into a valid UTC instant."""


def parse_utc(value: object) -> datetime:
    """Parse an ISO-8601 timestamp into an aware UTC datetime.

    Values without an explicit offset are interpreted as UTC, matching the
    Elexon API convention (timestamps carry a trailing ``Z``).
    """
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise TimestampError("empty timestamp")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError as exc:
            raise TimestampError(f"invalid timestamp: {value!r}") from exc
    else:
        raise TimestampError(f"invalid timestamp: {value!r}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_iso_z(dt: datetime) -> str:
    """Serialise an aware datetime as ``YYYY-MM-DDTHH:MM:SSZ`` (UTC)."""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_settlement_aligned(dt: datetime) -> bool:
    return dt.second == 0 and dt.microsecond == 0 and dt.minute in (0, 30)


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    """Return the UTC [start, end) instants of a UK local calendar day."""
    start = datetime.combine(day, time(0, 0), tzinfo=UK_TZ).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=UK_TZ).astimezone(UTC)
    return start, end


def settlement_periods(day: date) -> list[datetime]:
    """UTC start times of every settlement period in a UK local day (46/48/50)."""
    start, end = local_day_bounds(day)
    count = int((end - start) / SETTLEMENT_PERIOD)
    return [start + i * SETTLEMENT_PERIOD for i in range(count)]


def local_cutoff(delivery_day: date, cutoff_time: time, days_before: int) -> datetime:
    """UTC instant of the decision cutoff for a delivery day.

    The cutoff is expressed in UK local time on ``delivery_day - days_before``.
    """
    decision_day = delivery_day - timedelta(days=days_before)
    return datetime.combine(decision_day, cutoff_time, tzinfo=UK_TZ).astimezone(UTC)


def to_uk(dt: datetime) -> datetime:
    return dt.astimezone(UK_TZ)


def is_finite_number(value: object) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    return False
