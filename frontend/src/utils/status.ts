import type { DatasetHealthStatus, PeriodStatus, RefreshStatus } from '@/types/api'

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export const PERIOD_STATUS: Record<PeriodStatus, { label: string; tone: Tone; description: string }> = {
  matched: { label: 'Matched', tone: 'success', description: 'Decision-time forecast and actual both available.' },
  missing_actual: {
    label: 'Actual missing',
    tone: 'warning',
    description: 'Forecast selected but actual outturn has not been observed/stored.',
  },
  missing_forecast: { label: 'No forecast', tone: 'danger', description: 'No WINDFOR forecast exists for this period.' },
  late_forecast_only: {
    label: 'Late only',
    tone: 'danger',
    description: 'All forecasts for this period were published after the decision cutoff.',
  },
  missing_both: { label: 'No data', tone: 'danger', description: 'Neither forecast nor actual is available.' },
  no_forecast_target: {
    label: 'Half-hour',
    tone: 'neutral',
    description: 'WINDFOR is hourly; this half-hour period has no forecast target.',
  },
}

export const DATASET_STATUS: Record<DatasetHealthStatus, { label: string; tone: Tone }> = {
  ok: { label: 'Healthy', tone: 'success' },
  incomplete: { label: 'Incomplete', tone: 'warning' },
  stale: { label: 'Stale', tone: 'warning' },
  empty: { label: 'No data', tone: 'danger' },
}

export const REFRESH_STATUS: Record<RefreshStatus, { label: string; tone: Tone }> = {
  success: { label: 'Success', tone: 'success' },
  partial: { label: 'Partial', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}
