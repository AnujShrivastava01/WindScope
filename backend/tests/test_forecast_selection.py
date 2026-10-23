"""Decision-time forecast vintage selection (synthetic fixtures only)."""

from __future__ import annotations

from datetime import date, time

import pandas as pd
import pytest

from app.services.forecast_selection import (
    CutoffPolicy,
    Status,
    build_target_grid,
    deduplicate_forecasts,
    match_actuals,
    select_forecasts,
)


def ts(value: str) -> pd.Timestamp:
    return pd.Timestamp(value, tz="UTC")


def forecasts(rows: list[tuple[str, str, float]], **extra) -> pd.DataFrame:
    frame = pd.DataFrame(rows, columns=["start_time", "publish_time", "generation_mw"])
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True, format="ISO8601")
    frame["publish_time"] = pd.to_datetime(frame["publish_time"], utc=True, format="ISO8601")
    for key, value in extra.items():
        frame[key] = value
    return frame


def actuals(rows: list[tuple[str, float]]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, columns=["start_time", "generation_mw"])
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True, format="ISO8601")
    return frame


POLICY = CutoffPolicy(time(10, 0), 1)
DAY = date(2026, 1, 2)  # cutoff = 2026-01-01 10:00 UK = 10:00 UTC (GMT)


@pytest.fixture
def grid() -> pd.DataFrame:
    return build_target_grid(DAY, DAY, POLICY)


def row(frame: pd.DataFrame, start: str) -> pd.Series:
    return frame.loc[frame["start_time"] == ts(start)].iloc[0]


def test_grid_has_48_periods_and_cutoff(grid):
    assert len(grid) == 48
    assert grid["settlement_period"].tolist() == list(range(1, 49))
    assert (grid["cutoff_utc"] == ts("2026-01-01T10:00:00")).all()
    assert (grid["decision_date"] == "2026-01-01").all()


def test_latest_eligible_forecast_is_selected(grid):
    f = forecasts(
        [
            ("2026-01-02T12:00", "2026-01-01T04:30", 100.0),
            ("2026-01-02T12:00", "2026-01-01T09:30", 300.0),
            ("2026-01-02T12:00", "2026-01-01T07:30", 200.0),
        ]
    )
    out = row(select_forecasts(grid, f), "2026-01-02T12:00")
    assert out["forecast_mw"] == 300.0
    assert out["forecast_publish_time"] == ts("2026-01-01T09:30")
    assert out["eligible_vintages"] == 3
    assert out["excluded_late_vintages"] == 0


def test_forecast_published_exactly_at_cutoff_is_eligible(grid):
    f = forecasts(
        [
            ("2026-01-02T12:00", "2026-01-01T09:30", 300.0),
            ("2026-01-02T12:00", "2026-01-01T10:00", 444.0),
        ]
    )
    out = row(select_forecasts(grid, f), "2026-01-02T12:00")
    assert out["forecast_mw"] == 444.0  # inclusive rule: publishTime <= cutoff


def test_forecast_published_after_cutoff_is_rejected(grid):
    f = forecasts(
        [
            ("2026-01-02T12:00", "2026-01-01T09:30", 300.0),
            ("2026-01-02T12:00", "2026-01-01T10:00:01", 999.0),
            ("2026-01-02T12:00", "2026-01-01T22:30", 555.0),
        ]
    )
    out = row(select_forecasts(grid, f), "2026-01-02T12:00")
    assert out["forecast_mw"] == 300.0
    assert out["excluded_late_vintages"] == 2
    assert out["first_excluded_publish_time"] == ts("2026-01-01T10:00:01")
    # The newest stored vintage is reported separately, never used for evaluation.
    assert out["latest_available_mw"] == 555.0


def test_only_late_forecasts_leave_period_without_selection(grid):
    f = forecasts([("2026-01-02T12:00", "2026-01-01T15:30", 500.0)])
    selected = select_forecasts(grid, f)
    matched = match_actuals(selected, actuals([("2026-01-02T12:00", 480.0)]))
    out = row(matched, "2026-01-02T12:00")
    assert pd.isna(out["forecast_mw"])
    assert out["status"] == Status.LATE_FORECAST_ONLY
    assert pd.isna(out["error_mw"])


def test_vintages_for_different_targets_are_not_confused(grid):
    f = forecasts(
        [
            ("2026-01-02T12:00", "2026-01-01T09:30", 120.0),
            ("2026-01-02T13:00", "2026-01-01T09:30", 130.0),
            ("2026-01-02T13:00", "2026-01-01T07:30", 131.0),
            ("2026-01-02T12:00", "2026-01-01T15:30", 999.0),
        ]
    )
    out = select_forecasts(grid, f)
    assert row(out, "2026-01-02T12:00")["forecast_mw"] == 120.0
    assert row(out, "2026-01-02T13:00")["forecast_mw"] == 130.0
    assert row(out, "2026-01-02T13:00")["eligible_vintages"] == 2


