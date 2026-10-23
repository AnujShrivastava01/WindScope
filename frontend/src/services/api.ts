import type {
  AccuracySummaryResponse,
  ActualRow,
  DataHealthResponse,
  DistributionResponse,
  ForecastRow,
  HealthResponse,
  ImportResponse,
  MetaResponse,
  OverviewResponse,
  PeriodPage,
  RecordPage,
  RefreshResponse,
  TimeseriesResponse,
  VintagesResponse,
} from '@/types/api'

/** Base URL of the backend. Empty string = same origin (dev proxy / nginx proxy). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

// Generous enough for a free-tier API host waking from sleep (cold start + data load).
const DEFAULT_TIMEOUT_MS = 90_000
const REFRESH_TIMEOUT_MS = 180_000

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

export function buildUrl(path: string, params?: QueryParams): string {
  const search = new URLSearchParams()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
    }
  }
  const qs = search.toString()
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`
}

async function request<T>(
  path: string,
  { params, init, timeoutMs = DEFAULT_TIMEOUT_MS }: { params?: QueryParams; init?: RequestInit; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outerSignal = init?.signal
  outerSignal?.addEventListener('abort', () => controller.abort())
  let response: Response
  try {
    response = await fetch(buildUrl(path, params), {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (err) {
    if (controller.signal.aborted && !outerSignal?.aborted) {
      throw new ApiError(0, 'timeout', 'The WindScope API did not respond in time.')
    }
    if (outerSignal?.aborted) throw err
    throw new ApiError(0, 'network_error', 'Cannot reach the WindScope API. Check that the backend is running.')
  } finally {
    clearTimeout(timer)
  }
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(
      response.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed with HTTP ${response.status}.`,
      err?.details,
    )
  }
  return body as T
}

export interface AnalysisQuery {
  start_date?: string
  end_date?: string
  cutoff_time?: string
  cutoff_days_before?: number
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', { init: { signal } }),
  meta: (signal?: AbortSignal) => request<MetaResponse>('/api/meta', { init: { signal } }),
  overview: (q: AnalysisQuery, signal?: AbortSignal) =>
    request<OverviewResponse>('/api/overview', { params: { ...q }, init: { signal } }),
  accuracySummary: (q: AnalysisQuery, signal?: AbortSignal) =>
    request<AccuracySummaryResponse>('/api/accuracy/summary', { params: { ...q }, init: { signal } }),
  timeseries: (q: AnalysisQuery, signal?: AbortSignal) =>
    request<TimeseriesResponse>('/api/accuracy/timeseries', { params: { ...q }, init: { signal } }),
  distribution: (q: AnalysisQuery, signal?: AbortSignal) =>
    request<DistributionResponse>('/api/accuracy/distribution', { params: { ...q }, init: { signal } }),
  forecastPeriods: (q: AnalysisQuery & QueryParams, signal?: AbortSignal) =>
    request<PeriodPage>('/api/forecast-periods', { params: q, init: { signal } }),
  forecastVintages: (q: { target_time: string; cutoff_time?: string; cutoff_days_before?: number }, signal?: AbortSignal) =>
    request<VintagesResponse>('/api/forecast-vintages', { params: { ...q }, init: { signal } }),
  actuals: (q: AnalysisQuery & QueryParams, signal?: AbortSignal) =>
    request<RecordPage<ActualRow>>('/api/actuals', { params: q, init: { signal } }),
  forecasts: (q: AnalysisQuery & QueryParams, signal?: AbortSignal) =>
    request<RecordPage<ForecastRow>>('/api/forecasts', { params: q, init: { signal } }),
  dataHealth: (signal?: AbortSignal) => request<DataHealthResponse>('/api/data-health', { init: { signal } }),
  refresh: () => request<RefreshResponse>('/api/data/refresh', { init: { method: 'POST' }, timeoutMs: REFRESH_TIMEOUT_MS }),
  importCsv: (dataset: 'actual' | 'forecast', file: File) => {
    const form = new FormData()
    form.append('dataset', dataset)
    form.append('file', file)
    return request<ImportResponse>('/api/data/import', { init: { method: 'POST', body: form }, timeoutMs: 120_000 })
  },
  exportUrl: (params: QueryParams) => buildUrl('/api/export/csv', params),
}

/** Download a CSV export, surfacing API errors instead of saving an error page. */
export async function downloadCsv(params: QueryParams): Promise<{ filename: string; rows: number }> {
  const response = await fetch(api.exportUrl(params))
  if (!response.ok) {
    let message = `Export failed with HTTP ${response.status}.`
    try {
      message = ((await response.json()) as { error?: { message?: string } }).error?.message ?? message
    } catch {
      /* keep default message */
    }
    throw new ApiError(response.status, 'export_failed', message)
  }
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'windscope_export.csv'
  const rows = Number(response.headers.get('X-Record-Count') ?? '0')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return { filename, rows }
}
