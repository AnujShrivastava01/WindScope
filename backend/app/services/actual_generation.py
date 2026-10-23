"""Parsing and normalisation of Elexon FUELHH actual generation records."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from app.services.models import ActualRecord, DataSource, ParseResult, RejectedRow
from app.utils.numbers import to_finite_float
from app.utils.time import TimestampError, is_finite_number, is_settlement_aligned, parse_utc

WIND_FUEL_TYPE = "WIND"


def parse_fuelhh_records(
    raw_records: Iterable[Mapping[str, object]],
    *,
    source: DataSource = DataSource.ELEXON_API,
    require_fuel_type: bool = True,
) -> ParseResult[ActualRecord]:
    """Validate raw FUELHH rows, keep only WIND, and de-duplicate by ``startTime``.

    Duplicate rows for the same target period are resolved deterministically: the
    row with the latest ``publishTime`` wins; if publish times are equal the larger
    generation value wins so the outcome never depends on input order.
    """
    result: ParseResult[ActualRecord] = ParseResult()
    by_start: dict[object, ActualRecord] = {}

    for index, raw in enumerate(raw_records, start=1):
        result.received += 1
        if not isinstance(raw, Mapping):
            result.rejected.append(RejectedRow(index, "row is not an object"))
            continue

        fuel = raw.get("fuelType")
        if fuel is None or (isinstance(fuel, str) and not fuel.strip()):
            if require_fuel_type:
                result.rejected.append(RejectedRow(index, "missing fuelType", dict(raw)))
                continue
        elif str(fuel).strip().upper() != WIND_FUEL_TYPE:
            result.filtered_out += 1
            continue

        if raw.get("startTime") in (None, ""):
            result.rejected.append(RejectedRow(index, "missing startTime", dict(raw)))
            continue
        try:
            start = parse_utc(raw["startTime"])
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

        publish = None
        if raw.get("publishTime") not in (None, ""):
            try:
                publish = parse_utc(raw["publishTime"])
            except TimestampError as exc:
                result.rejected.append(RejectedRow(index, f"publishTime: {exc}", dict(raw)))
                continue

        period = raw.get("settlementPeriod")
        record = ActualRecord(
            start_time=start,
            generation_mw=generation,
            settlement_date=str(raw["settlementDate"]) if raw.get("settlementDate") else None,
            settlement_period=int(period) if is_finite_number(period) else None,
            publish_time=publish,
            source=source,
        )

        existing = by_start.get(start)
        if existing is None:
            by_start[start] = record
            continue
        result.duplicates += 1
        if existing.generation_mw != record.generation_mw:
            result.duplicate_conflicts += 1
        by_start[start] = max(existing, record, key=_actual_rank)

    result.records = sorted(by_start.values(), key=lambda r: r.start_time)
    return result


def _actual_rank(record: ActualRecord) -> tuple[float, float]:
    publish = record.publish_time.timestamp() if record.publish_time else float("-inf")
    return (publish, record.generation_mw)
