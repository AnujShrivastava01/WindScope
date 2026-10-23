// Types mirroring the FastAPI response models (backend/app/schemas/responses.py).

export type PeriodStatus =
  | 'matched'
  | 'missing_actual'
  | 'missing_forecast'
  | 'late_forecast_only'
  | 'missing_both'
  | 'no_forecast_target'

export interface AnalysisWindow {
  start_date: string
  end_date: string
  cutoff_time: string
  cutoff_days_before: number
  cutoff_label: string
}

export interface Metrics {
  count: number
  invalid_pairs: number
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  mape_pct: number | null
  mape_count: number
  mape_excluded: number
  wape_pct: number | null
  max_abs_error_mw: number | null
  std_error_mw: number | null
  overestimation_pct: number | null
  underestimation_pct: number | null
  exact_pct: number | null
  overestimation_count: number
  underestimation_count: number
  exact_count: number
  mean_forecast_mw: number | null
  mean_actual_mw: number | null
  abs_error_p50_mw: number | null
  abs_error_p90_mw: number | null
  abs_error_p95_mw: number | null
  error_p10_mw: number | null
  error_p90_mw: number | null
  correlation: number | null
}

export interface Coverage {
  total_periods: number
  forecast_target_periods: number
  matched: number
  unmatched: number
  missing_actual: number
  missing_forecast: number
  late_forecast_only: number
  missing_both: number
  no_forecast_target: number
  periods_with_forecast: number
  actual_observed: number
  actual_missing: number
  forecast_coverage_pct: number | null
  match_rate_pct: number | null
  actual_coverage_pct: number | null
}

export interface Period {
  start_time: string
  delivery_date: string
  settlement_period: number
  decision_date: string
  cutoff_time: string
  forecast_mw: number | null
  forecast_publish_time: string | null
  forecast_horizon_hours: number | null
  eligible_vintages: number
  excluded_late_vintages: number
  actual_mw: number | null
  error_mw: number | null
  abs_error_mw: number | null
  latest_available_mw: number | null
  latest_available_publish_time: string | null
  status: PeriodStatus
}

export interface GroupMetrics {
  count: number
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  max_abs_error_mw: number | null
  mean_forecast_mw: number | null
  mean_actual_mw: number | null
  overestimation_count: number
  underestimation_count: number
}

export interface DailyMetrics extends GroupMetrics {
  delivery_date: string
}

export interface HourlyMetrics extends GroupMetrics {
  local_hour: number
}

export interface DailyCoverage {
  delivery_date: string
  total_periods: number
  forecast_target_periods: number
  matched: number
  missing_actual: number
  missing_forecast: number
  late_forecast_only: number
  actual_observed: number
  actual_missing: number
  match_rate_pct: number | null
}

export interface OverviewResponse {
  window: AnalysisWindow
  kpis: {
    latest_forecast: Period | null
    latest_actual: Period | null
    latest_matched: Period | null
    metrics: Metrics
    coverage: Coverage
  }
  recent_periods: Period[]
  data_version: number
}

export interface AccuracySummaryResponse {
  window: AnalysisWindow
  metrics: Metrics
  coverage: Coverage
  daily: DailyMetrics[]
  by_hour: HourlyMetrics[]
  daily_coverage: DailyCoverage[]
  largest_errors: Period[]
}

export interface TimeseriesResponse {
  window: AnalysisWindow
  count: number
  items: Period[]
}

export interface HistogramBin {
  bin_start: number | null
  bin_end: number | null
  count: number
  share_pct: number | null
}

export interface ScatterPoint {
  start_time: string | null
  forecast_mw: number | null
  actual_mw: number | null
  error_mw: number | null
}

export interface DistributionResponse {
  window: AnalysisWindow
  count: number
  abs_error_histogram: HistogramBin[]
  error_histogram: HistogramBin[]
  scatter: ScatterPoint[]
  quantiles: Record<string, number | null>
}

export interface PeriodPage {
  window: AnalysisWindow
  items: Period[]
  total: number
  page: number
  page_size: number
}