def test_missing_forecast_stays_missing(grid):
    out = match_actuals(select_forecasts(grid, forecasts([])), actuals([("2026-01-02T12:00", 480.0)]))
    target = row(out, "2026-01-02T12:00")
    assert pd.isna(target["forecast_mw"])
    assert target["status"] == Status.MISSING_FORECAST
    assert row(out, "2026-01-02T13:00")["status"] == Status.MISSING_BOTH
    assert row(out, "2026-01-02T12:30")["status"] == Status.NOT_FORECAST_TARGET


def test_matching_uses_timestamps_not_row_order(grid):
    f = forecasts(
        [
            ("2026-01-02T13:00", "2026-01-01T09:30", 130.0),
            ("2026-01-02T12:00", "2026-01-01T09:30", 120.0),
        ]
    )
    a = actuals([("2026-01-02T13:00", 100.0), ("2026-01-02T12:00", 110.0)])
    shuffled_grid = grid.sample(frac=1, random_state=7)
    out = match_actuals(select_forecasts(shuffled_grid, f), a)
    assert row(out, "2026-01-02T12:00")["error_mw"] == pytest.approx(10.0)
    assert row(out, "2026-01-02T13:00")["error_mw"] == pytest.approx(30.0)


def test_missing_actual_is_not_treated_as_zero(grid):
    f = forecasts([("2026-01-02T12:00", "2026-01-01T09:30", 120.0)])
    out = row(match_actuals(select_forecasts(grid, f), actuals([])), "2026-01-02T12:00")
    assert out["status"] == Status.MISSING_ACTUAL
    assert pd.isna(out["actual_mw"])
    assert pd.isna(out["error_mw"])


def test_duplicate_forecasts_resolved_deterministically(grid):
    rows = [
        ("2026-01-02T12:00", "2026-01-01T09:30", 100.0),
        ("2026-01-02T12:00", "2026-01-01T09:30", 150.0),
    ]
    a = forecasts(rows, source=["csv_import", "elexon_api"])
    b = forecasts(list(reversed(rows)), source=["elexon_api", "csv_import"])
    out_a = row(select_forecasts(grid, a), "2026-01-02T12:00")
    out_b = row(select_forecasts(grid, b), "2026-01-02T12:00")
    assert out_a["forecast_mw"] == out_b["forecast_mw"] == 150.0  # API source wins
    deduped, removed, conflicts = deduplicate_forecasts(a)
    assert len(deduped) == 1 and removed == 1 and conflicts == 1


def test_identical_duplicates_without_source_are_stable(grid):
    rows = [
        ("2026-01-02T12:00", "2026-01-01T09:30", 100.0),
        ("2026-01-02T12:00", "2026-01-01T09:30", 90.0),
    ]
    out_a = row(select_forecasts(grid, forecasts(rows)), "2026-01-02T12:00")
    out_b = row(select_forecasts(grid, forecasts(rows[::-1])), "2026-01-02T12:00")
    assert out_a["forecast_mw"] == out_b["forecast_mw"]


def test_error_sign_convention(grid):
    f = forecasts(
        [
            ("2026-01-02T12:00", "2026-01-01T09:30", 120.0),
            ("2026-01-02T13:00", "2026-01-01T09:30", 80.0),
        ]
    )
    out = match_actuals(
        select_forecasts(grid, f), actuals([("2026-01-02T12:00", 100.0), ("2026-01-02T13:00", 100.0)])
    )
    assert row(out, "2026-01-02T12:00")["error_mw"] == 20.0  # over-forecast
    assert row(out, "2026-01-02T13:00")["error_mw"] == -20.0  # under-forecast


def test_cutoff_respects_british_summer_time():
    # Delivery 2026-07-02, cutoff 10:00 BST on 2026-07-01 = 09:00 UTC.
    grid = build_target_grid(date(2026, 7, 2), date(2026, 7, 2), POLICY)
    assert (grid["cutoff_utc"] == ts("2026-07-01T09:00")).all()
    assert grid["start_time"].iloc[0] == ts("2026-07-01T23:00")
    f = forecasts(
        [
            ("2026-07-02T12:00", "2026-07-01T08:30", 1.0),
            ("2026-07-02T12:00", "2026-07-01T09:30", 2.0),  # 10:30 BST -> after cutoff
        ]
    )
    assert row(select_forecasts(grid, f), "2026-07-02T12:00")["forecast_mw"] == 1.0


def test_clock_change_days_have_46_and_50_periods():
    assert len(build_target_grid(date(2026, 3, 29), date(2026, 3, 29), POLICY)) == 46
    assert len(build_target_grid(date(2026, 10, 25), date(2026, 10, 25), POLICY)) == 50


def test_two_days_before_policy():
    policy = CutoffPolicy(time(9, 0), 2)
    grid = build_target_grid(DAY, DAY, policy)
    assert (grid["cutoff_utc"] == ts("2025-12-31T09:00")).all()
    assert (grid["decision_date"] == "2025-12-31").all()
