"""CSV import validation, CSV export and data-quality rules (synthetic)."""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from app.services.csv_io import CsvValidationError, forecasts_export_frame, parse_csv_upload, to_csv_bytes
from app.services.data_quality import dataset_status


def test_actual_csv_with_elexon_headers():
    content = (
        b"startTime,fuelType,generation\n"
        b"2026-01-02T00:00:00Z,WIND,1000\n"
        b"2026-01-02T00:30:00Z,CCGT,5000\n"
        b"2026-01-02T01:00:00Z,WIND,abc\n"
        b"2026-01-02T01:30:00Z,WIND,1200\n"
    )
    outcome = parse_csv_upload(content, "actual")
    result = outcome.result
    assert len(result.records) == 2
    assert result.filtered_out == 1
    assert [(r.row, r.reason) for r in result.rejected] == [(4, "missing or non-numeric generation")]


def test_forecast_csv_accepts_export_headers():
    content = (
        b"start_time_utc,publish_time_utc,generation_mw,unit\n"
        b"2026-01-02T00:00:00Z,2026-01-01T09:30:00Z,100,MW\n"
        b"2026-01-02T00:00:00Z,,100,MW\n"
    )
    result = parse_csv_upload(content, "forecast").result
    assert len(result.records) == 1
    assert result.missing_publish_time == 1
    assert result.rejected[0].row == 3


@pytest.mark.parametrize(
    ("content", "dataset", "message"),
    [
        (b"", "actual", "empty"),
        (b"startTime,foo\n2026-01-02T00:00:00Z,1\n", "actual", "generation"),
        (b"startTime,generation\n2026-01-02T00:00:00Z,1\n", "forecast", "publishTime"),
        (b"startTime,generation\n", "other", "dataset"),
        (b"\xff\xfe\x00bad", "actual", "UTF-8"),
    ],
)
def test_invalid_files_raise_clear_errors(content, dataset, message):
    with pytest.raises(CsvValidationError, match=message):
        parse_csv_upload(content, dataset)


def test_forecast_export_preserves_columns_and_times():
    frame = forecasts_export_frame(
        [
            {
                "start_time": "2026-07-02T12:00:00Z",
                "publish_time": "2026-07-01T09:30:00Z",
                "generation_mw": 123.0,
                "source": "elexon_api",
            }
        ]
    )
    parsed = pd.read_csv(io.BytesIO(to_csv_bytes(frame)))
    assert list(parsed.columns) == [
        "start_time_utc", "start_time_uk", "publish_time_utc", "publish_time_uk",
        "generation_mw", "unit", "source",
    ]  # fmt: skip
    first = parsed.iloc[0]
    assert first["publish_time_utc"] == "2026-07-01T09:30:00Z"
    assert first["start_time_uk"] == "2026-07-02T13:00:00+01:00"
    assert first["unit"] == "MW"


def test_empty_export_has_header_only():
    assert to_csv_bytes(forecasts_export_frame([])).decode().strip().count("\n") == 0


NOW = datetime(2026, 2, 5, 12, tzinfo=UTC)


def test_dataset_status_rules():
    fresh = {"finished_at": (NOW - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    old = {"finished_at": (NOW - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    kwargs = {"stale_after_hours": 24, "now": NOW}
    assert dataset_status(records=0, last_success=None, expected_missing=0, **kwargs)["status"] == "empty"
    assert dataset_status(records=5, last_success=fresh, expected_missing=0, **kwargs)["status"] == "ok"
    assert (
        dataset_status(records=5, last_success=fresh, expected_missing=3, **kwargs)["status"] == "incomplete"
    )
    stale = dataset_status(records=5, last_success=old, expected_missing=0, **kwargs)
    assert stale["status"] == "stale"
    assert "48.0 h" in stale["reasons"][0]
    assert dataset_status(records=5, last_success=None, expected_missing=0, **kwargs)["status"] == "stale"
