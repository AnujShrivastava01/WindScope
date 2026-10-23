"""Forecast selection and accuracy analytics endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.deps import ContainerDep, ParamsDep, parse_cutoff_time, window_payload
from app.core.errors import ApiError
from app.schemas.responses import (
    AccuracySummaryResponse,
    DistributionResponse,
    ErrorResponse,
    OverviewResponse,
    PeriodPage,
    TimeseriesResponse,
    VintagesResponse,
)
from app.services.forecast_selection import STATUS_DESCRIPTIONS, CutoffPolicy
from app.services.ingestion import MAX_DAYS_BEFORE
from app.utils.time import TimestampError, is_settlement_aligned, parse_utc

router = APIRouter(prefix="/api", tags=["analysis"], responses={422: {"model": ErrorResponse}})

StatusFilter = Annotated[
    str | None, Query(description=f"Filter by period status: {', '.join(STATUS_DESCRIPTIONS)}")
]


def _check_status(status: str | None) -> None:
    if status and status not in STATUS_DESCRIPTIONS:
        raise ApiError(422, "validation_error", f"Unknown status '{status}'.")


@router.get("/overview", response_model=OverviewResponse, summary="Dashboard KPIs and recent periods")
def overview(container: ContainerDep, params: ParamsDep) -> dict[str, object]:
    data = container.analysis.overview(params)
    return {"window": window_payload(params), **data, "data_version": container.repo.data_version()}


@router.get(
    "/accuracy/summary",
    response_model=AccuracySummaryResponse,
    summary="Accuracy metrics, coverage, daily and hour-of-day breakdowns",
)
def accuracy_summary(container: ContainerDep, params: ParamsDep) -> dict[str, object]:
    return {"window": window_payload(params), **container.analysis.summary(params)}


@router.get(
    "/accuracy/timeseries",
    response_model=TimeseriesResponse,
    summary="Every settlement period with its decision-time forecast, actual and error",
)
def accuracy_timeseries(container: ContainerDep, params: ParamsDep) -> dict[str, object]:
    items = container.analysis.timeseries(params)
    return {"window": window_payload(params), "count": len(items), "items": items}


@router.get(
    "/accuracy/distribution",
    response_model=DistributionResponse,
    summary="Error histograms, forecast-vs-actual scatter and empirical error quantiles",
)
def accuracy_distribution(
    container: ContainerDep,
    params: ParamsDep,
    bins: Annotated[int, Query(ge=5, le=60)] = 24,
) -> dict[str, object]:
    return {"window": window_payload(params), **container.analysis.distribution(params, bins)}


@router.get(
    "/forecast-periods",
    response_model=PeriodPage,
    summary="Paginated target settlement periods with the selected forecast vintage",
)
def forecast_periods(
    container: ContainerDep,
    params: ParamsDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 48,
    sort: str = "start_time",
    order: Literal["asc", "desc"] = "asc",
    status: StatusFilter = None,
) -> dict[str, object]:
    _check_status(status)
    items, total = container.analysis.page_periods(
        params, page=page, page_size=page_size, sort=sort, descending=order == "desc", status=status
    )
    return {
        "window": window_payload(params),
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get(
    "/forecast-vintages",
    response_model=VintagesResponse,
    summary="All forecast vintages for one target period and why one was selected",
)
def forecast_vintages(
    container: ContainerDep,
    target_time: Annotated[str, Query(description="Target settlement period start (ISO-8601, UTC)")],
    cutoff_time: Annotated[str | None, Query(description="UK local HH:MM")] = None,
    cutoff_days_before: Annotated[int | None, Query(ge=1, le=MAX_DAYS_BEFORE)] = None,
) -> dict[str, object]:
    try:
        target = parse_utc(target_time)
    except TimestampError as exc:
        raise ApiError(422, "validation_error", "target_time must be an ISO-8601 timestamp.") from exc
    if not is_settlement_aligned(target):
        raise ApiError(422, "validation_error", "target_time must align to a 30-minute settlement period.")
    settings = container.settings
    policy = CutoffPolicy(
        parse_cutoff_time(cutoff_time) if cutoff_time else settings.default_cutoff_time,
        cutoff_days_before or settings.default_cutoff_days_before,
    )
    return container.analysis.vintages(target, policy)
