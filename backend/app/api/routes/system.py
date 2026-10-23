"""Health, metadata, data-health, refresh and import endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import ContainerDep, default_window, window_payload
from app.core.errors import ApiError
from app.schemas.responses import (
    ErrorResponse,
    HealthResponse,
    ImportResponse,
    MetaResponse,
    RefreshResponse,
)
from app.services.analysis import AnalysisParams, status_catalogue
from app.services.csv_io import MAX_IMPORT_BYTES, CsvValidationError
from app.services.data_quality import coverage_summary, daily_coverage, dataset_status
from app.services.forecast_selection import CutoffPolicy, Status
from app.services.ingestion import MAX_DAYS_BEFORE, ingestion_window
from app.utils.time import to_iso_z

router = APIRouter(prefix="/api", tags=["system"], responses={422: {"model": ErrorResponse}})

ASSUMPTIONS = [
    "Decision cutoff defaults to 10:00 Europe/London on the day before delivery (D-1). This is an "
    "analysis assumption approximating day-ahead auction timing, not an official Elexon rule; it is "
    "configurable.",
    "A forecast is eligible if publishTime <= cutoff (inclusive). The latest eligible vintage is selected.",
    "Delivery days are UK local calendar days; settlement periods are 30 minutes (46/48/50 per day).",
    "WINDFOR forecasts are hourly; half-hour periods without a forecast target are shown for context "
    "and excluded from accuracy metrics and forecast coverage.",
    "Error = forecast - actual. Positive = wind over-estimated; negative = under-estimated.",
    "Only Elexon FUELHH (fuelType WIND) and WINDFOR are used. No demand, price or other generation data.",
]


def _default_params(container) -> AnalysisParams:
    s = container.settings
    start, end = default_window(s, s.default_cutoff_days_before)
    return AnalysisParams(start, end, CutoffPolicy(s.default_cutoff_time, s.default_cutoff_days_before))


@router.get("/health", response_model=HealthResponse, summary="Liveness and basic readiness")
def health(container: ContainerDep) -> dict[str, object]:
    db_ok = container.repo.db.ping()
    stats = container.repo.dataset_stats() if db_ok else {}
    return {
        "status": "ok" if db_ok else "degraded",
        "version": container.settings.app_version,
        "database": "ok" if db_ok else "unavailable",
        "refresh_in_progress": container.ingestion.in_progress,
        "records": {k: int(v["records"] or 0) for k, v in stats.items()},
        "time": to_iso_z(datetime.now(UTC)),
    }


@router.get("/meta", response_model=MetaResponse, summary="Defaults, analysis window and assumptions")
def meta(container: ContainerDep) -> dict[str, object]:
    s = container.settings
    return {
        "app_name": s.app_name,
        "version": s.app_version,
        "decision_date_start": s.decision_date_start.isoformat(),
        "decision_date_end": s.decision_date_end.isoformat(),
        "default_window": window_payload(_default_params(container)),
        "default_cutoff_time": s.default_cutoff_time.strftime("%H:%M"),
        "default_cutoff_days_before": s.default_cutoff_days_before,
        "max_cutoff_days_before": MAX_DAYS_BEFORE,
        "timezone": "Europe/London",
        "statuses": status_catalogue(),
        "assumptions": ASSUMPTIONS,
    }


@router.get("/data-health", summary="Freshness, completeness, duplicates and refresh history")
def data_health(container: ContainerDep) -> dict[str, object]:
    params = _default_params(container)
    periods = container.analysis.periods(params)
    coverage = coverage_summary(periods)
    stats = container.repo.dataset_stats()
    totals = container.repo.refresh_totals()
    s = container.settings

    forecast_gaps = coverage["missing_forecast"] + coverage["missing_both"] + coverage["late_forecast_only"]
    missing = periods[periods["status"].isin([Status.MISSING_ACTUAL, Status.MISSING_FORECAST,
                                              Status.LATE_FORECAST_ONLY, Status.MISSING_BOTH])
                      | ~periods["has_actual"]]  # fmt: skip
    datasets = {}
    for name, expected_missing in (
        ("actual", coverage["actual_missing"]),
        ("forecast", forecast_gaps),
    ):
        last_success = _last_api_success(container, name)
        datasets[name] = {
            **stats[name],
            "label": "FUELHH (fuelType=WIND)" if name == "actual" else "WINDFOR",
            "last_successful_fetch": last_success["finished_at"] if last_success else None,
            "last_attempt": container.repo.last_refresh(name),
            "expected_missing_in_window": expected_missing,
            **dataset_status(
                records=int(stats[name]["records"] or 0),
                last_success=last_success,
                expected_missing=expected_missing,
                stale_after_hours=s.stale_after_hours,
            ),
            "totals": totals.get(name, {}),
        }
    window = ingestion_window(s)
    return {
        "generated_at": to_iso_z(datetime.now(UTC)),
        "window": window_payload(params),
        "ingestion_window": {k: (v.isoformat()) for k, v in window.items()},
        "datasets": datasets,
        "coverage": coverage,
        "daily_coverage": daily_coverage(periods),
        "missing_periods": [
            {
                "start_time": to_iso_z(r.start_time.to_pydatetime()),
                "status": r.status,
                "has_actual": bool(r.has_actual),
            }
            for r in missing.head(200).itertuples()
        ],
        "missing_periods_total": len(missing),
        "cache": {
            **container.analysis.cache_info(),
            "data_version": container.repo.data_version(),
            "storage": "SQLite (idempotent upserts; unique keys on startTime and startTime+publishTime)",
        },
        "refresh_in_progress": container.ingestion.in_progress,
        "last_refresh": container.ingestion.last_result,
        "refresh_history": container.repo.refresh_history(20),
        "stale_after_hours": s.stale_after_hours,
    }


def _last_api_success(container, dataset: str) -> dict[str, object] | None:
    for entry in container.repo.refresh_history(200):
        if (
            entry["dataset"] == dataset
            and entry["trigger"] != "csv_import"
            and entry["status"]
            in (
                "success",
                "partial",
            )
        ):
            return entry
    return None


@router.post("/data/refresh", response_model=RefreshResponse, summary="Fetch FUELHH and WINDFOR from Elexon")
async def refresh(container: ContainerDep) -> dict[str, object]:
    return await run_in_threadpool(container.ingestion.refresh, "manual")


@router.post(
    "/data/import",
    response_model=ImportResponse,
    summary="Import FUELHH (actual) or WINDFOR (forecast) records from CSV",
    responses={400: {"model": ErrorResponse}, 413: {"model": ErrorResponse}},
)
async def import_csv(
    container: ContainerDep,
    file: Annotated[UploadFile, File(description="UTF-8 CSV file")],
    dataset: Annotated[Literal["actual", "forecast"], Form()],
) -> dict[str, object]:
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise ApiError(413, "file_too_large", "CSV file exceeds the 10 MB limit.")
    try:
        return await run_in_threadpool(container.ingestion.import_csv, content, dataset, file.filename)
    except CsvValidationError as exc:
        raise ApiError(400, "invalid_csv", str(exc)) from exc
