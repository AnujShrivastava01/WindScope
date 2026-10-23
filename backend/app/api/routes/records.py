"""Raw record browsing and CSV export endpoints."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.deps import ContainerDep, ParamsDep
from app.core.errors import ApiError
from app.schemas.responses import ErrorResponse, RecordPage
from app.services.csv_io import actuals_export_frame, forecasts_export_frame, to_csv_bytes
from app.services.forecast_selection import STATUS_DESCRIPTIONS
from app.utils.time import TimestampError, local_day_bounds, parse_utc, settlement_periods

router = APIRouter(prefix="/api", tags=["records"], responses={422: {"model": ErrorResponse}})

PageQ = Annotated[int, Query(ge=1)]
PageSizeQ = Annotated[int, Query(ge=1, le=500)]
OrderQ = Literal["asc", "desc"]
SourceQ = Annotated[Literal["elexon_api", "csv_import"] | None, Query()]
SearchQ = Annotated[str | None, Query(max_length=40, description="Matches timestamps or settlement date")]


def _bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return local_day_bounds(start)[0], local_day_bounds(end)[1]


def _expected_periods(start: date, end: date) -> int:
    total, day = 0, start
    while day <= end:
        total += len(settlement_periods(day))
        day = date.fromordinal(day.toordinal() + 1)
    return total


def _optional_ts(value: str | None, name: str) -> datetime | None:
    if not value:
        return None
    try:
        return parse_utc(value)
    except TimestampError as exc:
        raise ApiError(422, "validation_error", f"{name} must be an ISO-8601 timestamp.") from exc


@router.get("/actuals", response_model=RecordPage, summary="FUELHH WIND actual generation records")
def list_actuals(
    container: ContainerDep,
    params: ParamsDep,
    page: PageQ = 1,
    page_size: PageSizeQ = 50,
    sort: str = "start_time",
    order: OrderQ = "asc",
    source: SourceQ = None,
    search: SearchQ = None,
) -> dict[str, object]:
    start, end = _bounds(params.start_date, params.end_date)
    result = container.repo.page_actuals(
        start, end, page=page, page_size=page_size, sort=sort, descending=order == "desc",
        source=source, search=search,
    )  # fmt: skip
    expected = _expected_periods(params.start_date, params.end_date)
    stored = container.repo.page_actuals(start, end, page=1, page_size=1, sort="start_time", descending=False)
    return {
        "items": result.items,
        "total": result.total,
        "page": page,
        "page_size": page_size,
        "expected_periods": expected,
        "missing_periods": max(expected - stored.total, 0),
    }


@router.get("/forecasts", response_model=RecordPage, summary="WINDFOR forecast records (all vintages)")
def list_forecasts(
    container: ContainerDep,
    params: ParamsDep,
    page: PageQ = 1,
    page_size: PageSizeQ = 50,
    sort: str = "start_time",
    order: OrderQ = "asc",
    publish_from: Annotated[str | None, Query(description="Minimum publishTime (ISO-8601)")] = None,
    publish_to: Annotated[str | None, Query(description="Maximum publishTime (ISO-8601)")] = None,
    source: SourceQ = None,
    search: SearchQ = None,
) -> dict[str, object]:
    start, end = _bounds(params.start_date, params.end_date)
    result = container.repo.page_forecasts(
        start, end, page=page, page_size=page_size, sort=sort, descending=order == "desc",
        publish_from=_optional_ts(publish_from, "publish_from"),
        publish_to=_optional_ts(publish_to, "publish_to"), source=source, search=search,
    )  # fmt: skip
    return {"items": result.items, "total": result.total, "page": page, "page_size": page_size}


@router.get(
    "/export/csv",
    summary="Download filtered records as CSV",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
)
def export_csv(
    container: ContainerDep,
    params: ParamsDep,
    dataset: Literal["actuals", "forecasts", "analysis"] = "analysis",
    sort: str = "start_time",
    order: OrderQ = "asc",
    publish_from: str | None = None,
    publish_to: str | None = None,
    source: SourceQ = None,
    search: SearchQ = None,
    status: str | None = None,
) -> Response:
    start, end = _bounds(params.start_date, params.end_date)
    descending = order == "desc"
    if dataset == "actuals":
        page = container.repo.page_actuals(
            start,
            end,
            page=1,
            page_size=0,
            sort=sort,
            descending=descending,
            source=source,
            search=search,
        )
        frame = actuals_export_frame(page.items)
    elif dataset == "forecasts":
        page = container.repo.page_forecasts(
            start, end, page=1, page_size=0, sort=sort, descending=descending,
            publish_from=_optional_ts(publish_from, "publish_from"),
            publish_to=_optional_ts(publish_to, "publish_to"), source=source, search=search,
        )  # fmt: skip
        frame = forecasts_export_frame(page.items)
    else:
        if status and status not in STATUS_DESCRIPTIONS:
            raise ApiError(422, "validation_error", f"Unknown status '{status}'.")
        frame = container.analysis.export_frame(params, status)
    cutoff = params.policy.cutoff_time.strftime("%H%M")
    suffix = f"_cutoff{cutoff}_D-{params.policy.days_before}" if dataset == "analysis" else ""
    filename = f"windscope_{dataset}_{params.start_date}_{params.end_date}{suffix}.csv"
    return Response(
        content=to_csv_bytes(frame),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Record-Count": str(len(frame)),
        },
    )
