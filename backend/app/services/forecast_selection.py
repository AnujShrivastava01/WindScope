"""Decision-time forecast vintage selection and actual/forecast matching.

This module is pure (no I/O) so the business rule can be tested in isolation.

Algorithm, for every target settlement period ``t`` on UK delivery day ``D``:

1. decision cutoff ``c = local(D - days_before, cutoff_time)`` converted to UTC;
2. candidate forecasts = all WINDFOR vintages with ``startTime == t``;
3. eligible forecasts = candidates with ``publishTime <= c`` (inclusive rule);
4. the selected forecast is the eligible candidate with the latest ``publishTime``;
5. the selected forecast is joined to the FUELHH actual with the identical ``startTime``.

Forecasts published after the cutoff are never selected, even if they are more
accurate or are the newest data currently stored. They are reported separately
as "latest available" for comparison only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd

from app.utils.time import local_cutoff, settlement_periods

# Higher rank wins when two vintages share an identical (startTime, publishTime).
SOURCE_RANK = {"csv_import": 0, "elexon_api": 1}


class Status:
    MATCHED = "matched"
    MISSING_ACTUAL = "missing_actual"
    MISSING_FORECAST = "missing_forecast"
    LATE_FORECAST_ONLY = "late_forecast_only"
    MISSING_BOTH = "missing_both"
    NOT_FORECAST_TARGET = "no_forecast_target"


STATUS_DESCRIPTIONS = {
    Status.MATCHED: "Decision-time forecast and actual outturn both available.",
    Status.MISSING_ACTUAL: "Forecast selected but no FUELHH actual is stored for this period.",
    Status.MISSING_FORECAST: "No WINDFOR forecast exists for this target period.",
    Status.LATE_FORECAST_ONLY: "Forecasts exist but all were published after the decision cutoff.",
    Status.MISSING_BOTH: "Neither a forecast nor an actual is available.",
    Status.NOT_FORECAST_TARGET: (
        "Half-hour period between WINDFOR's hourly forecast targets; actual shown for context only."
    ),
}


@dataclass(frozen=True, slots=True)
class CutoffPolicy:
    """Day-ahead decision cutoff, expressed in UK local time."""

    cutoff_time: time = time(10, 0)
    days_before: int = 1

    def cutoff_for(self, delivery_day: date) -> datetime:
        return local_cutoff(delivery_day, self.cutoff_time, self.days_before)

    def decision_date(self, delivery_day: date) -> date:
        return delivery_day - timedelta(days=self.days_before)

    @property
    def label(self) -> str:
        return f"{self.cutoff_time.strftime('%H:%M')} Europe/London, D-{self.days_before}"


def build_target_grid(start_day: date, end_day: date, policy: CutoffPolicy) -> pd.DataFrame:
    """One row per settlement period for UK delivery days ``start_day..end_day`` inclusive."""
    rows: list[dict[str, object]] = []
    day = start_day
    while day <= end_day:
        cutoff = policy.cutoff_for(day)
        decision = policy.decision_date(day).isoformat()
        for period, start in enumerate(settlement_periods(day), start=1):
            rows.append(
                {
                    "start_time": start,
                    "delivery_date": day.isoformat(),
                    "settlement_period": period,
                    "decision_date": decision,
                    "cutoff_utc": cutoff,
                }
            )
        day += timedelta(days=1)
    frame = pd.DataFrame(
        rows,
        columns=["start_time", "delivery_date", "settlement_period", "decision_date", "cutoff_utc"],
    )
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True)
    frame["cutoff_utc"] = pd.to_datetime(frame["cutoff_utc"], utc=True)
    return frame


def deduplicate_forecasts(forecasts: pd.DataFrame) -> tuple[pd.DataFrame, int, int]:
    """Collapse rows sharing ``(start_time, publish_time)`` deterministically.

    Ranking: API source over CSV import, then most recently ingested, then the
    larger value. Returns ``(frame, duplicates_removed, conflicting_duplicates)``.
    """
    if forecasts.empty:
        return forecasts.copy(), 0, 0
    frame = forecasts.copy()
    if "source" not in frame:
        frame["source"] = "elexon_api"
    if "ingested_at" not in frame:
        frame["ingested_at"] = pd.Timestamp(0, tz="UTC")
    frame["_rank"] = frame["source"].map(SOURCE_RANK).fillna(-1)
    frame["_ing"] = frame["ingested_at"].fillna(pd.Timestamp(0, tz="UTC"))
    frame = frame.sort_values(
        ["start_time", "publish_time", "_rank", "_ing", "generation_mw"], kind="mergesort"
    )
    key = ["start_time", "publish_time"]
    dup_mask = frame.duplicated(key, keep="last")
    duplicates = int(dup_mask.sum())
    conflicts = 0
    if duplicates:
        nunique = frame.groupby(key)["generation_mw"].nunique()
        conflicts = int((nunique > 1).sum())
    frame = frame[~dup_mask].drop(columns=["_rank", "_ing"]).reset_index(drop=True)
    return frame, duplicates, conflicts


def select_forecasts(targets: pd.DataFrame, forecasts: pd.DataFrame) -> pd.DataFrame:
    """Attach the decision-time forecast to each target period.

    ``targets`` needs ``start_time`` and ``cutoff_utc``; ``forecasts`` needs
    ``start_time``, ``publish_time`` and ``generation_mw``. Matching is by
    timestamp value only, never by row order.
    """
    out = targets.copy()
    forecasts, _, _ = deduplicate_forecasts(forecasts)

    empty_cols = {
        "forecast_mw": np.nan,
        "forecast_publish_time": pd.NaT,
        "eligible_vintages": 0,
        "excluded_late_vintages": 0,
        "total_vintages": 0,
        "first_excluded_publish_time": pd.NaT,
        "latest_available_mw": np.nan,
        "latest_available_publish_time": pd.NaT,
    }
    if forecasts.empty or out.empty:
        for col, value in empty_cols.items():
            out[col] = value
        for col in (
            "forecast_publish_time",
            "first_excluded_publish_time",
            "latest_available_publish_time",
        ):
            out[col] = pd.to_datetime(out[col], utc=True)
        out["forecast_horizon_hours"] = np.nan
        return out

    merged = forecasts[["start_time", "publish_time", "generation_mw"]].merge(
        out[["start_time", "cutoff_utc"]], on="start_time", how="inner"
    )
    merged["eligible"] = merged["publish_time"] <= merged["cutoff_utc"]
    merged = merged.sort_values(["start_time", "publish_time"], kind="mergesort")

    grouped = merged.groupby("start_time")
    counts = pd.DataFrame(
        {
            "total_vintages": grouped.size(),
            "eligible_vintages": grouped["eligible"].sum().astype(int),
        }
    )
    counts["excluded_late_vintages"] = counts["total_vintages"] - counts["eligible_vintages"]

    eligible = merged[merged["eligible"]].groupby("start_time").tail(1)
    selected = eligible.set_index("start_time")[["generation_mw", "publish_time"]].rename(
        columns={"generation_mw": "forecast_mw", "publish_time": "forecast_publish_time"}
    )
    latest = merged.groupby("start_time").tail(1).set_index("start_time")[["generation_mw", "publish_time"]]
    latest = latest.rename(
        columns={
            "generation_mw": "latest_available_mw",
            "publish_time": "latest_available_publish_time",
        }
    )
    first_late = (
        merged[~merged["eligible"]]
        .groupby("start_time")["publish_time"]
        .min()
        .rename("first_excluded_publish_time")
    )

    out = out.merge(selected, left_on="start_time", right_index=True, how="left")
    out = out.merge(counts, left_on="start_time", right_index=True, how="left")
    out = out.merge(first_late, left_on="start_time", right_index=True, how="left")
    out = out.merge(latest, left_on="start_time", right_index=True, how="left")
    for col in ("total_vintages", "eligible_vintages", "excluded_late_vintages"):
        out[col] = out[col].fillna(0).astype(int)
    for col in (
        "forecast_publish_time",
        "first_excluded_publish_time",
        "latest_available_publish_time",
    ):
        out[col] = pd.to_datetime(out[col], utc=True)
    out["forecast_horizon_hours"] = (
        out["start_time"] - out["forecast_publish_time"]
    ).dt.total_seconds() / 3600
    return out


def match_actuals(selected: pd.DataFrame, actuals: pd.DataFrame) -> pd.DataFrame:
    """Join actual outturn on identical ``start_time`` and classify each period.

    ``error_mw = forecast - actual`` (positive = wind over-forecast). Errors are
    only computed when both values exist; missing values stay ``NaN``.
    """
    actual_cols = actuals[["start_time", "generation_mw"]].rename(columns={"generation_mw": "actual_mw"})
    actual_cols = actual_cols.drop_duplicates("start_time", keep="last")
    out = selected.merge(actual_cols, on="start_time", how="left")

    has_forecast = out["forecast_mw"].notna()
    has_actual = out["actual_mw"].notna()
    has_vintages = out["total_vintages"] > 0
    half_hour = out["start_time"].dt.minute == 30

    status = np.select(
        [
            has_forecast & has_actual,
            has_forecast & ~has_actual,
            ~has_forecast & has_vintages,
            ~has_vintages & half_hour,
            ~has_vintages & has_actual,
        ],
        [
            Status.MATCHED,
            Status.MISSING_ACTUAL,
            Status.LATE_FORECAST_ONLY,
            Status.NOT_FORECAST_TARGET,
            Status.MISSING_FORECAST,
        ],
        default=Status.MISSING_BOTH,
    )
    out["status"] = status
    out["has_actual"] = has_actual
    matched = out["status"] == Status.MATCHED
    out["error_mw"] = np.where(matched, out["forecast_mw"] - out["actual_mw"], np.nan)
    out["abs_error_mw"] = out["error_mw"].abs()
    out["latest_available_error_mw"] = np.where(
        has_actual & out["latest_available_mw"].notna(),
        out["latest_available_mw"] - out["actual_mw"],
        np.nan,
    )
    return out


def explain_selection(
    *,
    cutoff: datetime,
    vintages: list[dict[str, object]],
    selected_publish: datetime | None,
) -> str:
    """Human readable explanation of why a vintage was (or was not) selected."""
    eligible = [v for v in vintages if v["eligible"]]
    late = [v for v in vintages if not v["eligible"]]
    cutoff_txt = cutoff.strftime("%Y-%m-%d %H:%M UTC")
    if not vintages:
        return "No WINDFOR forecast was published for this target period, so it is reported as missing."
    if selected_publish is None:
        return (
            f"All {len(late)} forecast vintage(s) were published after the decision cutoff ({cutoff_txt}). "
            "They were not available when the purchase decision had to be made, so no forecast is "
            "selected for historical evaluation."
        )
    parts = [
        f"{len(eligible)} vintage(s) were published on or before the cutoff ({cutoff_txt}); the latest of "
        f"these, published {selected_publish.strftime('%Y-%m-%d %H:%M UTC')}, is the forecast the "
        "procurement team could have used."
    ]
    if late:
        parts.append(
            f"{len(late)} later vintage(s) are excluded because they were published after the cutoff and "
            "would introduce hindsight into the evaluation."
        )
    return " ".join(parts)
