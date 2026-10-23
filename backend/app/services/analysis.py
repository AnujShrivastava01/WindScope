"""Analysis pipeline: grid -> vintage selection -> matching -> metrics.

Results are memoised per (date range, cutoff policy, data version) so repeated
dashboard requests do not recompute. Any write to the store bumps the data
version and naturally invalidates cached results.
"""

from __future__ import annotations

import math
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from app.repositories.records import RecordsRepository
from app.services import accuracy_metrics as metrics
from app.services.data_quality import coverage_summary, daily_coverage
from app.services.forecast_selection import (
    STATUS_DESCRIPTIONS,
    CutoffPolicy,
    Status,
    build_target_grid,
    deduplicate_forecasts,
    explain_selection,
    match_actuals,
    select_forecasts,
)
from app.utils.time import UK_TZ, local_day_bounds, to_iso_z


@dataclass(frozen=True, slots=True)
class AnalysisParams:
    start_date: date
    end_date: date
    policy: CutoffPolicy


def _iso(value: object) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)) or value is pd.NaT:
        return None
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return to_iso_z(value.to_pydatetime())
    if isinstance(value, datetime):
        return to_iso_z(value)
    return str(value)


def _num(value: object, digits: int = 2) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return round(number, digits) if math.isfinite(number) else None


def period_record(row: pd.Series) -> dict[str, object]:
    return {
        "start_time": _iso(row["start_time"]),
        "delivery_date": row["delivery_date"],
        "settlement_period": int(row["settlement_period"]),
        "decision_date": row["decision_date"],
        "cutoff_time": _iso(row["cutoff_utc"]),
        "forecast_mw": _num(row["forecast_mw"]),
        "forecast_publish_time": _iso(row["forecast_publish_time"]),
        "forecast_horizon_hours": _num(row["forecast_horizon_hours"], 1),
        "eligible_vintages": int(row["eligible_vintages"]),
        "excluded_late_vintages": int(row["excluded_late_vintages"]),
        "actual_mw": _num(row["actual_mw"]),
        "error_mw": _num(row["error_mw"]),
        "abs_error_mw": _num(row["abs_error_mw"]),
        "latest_available_mw": _num(row["latest_available_mw"]),
        "latest_available_publish_time": _iso(row["latest_available_publish_time"]),
        "status": row["status"],
    }


PERIOD_SORT_COLUMNS = {
    "start_time",
    "forecast_mw",
    "actual_mw",
    "error_mw",
    "abs_error_mw",
    "eligible_vintages",
    "forecast_publish_time",
    "status",
}


