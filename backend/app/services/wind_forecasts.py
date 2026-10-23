"""Parsing and normalisation of Elexon WINDFOR forecast records."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from app.services.models import DataSource, ForecastRecord, ParseResult, RejectedRow
from app.utils.numbers import to_finite_float
from app.utils.time import TimestampError, is_settlement_aligned, parse_utc


def parse_windfor_records(
    raw_records: Iterable[Mapping[str, object]],
    *,
    source: DataSource = DataSource.ELEXON_API,
) -> ParseResult[ForecastRecord]:
    """Validate raw WINDFOR rows and de-duplicate by ``(startTime, publishTime)``.

    ``publishTime`` is mandatory: without it the forecast vintage cannot be placed
    relative to a decision cutoff, so such rows are rejected and counted.
    Conflicting duplicates keep the larger value so results are order independent.
    """
    result: ParseResult[ForecastRecord] = ParseResult()
    by_key: dict[tuple[object, object], ForecastRecord] = {}

    for index, raw in enumerate(raw_records, start=1):
        result.received += 1
        if not isinstance(raw, Mapping):
            result.rejected.append(RejectedRow(index, "row is not an object"))
            continue

        if raw.get("startTime") in (None, ""):
            result.rejected.append(RejectedRow(index, "missing startTime", dict(raw)))
            continue
        if raw.get("publishTime") in (None, ""):
            result.missing_publish_time += 1
            result.rejected.append(RejectedRow(index, "missing publishTime", dict(raw)))
            continue
        try:
            start = parse_utc(raw["startTime"])
            publish = parse_utc(raw["publishTime"])
        except TimestampError as exc:
            result.rejected.append(RejectedRow(index, str(exc), dict(raw)))
            continue
        if not is_settlement_aligned(start):
            result.rejected.append(
                RejectedRow(index, "startTime is not aligned to a 30-minute period", dict(raw))
            )
            continue

        generation = to_finite_float(raw.get("generation"))
        if generation is None:
            result.rejected.append(RejectedRow(index, "missing or non-numeric generation", dict(raw)))
            continue
        if generation < 0:
            result.rejected.append(RejectedRow(index, "negative generation", dict(raw)))
            continue

        record = ForecastRecord(start, publish, generation, source)
        key = (start, publish)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = record
            continue
        result.duplicates += 1
        if existing.generation_mw != record.generation_mw:
            result.duplicate_conflicts += 1
        by_key[key] = max(existing, record, key=lambda r: r.generation_mw)

    result.records = sorted(by_key.values(), key=lambda r: (r.start_time, r.publish_time))
    return result
