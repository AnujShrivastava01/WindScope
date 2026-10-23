"""Coverage, completeness and staleness rules."""

from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

from app.services.forecast_selection import Status
from app.utils.time import parse_utc


def _pct(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator * 100, 2) if denominator else None


def coverage_summary(periods: pd.DataFrame) -> dict[str, object]:
    """Counts of matched/unmatched periods for an analysed period grid.

    * ``forecast_target_periods`` excludes half-hour periods for which WINDFOR (an
      hourly product) publishes no forecast at all.
    * ``forecast_coverage_pct`` = forecast targets with a decision-time forecast / targets.
    * ``match_rate_pct`` = matched / forecast targets.
    * ``actual_coverage_pct`` = settlement periods with an actual / all periods.
    """
    counts = periods["status"].value_counts().to_dict() if not periods.empty else {}
    total = len(periods)
    not_target = int(counts.get(Status.NOT_FORECAST_TARGET, 0))
    targets = total - not_target
    matched = int(counts.get(Status.MATCHED, 0))
    selected = int(periods["forecast_mw"].notna().sum()) if total else 0
    actual_observed = int(periods["has_actual"].sum()) if total else 0
    return {
        "total_periods": total,
        "forecast_target_periods": targets,
        "matched": matched,
        "unmatched": targets - matched,
        "missing_actual": int(counts.get(Status.MISSING_ACTUAL, 0)),
        "missing_forecast": int(counts.get(Status.MISSING_FORECAST, 0)),
        "late_forecast_only": int(counts.get(Status.LATE_FORECAST_ONLY, 0)),
        "missing_both": int(counts.get(Status.MISSING_BOTH, 0)),
        "no_forecast_target": not_target,
        "periods_with_forecast": selected,
        "actual_observed": actual_observed,
        "actual_missing": total - actual_observed,
        "forecast_coverage_pct": _pct(selected, targets),
        "match_rate_pct": _pct(matched, targets),
        "actual_coverage_pct": _pct(actual_observed, total),
    }


def daily_coverage(periods: pd.DataFrame) -> list[dict[str, object]]:
    if periods.empty:
        return []
    rows = []
    for day, group in periods.groupby("delivery_date", sort=True):
        cov = coverage_summary(group)
        rows.append(
            {
                "delivery_date": day,
                "total_periods": cov["total_periods"],
                "forecast_target_periods": cov["forecast_target_periods"],
                "matched": cov["matched"],
                "missing_actual": cov["missing_actual"],
                "missing_forecast": cov["missing_forecast"] + cov["missing_both"],
                "late_forecast_only": cov["late_forecast_only"],
                "actual_observed": cov["actual_observed"],
                "actual_missing": cov["actual_missing"],
                "match_rate_pct": cov["match_rate_pct"],
            }
        )
    return rows


def dataset_status(
    *,
    records: int,
    last_success: dict[str, object] | None,
    expected_missing: int,
    stale_after_hours: float,
    now: datetime | None = None,
) -> dict[str, object]:
    """Classify a dataset as ``ok``, ``incomplete``, ``stale`` or ``empty``.

    Rules (applied in order, all reasons are reported):

    * ``empty``: no records stored.
    * ``incomplete``: at least one expected period in the analysis window is missing.
    * ``stale``: no successful API refresh, or the last one is older than
      ``stale_after_hours``.
    """
    now = now or datetime.now(UTC)
    reasons: list[str] = []
    status = "ok"
    if records == 0:
        return {"status": "empty", "reasons": ["No records are stored for this dataset."]}
    if expected_missing > 0:
        status = "incomplete"
        reasons.append(f"{expected_missing} expected period(s) in the analysis window are missing.")
    if last_success is None:
        reasons.append("No successful Elexon API refresh has been recorded (data may be CSV-imported only).")
        status = "stale" if status == "ok" else status
    else:
        finished = parse_utc(str(last_success["finished_at"]))
        age_hours = (now - finished).total_seconds() / 3600
        if age_hours > stale_after_hours:
            reasons.append(
                f"Last successful refresh was {age_hours:.1f} h ago (threshold {stale_after_hours:g} h)."
            )
            status = "stale" if status == "ok" else status
    if not reasons:
        reasons.append("All expected periods present and refreshed within the staleness threshold.")
    return {"status": status, "reasons": reasons}
