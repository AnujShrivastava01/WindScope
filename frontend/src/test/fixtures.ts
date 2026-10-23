// SYNTHETIC test fixtures. These values are invented for unit tests only and are
// never used by the running application.
import type {
  AccuracySummaryResponse,
  DataHealthResponse,
  MetaResponse,
  Metrics,
  OverviewResponse,
  Period,
  TimeseriesResponse,
} from '@/types/api'

export const window = {
  start_date: '2026-01-02',
  end_date: '2026-01-02',
  cutoff_time: '10:00',
  cutoff_days_before: 1,
  cutoff_label: '10:00 Europe/London, D-1',
}

export function period(overrides: Partial<Period> = {}): Period {
  return {
    start_time: '2026-01-02T00:00:00Z',
    delivery_date: '2026-01-02',
    settlement_period: 1,
    decision_date: '2026-01-01',
    cutoff_time: '2026-01-01T10:00:00Z',
    forecast_mw: 1050,
    forecast_publish_time: '2026-01-01T09:30:00Z',
    forecast_horizon_hours: 14.5,
    eligible_vintages: 2,
    excluded_late_vintages: 1,
    actual_mw: 1000,
    error_mw: 50,
    abs_error_mw: 50,
    latest_available_mw: 1001,
    latest_available_publish_time: '2026-01-01T15:30:00Z',
    status: 'matched',
    ...overrides,
  }
}

export const metrics: Metrics = {
  count: 2,
  invalid_pairs: 0,
  mae_mw: 75,
  rmse_mw: 79.06,
  bias_mw: 75,
  mape_pct: 6.67,
  mape_count: 2,
  mape_excluded: 0,
  wape_pct: 6.82,
  max_abs_error_mw: 100,
  std_error_mw: 35.36,
  overestimation_pct: 100,
  underestimation_pct: 0,
  exact_pct: 0,
  overestimation_count: 2,
  underestimation_count: 0,
  exact_count: 0,
  mean_forecast_mw: 1175,
  mean_actual_mw: 1100,
  abs_error_p50_mw: 75,
  abs_error_p90_mw: 95,
  abs_error_p95_mw: 97.5,
  error_p10_mw: 55,
  error_p90_mw: 95,
  correlation: 1,
}

const emptyMetrics: Metrics = {
  ...metrics,
  count: 0,
  mae_mw: null,
  rmse_mw: null,
  bias_mw: null,
  mape_pct: null,
  wape_pct: null,
  max_abs_error_mw: null,
  overestimation_pct: null,
  underestimation_pct: null,
  exact_pct: null,
  overestimation_count: 0,
  mean_forecast_mw: null,
  mean_actual_mw: null,
  correlation: null,
}

export const coverage = {
  total_periods: 48,
  forecast_target_periods: 24,
  matched: 2,
  unmatched: 22,
  missing_actual: 0,
  missing_forecast: 0,
  late_forecast_only: 1,
  missing_both: 21,
  no_forecast_target: 24,
  periods_with_forecast: 2,
  actual_observed: 3,
  actual_missing: 45,
  forecast_coverage_pct: 8.33,
  match_rate_pct: 8.33,
  actual_coverage_pct: 6.25,
}

const matchedLate = period({
  start_time: '2026-01-02T01:00:00Z',
  settlement_period: 3,
  forecast_mw: 1300,
  actual_mw: 1200,
  error_mw: 100,
  abs_error_mw: 100,
})
const lateOnly = period({
  start_time: '2026-01-02T02:00:00Z',
  settlement_period: 5,
  forecast_mw: null,
  forecast_publish_time: null,
  actual_mw: null,
  error_mw: null,
  abs_error_mw: null,
  status: 'late_forecast_only',
})

export const overview: OverviewResponse = {
  window,
  kpis: {
    latest_forecast: matchedLate,
    latest_actual: matchedLate,
    latest_matched: matchedLate,
    metrics,
    coverage,
  },
  recent_periods: [lateOnly, matchedLate, period()],
  data_version: 1,
}

export const emptyOverview: OverviewResponse = {
  window,
  kpis: {
    latest_forecast: null,
    latest_actual: null,
    latest_matched: null,
    metrics: emptyMetrics,
    coverage: { ...coverage, matched: 0, actual_observed: 0, periods_with_forecast: 0 },
  },
  recent_periods: [],
  data_version: 0,
}

export const timeseries: TimeseriesResponse = { window, count: 3, items: [period(), matchedLate, lateOnly] }

export const summary: AccuracySummaryResponse = {
  window,
  metrics,
  coverage,
  daily: [
    {
      delivery_date: '2026-01-02',
      count: 2,
      mae_mw: 75,
      rmse_mw: 79.06,
      bias_mw: 75,
      max_abs_error_mw: 100,
      mean_forecast_mw: 1175,
      mean_actual_mw: 1100,
      overestimation_count: 2,
      underestimation_count: 0,
    },
  ],
  by_hour: [],
  daily_coverage: [],
  largest_errors: [matchedLate],
}

export const meta: MetaResponse = {
  app_name: 'WindScope API',
  version: '1.0.0',
  decision_date_start: '2026-01-01',
  decision_date_end: '2026-01-31',
  default_window: { ...window, end_date: '2026-02-01' },
  default_cutoff_time: '10:00',
  default_cutoff_days_before: 1,
  max_cutoff_days_before: 2,
  timezone: 'Europe/London',
  statuses: [{ status: 'matched', description: 'Both available.' }],
  assumptions: ['Synthetic assumption for tests.'],
}

export const health = {
  status: 'ok',
  version: '1.0.0',
  database: 'ok',
  refresh_in_progress: false,
  records: { actual: 3, forecast: 5 },
  time: '2026-02-05T12:00:00Z',
}

export const dataHealth = {
  generated_at: '2026-02-05T12:00:00Z',
  window,
  datasets: {
    actual: { status: 'ok', reasons: ['ok'], last_successful_fetch: '2026-02-05T11:00:00Z' },
    forecast: { status: 'ok', reasons: ['ok'], last_successful_fetch: '2026-02-05T11:00:00Z' },
  },
} as unknown as DataHealthResponse
