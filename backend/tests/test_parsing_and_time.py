"""Elexon payload parsing, WIND filtering and timestamp normalisation (synthetic)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time

import pytest

from app.services.actual_generation import parse_fuelhh_records
from app.services.wind_forecasts import parse_windfor_records
from app.utils.time import TimestampError, local_cutoff, parse_utc, settlement_periods


class TestTime:
    def test_parse_z_suffix_and_offsets(self):
        assert parse_utc("2026-01-02T10:00:00Z") == datetime(2026, 1, 2, 10, tzinfo=UTC)
        assert parse_utc("2026-07-02T11:00:00+01:00") == datetime(2026, 7, 2, 10, tzinfo=UTC)
        assert parse_utc("2026-01-02T10:00:00") == datetime(2026, 1, 2, 10, tzinfo=UTC)

    @pytest.mark.parametrize("bad", ["", "yesterday", "2026-13-01T00:00:00Z", None, 123])
    def test_invalid_timestamps(self, bad):
        with pytest.raises(TimestampError):
            parse_utc(bad)

    def test_settlement_day_lengths(self):
        assert len(settlement_periods(date(2026, 1, 15))) == 48
        assert len(settlement_periods(date(2026, 3, 29))) == 46
        assert len(settlement_periods(date(2026, 10, 25))) == 50
        assert settlement_periods(date(2026, 6, 1))[0] == datetime(2026, 5, 31, 23, tzinfo=UTC)

    def test_local_cutoff(self):
        assert local_cutoff(date(2026, 1, 2), time(10), 1) == datetime(2026, 1, 1, 10, tzinfo=UTC)
        assert local_cutoff(date(2026, 6, 2), time(10), 1) == datetime(2026, 6, 1, 9, tzinfo=UTC)


class TestFuelhh:
    def test_parses_and_filters_wind(self):
        raw = [
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": 1000,
             "settlementDate": "2026-01-02", "settlementPeriod": 1, "publishTime": "2026-01-02T00:30:00Z"},
            {"fuelType": "CCGT", "startTime": "2026-01-02T00:00:00Z", "generation": 5000},
            {"fuelType": " wind ", "startTime": "2026-01-02T00:30:00Z", "generation": "1100.5"},
        ]  # fmt: skip
        result = parse_fuelhh_records(raw)
        assert result.received == 3
        assert result.filtered_out == 1
        assert [r.generation_mw for r in result.records] == [1000.0, 1100.5]
        first = result.records[0]
        assert first.start_time == datetime(2026, 1, 2, tzinfo=UTC)
        assert first.settlement_period == 1
        assert first.publish_time == datetime(2026, 1, 2, 0, 30, tzinfo=UTC)

    def test_rejects_invalid_rows_with_reasons(self):
        raw = [
            {"fuelType": "WIND", "generation": 1},
            {"fuelType": "WIND", "startTime": "nope", "generation": 1},
            {"fuelType": "WIND", "startTime": "2026-01-02T00:10:00Z", "generation": 1},
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z"},
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": "NaN"},
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": -5},
            "not-an-object",
        ]
        result = parse_fuelhh_records(raw)  # type: ignore[arg-type]
        assert result.records == []
        reasons = [r.reason for r in result.rejected]
        assert "missing startTime" in reasons
        assert "negative generation" in reasons
        assert any("aligned" in r for r in reasons)
        assert result.rejected_count == 7

    def test_duplicates_resolved_by_latest_publish_time(self):
        raw = [
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": 1000,
             "publishTime": "2026-01-02T01:00:00Z"},
            {"fuelType": "WIND", "startTime": "2026-01-02T00:00:00Z", "generation": 900,
             "publishTime": "2026-01-02T00:30:00Z"},
        ]  # fmt: skip
        for payload in (raw, raw[::-1]):
            result = parse_fuelhh_records(payload)
            assert len(result.records) == 1
            assert result.records[0].generation_mw == 1000
            assert result.duplicates == 1
            assert result.duplicate_conflicts == 1

    def test_empty_payload(self):
        result = parse_fuelhh_records([])
        assert result.records == [] and result.received == 0


class TestWindfor:
    def test_parses_vintages(self):
        raw = [
            {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T09:30:00Z", "generation": 10},
            {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T07:30:00Z", "generation": 11},
        ]
        result = parse_windfor_records(raw)
        assert len(result.records) == 2
        assert result.records[0].publish_time < result.records[1].publish_time

    def test_missing_publish_time_is_rejected_and_counted(self):
        result = parse_windfor_records([{"startTime": "2026-01-02T00:00:00Z", "generation": 10}])
        assert result.records == []
        assert result.missing_publish_time == 1

    def test_duplicate_vintage_is_collapsed(self):
        row = {"startTime": "2026-01-02T00:00:00Z", "publishTime": "2026-01-01T09:30:00Z", "generation": 10}
        result = parse_windfor_records([row, dict(row)])
        assert len(result.records) == 1
        assert result.duplicates == 1
        assert result.duplicate_conflicts == 0