export interface Vintage {
  publish_time: string | null
  generation_mw: number | null
  source: string
  horizon_hours: number | null
  eligible: boolean
  selected: boolean
  is_latest_available: boolean
  error_mw: number | null
}

export interface VintagesResponse {
  target_time: string
  delivery_date: string
  decision_date: string
  cutoff_time: string
  cutoff_rule: string
  actual_mw: number | null
  selected: Vintage | null
  latest_available: Vintage | null
  vintages: Vintage[]
  eligible_count: number
  excluded_late_count: number
  duplicates_resolved: number
  duplicate_conflicts: number
  explanation: string
}

export interface ActualRow {
  start_time: string
  settlement_date: string | null
  settlement_period: number | null
  generation_mw: number
  publish_time: string | null
  source: string
  ingested_at: string
}

export interface ForecastRow {
  start_time: string
  publish_time: string
  generation_mw: number
  source: string
  ingested_at: string
}

export interface RecordPage<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  unit: string
  expected_periods: number | null
  missing_periods: number | null
}

export type RefreshStatus = 'success' | 'partial' | 'failed'

export interface RefreshLogEntry {
  id?: number
  dataset: string
  trigger: string
  status: RefreshStatus
  started_at: string
  finished_at: string
  requests: number
  retries: number
  received: number
  inserted: number
  updated: number
  unchanged: number
  rejected: number
  duplicates: number
  duplicate_conflicts: number
  missing_publish_time: number
  error: string | null
}

export interface RefreshResponse {
  status: RefreshStatus
  trigger: string
  started_at: string | null
  finished_at: string | null
  datasets: Record<string, RefreshLogEntry>
  window: Record<string, string>
  deduplicated: boolean
}

export interface ImportResponse {
  status: RefreshStatus
  dataset: 'actual' | 'forecast'
  filename: string | null
  columns: string[]
  received: number
  accepted: number
  filtered_out_non_wind: number
  duplicates: number
  duplicate_conflicts: number
  inserted: number
  updated: number
  unchanged: number
  skipped_existing_api: number
  rejected: number
  rejected_rows: { row: number; reason: string }[]
}

export interface HealthResponse {
  status: string
  version: string
  database: string
  refresh_in_progress: boolean
  records: Record<string, number>
  time: string
}

export interface MetaResponse {
  app_name: string
  version: string
  decision_date_start: string
  decision_date_end: string
  default_window: AnalysisWindow
  default_cutoff_time: string
  default_cutoff_days_before: number
  max_cutoff_days_before: number
  timezone: string
  statuses: { status: PeriodStatus; description: string }[]
  assumptions: string[]
}

export type DatasetHealthStatus = 'ok' | 'incomplete' | 'stale' | 'empty'

export interface DatasetHealth {
  label: string
  records: number
  first_target: string | null
  last_target: string | null
  last_ingested: string | null
  first_publish?: string | null
  last_publish?: string | null
  vintages?: number
  by_source: Record<string, number>
  last_successful_fetch: string | null
  last_attempt: RefreshLogEntry | null
  expected_missing_in_window: number
  status: DatasetHealthStatus
  reasons: string[]
  totals: Partial<Record<'runs' | 'retries' | 'failures' | 'duplicates' | 'rejected' | 'missing_publish_time', number>>
}

export interface DataHealthResponse {
  generated_at: string
  window: AnalysisWindow
  ingestion_window: Record<string, string>
  datasets: { actual: DatasetHealth; forecast: DatasetHealth }
  coverage: Coverage
  daily_coverage: DailyCoverage[]
  missing_periods: { start_time: string; status: PeriodStatus; has_actual: boolean }[]
  missing_periods_total: number
  cache: { entries: number; hits: number; misses: number; data_version: number; storage: string }
  refresh_in_progress: boolean
  last_refresh: RefreshResponse | null
  refresh_history: RefreshLogEntry[]
  stale_after_hours: number
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}
