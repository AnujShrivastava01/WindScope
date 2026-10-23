"""Pydantic response models (also drive the OpenAPI documentation)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class AnalysisWindow(BaseModel):
    start_date: str = Field(description="First UK delivery date (inclusive)")
    end_date: str = Field(description="Last UK delivery date (inclusive)")
    cutoff_time: str = Field(description="Decision cutoff, UK local time HH:MM")
    cutoff_days_before: int = Field(description="Cutoff is on delivery date minus this many days")
    cutoff_label: str


class Metrics(BaseModel):
    count: int
    invalid_pairs: int
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    mape_pct: float | None
    mape_count: int
    mape_excluded: int
    wape_pct: float | None
    max_abs_error_mw: float | None
    std_error_mw: float | None
    overestimation_pct: float | None
    underestimation_pct: float | None
    exact_pct: float | None
    overestimation_count: int
    underestimation_count: int
    exact_count: int
    mean_forecast_mw: float | None
    mean_actual_mw: float | None
    abs_error_p50_mw: float | None
    abs_error_p90_mw: float | None
    abs_error_p95_mw: float | None
    error_p10_mw: float | None
    error_p90_mw: float | None
    correlation: float | None


class Coverage(BaseModel):
    total_periods: int
    forecast_target_periods: int
    matched: int
    unmatched: int
    missing_actual: int
    missing_forecast: int
    late_forecast_only: int
    missing_both: int
    no_forecast_target: int
    periods_with_forecast: int
    actual_observed: int
    actual_missing: int
    forecast_coverage_pct: float | None
    match_rate_pct: float | None
    actual_coverage_pct: float | None


class Period(BaseModel):
    start_time: str
    delivery_date: str
    settlement_period: int
    decision_date: str
    cutoff_time: str
    forecast_mw: float | None
    forecast_publish_time: str | None
    forecast_horizon_hours: float | None
    eligible_vintages: int
    excluded_late_vintages: int
    actual_mw: float | None
    error_mw: float | None
    abs_error_mw: float | None
    latest_available_mw: float | None
    latest_available_publish_time: str | None
    status: str


class GroupMetrics(BaseModel):
    count: int
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None
    max_abs_error_mw: float | None
    mean_forecast_mw: float | None
    mean_actual_mw: float | None
    overestimation_count: int
    underestimation_count: int


class DailyMetrics(GroupMetrics):
    delivery_date: str


class HourlyMetrics(GroupMetrics):
    local_hour: int


class DailyCoverage(BaseModel):
    delivery_date: str
    total_periods: int
    forecast_target_periods: int
    matched: int
    missing_actual: int
    missing_forecast: int
    late_forecast_only: int
    actual_observed: int
    actual_missing: int
    match_rate_pct: float | None


class OverviewKpis(BaseModel):
    latest_forecast: Period | None
    latest_actual: Period | None
    latest_matched: Period | None
    metrics: Metrics
    coverage: Coverage


class OverviewResponse(BaseModel):
    window: AnalysisWindow
    kpis: OverviewKpis
    recent_periods: list[Period]
    data_version: int


class AccuracySummaryResponse(BaseModel):
    window: AnalysisWindow
    metrics: Metrics
    coverage: Coverage
    daily: list[DailyMetrics]
    by_hour: list[HourlyMetrics]
    daily_coverage: list[DailyCoverage]
    largest_errors: list[Period]


class TimeseriesResponse(BaseModel):
    window: AnalysisWindow
    count: int
    items: list[Period]


class HistogramBin(BaseModel):
    bin_start: float | None
    bin_end: float | None
    count: int
    share_pct: float | None


class ScatterPoint(BaseModel):
    start_time: str | None
    forecast_mw: float | None
    actual_mw: float | None
    error_mw: float | None


class DistributionResponse(BaseModel):
    window: AnalysisWindow
    count: int
    abs_error_histogram: list[HistogramBin]
    error_histogram: list[HistogramBin]
    scatter: list[ScatterPoint]
    quantiles: dict[str, float | None]


class PeriodPage(BaseModel):
    window: AnalysisWindow
    items: list[Period]
    total: int
    page: int
    page_size: int


class Vintage(BaseModel):
    publish_time: str | None
    generation_mw: float | None
    source: str
    horizon_hours: float | None
    eligible: bool
    selected: bool
    is_latest_available: bool
    error_mw: float | None


class VintagesResponse(BaseModel):
    target_time: str
    delivery_date: str
    decision_date: str
    cutoff_time: str
    cutoff_rule: str
    actual_mw: float | None
    selected: Vintage | None
    latest_available: Vintage | None
    vintages: list[Vintage]
    eligible_count: int
    excluded_late_count: int
    duplicates_resolved: int
    duplicate_conflicts: int
    explanation: str


class RecordPage(BaseModel):
    items: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    unit: str = "MW"
    expected_periods: int | None = None
    missing_periods: int | None = None


class RefreshResponse(BaseModel):
    status: str = Field(description="success | partial | failed")
    trigger: str
    started_at: str | None = None
    finished_at: str | None = None
    datasets: dict[str, dict[str, Any]] = {}
    window: dict[str, Any] = {}
    deduplicated: bool = False


class ImportResponse(BaseModel):
    status: str
    dataset: str
    filename: str | None
    columns: list[str]
    received: int
    accepted: int
    filtered_out_non_wind: int
    duplicates: int
    duplicate_conflicts: int
    inserted: int
    updated: int
    unchanged: int
    skipped_existing_api: int
    rejected: int
    rejected_rows: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str
    refresh_in_progress: bool
    records: dict[str, int]
    time: str


class MetaResponse(BaseModel):
    app_name: str
    version: str
    decision_date_start: str
    decision_date_end: str
    default_window: AnalysisWindow
    default_cutoff_time: str
    default_cutoff_days_before: int
    max_cutoff_days_before: int
    timezone: str
    statuses: list[dict[str, str]]
    assumptions: list[str]