class AnalysisService:
    def __init__(self, repo: RecordsRepository, cache_size: int = 32) -> None:
        self.repo = repo
        self._cache: OrderedDict[tuple, pd.DataFrame] = OrderedDict()
        self._cache_size = cache_size
        self._lock = threading.Lock()
        self.cache_hits = 0
        self.cache_misses = 0

    # ------------------------------------------------------------------ core frame
    def periods(self, params: AnalysisParams) -> pd.DataFrame:
        key = (params.start_date, params.end_date, params.policy, self.repo.data_version())
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                self.cache_hits += 1
                return cached
            self.cache_misses += 1
        frame = self._compute(params)
        with self._lock:
            self._cache[key] = frame
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return frame

    def cache_info(self) -> dict[str, int]:
        return {"entries": len(self._cache), "hits": self.cache_hits, "misses": self.cache_misses}

    def _compute(self, params: AnalysisParams) -> pd.DataFrame:
        grid = build_target_grid(params.start_date, params.end_date, params.policy)
        start, _ = local_day_bounds(params.start_date)
        _, end = local_day_bounds(params.end_date)
        forecasts = self.repo.forecasts_frame(start, end)
        actuals = self.repo.actuals_frame(start, end)
        selected = select_forecasts(grid, forecasts)
        periods = match_actuals(selected, actuals)
        local = periods["start_time"].dt.tz_convert(UK_TZ)
        periods["local_hour"] = local.dt.hour
        return periods

    # ------------------------------------------------------------------ views
    def summary(self, params: AnalysisParams) -> dict[str, object]:
        periods = self.periods(params)
        matched = periods[periods["status"] == Status.MATCHED]
        summary = metrics.compute_metrics(matched["forecast_mw"], matched["actual_mw"])
        largest = matched.nlargest(10, "abs_error_mw") if not matched.empty else matched
        return {
            "metrics": summary,
            "coverage": coverage_summary(periods),
            "daily": metrics.grouped_metrics(matched, "delivery_date"),
            "by_hour": metrics.grouped_metrics(matched, "local_hour"),
            "daily_coverage": daily_coverage(periods),
            "largest_errors": [period_record(r) for _, r in largest.iterrows()],
        }

    def timeseries(self, params: AnalysisParams) -> list[dict[str, object]]:
        return [period_record(r) for _, r in self.periods(params).iterrows()]

    def distribution(self, params: AnalysisParams, bins: int) -> dict[str, object]:
        periods = self.periods(params)
        matched = periods[periods["status"] == Status.MATCHED]
        return {
            "count": len(matched),
            "abs_error_histogram": metrics.histogram(matched["abs_error_mw"], bins=bins),
            "error_histogram": metrics.histogram(matched["error_mw"], bins=bins, symmetric=True),
            "scatter": [
                {
                    "start_time": _iso(r.start_time),
                    "forecast_mw": _num(r.forecast_mw),
                    "actual_mw": _num(r.actual_mw),
                    "error_mw": _num(r.error_mw),
                }
                for r in matched.itertuples()
            ],
            "quantiles": _quantiles(matched["error_mw"]),
        }

    def page_periods(
        self,
        params: AnalysisParams,
        *,
        page: int,
        page_size: int,
        sort: str,
        descending: bool,
        status: str | None,
    ) -> tuple[list[dict[str, object]], int]:
        periods = self.periods(params)
        if status:
            periods = periods[periods["status"] == status]
        sort = sort if sort in PERIOD_SORT_COLUMNS else "start_time"
        periods = periods.sort_values(
            [sort, "start_time"], ascending=[not descending, True], na_position="last"
        )
        total = len(periods)
        chunk = periods.iloc[(page - 1) * page_size : page * page_size]
        return [period_record(r) for _, r in chunk.iterrows()], total

    def overview(self, params: AnalysisParams, recent: int = 48) -> dict[str, object]:
        periods = self.periods(params)
        matched = periods[periods["status"] == Status.MATCHED]
        summary = metrics.compute_metrics(matched["forecast_mw"], matched["actual_mw"])
        with_forecast = periods[periods["forecast_mw"].notna()]
        latest_forecast = period_record(with_forecast.iloc[-1]) if not with_forecast.empty else None
        latest_matched = period_record(matched.iloc[-1]) if not matched.empty else None
        observed = periods[periods["has_actual"]]
        latest_actual = period_record(observed.iloc[-1]) if not observed.empty else None
        recent_rows = periods[periods["status"] != Status.NOT_FORECAST_TARGET].tail(recent)
        return {
            "kpis": {
                "latest_forecast": latest_forecast,
                "latest_actual": latest_actual,
                "latest_matched": latest_matched,
                "metrics": summary,
                "coverage": coverage_summary(periods),
            },
            "recent_periods": [period_record(r) for _, r in recent_rows.iloc[::-1].iterrows()],
        }

    def vintages(self, target: datetime, policy: CutoffPolicy) -> dict[str, object]:
        """All forecast vintages for one target period, flagged against the cutoff."""
        target = target.replace(second=0, microsecond=0)
        delivery_day = target.astimezone(UK_TZ).date()
        cutoff = policy.cutoff_for(delivery_day)
        forecasts = self.repo.forecasts_frame(target, target + timedelta(minutes=1))
        actuals = self.repo.actuals_frame(target, target + timedelta(minutes=1))
        actual = float(actuals["generation_mw"].iloc[0]) if not actuals.empty else None

        forecasts, duplicates, conflicts = deduplicate_forecasts(forecasts)
        forecasts = forecasts.sort_values("publish_time")
        cutoff_ts = pd.Timestamp(cutoff)
        eligible_mask = forecasts["publish_time"] <= cutoff_ts
        selected_publish = forecasts.loc[eligible_mask, "publish_time"].max() if eligible_mask.any() else None
        latest_publish = forecasts["publish_time"].max() if not forecasts.empty else None

        vintages = []
        for row in forecasts.itertuples():
            eligible = bool(row.publish_time <= cutoff_ts)
            vintages.append(
                {
                    "publish_time": _iso(row.publish_time),
                    "generation_mw": _num(row.generation_mw),
                    "source": row.source,
                    "horizon_hours": _num(
                        (target - row.publish_time.to_pydatetime()).total_seconds() / 3600, 1
                    ),
                    "eligible": eligible,
                    "selected": selected_publish is not None and row.publish_time == selected_publish,
                    "is_latest_available": latest_publish is not None and row.publish_time == latest_publish,
                    "error_mw": _num(row.generation_mw - actual) if actual is not None else None,
                }
            )
        selected = next((v for v in vintages if v["selected"]), None)
        latest = next((v for v in vintages if v["is_latest_available"]), None)
        return {
            "target_time": to_iso_z(target),
            "delivery_date": delivery_day.isoformat(),
            "decision_date": policy.decision_date(delivery_day).isoformat(),
            "cutoff_time": to_iso_z(cutoff),
            "cutoff_rule": "publishTime <= cutoff (inclusive)",
            "actual_mw": _num(actual),
            "selected": selected,
            "latest_available": latest,
            "vintages": vintages,
            "eligible_count": int(eligible_mask.sum()),
            "excluded_late_count": int((~eligible_mask).sum()),
            "duplicates_resolved": duplicates,
            "duplicate_conflicts": conflicts,
            "explanation": explain_selection(
                cutoff=cutoff,
                vintages=vintages,
                selected_publish=selected_publish.to_pydatetime() if selected_publish is not None else None,
            ),
        }

    def export_frame(self, params: AnalysisParams, status: str | None = None) -> pd.DataFrame:
        periods = self.periods(params)
        if status:
            periods = periods[periods["status"] == status]
        out = pd.DataFrame(
            {
                "start_time_utc": periods["start_time"].map(_iso),
                "start_time_uk": periods["start_time"].dt.tz_convert(UK_TZ).map(lambda t: t.isoformat()),
                "delivery_date": periods["delivery_date"],
                "settlement_period": periods["settlement_period"],
                "decision_date": periods["decision_date"],
                "decision_cutoff_utc": periods["cutoff_utc"].map(_iso),
                "forecast_mw": periods["forecast_mw"].round(2),
                "forecast_publish_time_utc": periods["forecast_publish_time"].map(_iso),
                "eligible_vintages": periods["eligible_vintages"],
                "excluded_late_vintages": periods["excluded_late_vintages"],
                "actual_mw": periods["actual_mw"].round(2),
                "error_mw": periods["error_mw"].round(2),
                "abs_error_mw": periods["abs_error_mw"].round(2),
                "status": periods["status"],
            }
        )
        return out


def _quantiles(errors: pd.Series) -> dict[str, float | None]:
    data = errors.dropna().to_numpy(dtype="float64")
    keys = {"p05": 5, "p10": 10, "p25": 25, "p50": 50, "p75": 75, "p90": 90, "p95": 95}
    if data.size == 0:
        return dict.fromkeys(keys)
    return {k: _num(np.percentile(data, q)) for k, q in keys.items()}


def status_catalogue() -> list[dict[str, str]]:
    return [{"status": k, "description": v} for k, v in STATUS_DESCRIPTIONS.items()]
