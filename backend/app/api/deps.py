"""Shared request dependencies and query-parameter parsing."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, time, timedelta
from typing import Annotated

from fastapi import Depends, Query, Request

from app.core.config import Settings
from app.core.errors import ApiError
from app.repositories.records import RecordsRepository
from app.services.analysis import AnalysisParams, AnalysisService
from app.services.forecast_selection import CutoffPolicy
from app.services.ingestion import MAX_DAYS_BEFORE, IngestionService

MAX_RANGE_DAYS = 62
_CUTOFF_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


@dataclass(slots=True)
class Container:
    settings: Settings
    repo: RecordsRepository
    analysis: AnalysisService
    ingestion: IngestionService


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def default_window(settings: Settings, days_before: int) -> tuple[date, date]:
    """Delivery dates whose decision date falls in the configured decision window."""
    return (
        settings.decision_date_start + timedelta(days=days_before),
        settings.decision_date_end + timedelta(days=days_before),
    )


def parse_cutoff_time(value: str) -> time:
    match = _CUTOFF_RE.match(value)
    if not match:
        raise ApiError(422, "validation_error", "cutoff_time must be HH:MM in 24-hour UK local time.")
    return time(int(match.group(1)), int(match.group(2)))


def analysis_params(
    container: ContainerDep,
    start_date: Annotated[date | None, Query(description="First UK delivery date (YYYY-MM-DD)")] = None,
    end_date: Annotated[date | None, Query(description="Last UK delivery date (YYYY-MM-DD)")] = None,
    cutoff_time: Annotated[
        str | None, Query(description="Decision cutoff in UK local time, HH:MM (default 10:00)")
    ] = None,
    cutoff_days_before: Annotated[
        int | None,
        Query(ge=1, le=MAX_DAYS_BEFORE, description="Cutoff day relative to delivery (D-n)"),
    ] = None,
) -> AnalysisParams:
    settings = container.settings
    days_before = cutoff_days_before or settings.default_cutoff_days_before
    cutoff = parse_cutoff_time(cutoff_time) if cutoff_time else settings.default_cutoff_time
    default_start, default_end = default_window(settings, days_before)
    start = start_date or default_start
    end = end_date or default_end
    if start > end:
        raise ApiError(422, "validation_error", "start_date must be on or before end_date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ApiError(422, "validation_error", f"Date range cannot exceed {MAX_RANGE_DAYS} days.")
    return AnalysisParams(start, end, CutoffPolicy(cutoff, days_before))


ParamsDep = Annotated[AnalysisParams, Depends(analysis_params)]


def window_payload(params: AnalysisParams) -> dict[str, object]:
    return {
        "start_date": params.start_date.isoformat(),
        "end_date": params.end_date.isoformat(),
        "cutoff_time": params.policy.cutoff_time.strftime("%H:%M"),
        "cutoff_days_before": params.policy.days_before,
        "cutoff_label": params.policy.label,
    }
