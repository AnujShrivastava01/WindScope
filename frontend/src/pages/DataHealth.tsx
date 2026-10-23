import { CheckCircle2, RefreshCw } from 'lucide-react'

import { CoverageChart } from '@/components/charts/AccuracyCharts'
import { PageHeader } from '@/components/layout/AppLayout'
import { useRefreshWithFeedback } from '@/components/layout/Header'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { StatusBadge } from '@/components/tables/periodColumns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ErrorState, LoadingBlock } from '@/components/ui/feedback'
import { useDataHealth } from '@/hooks/queries'
import type { DatasetHealth, RefreshLogEntry } from '@/types/api'
import { formatNumber, formatPct, formatUk, formatUkFull, relativeTime } from '@/utils/format'
import { DATASET_STATUS, REFRESH_STATUS } from '@/utils/status'

const HISTORY_COLUMNS: Column<RefreshLogEntry>[] = [
  { key: 'when', header: 'Finished (UK)', render: (r) => formatUk(r.finished_at) },
  { key: 'dataset', header: 'Dataset', render: (r) => (r.dataset === 'actual' ? 'FUELHH' : 'WINDFOR') },
  { key: 'trigger', header: 'Trigger', render: (r) => r.trigger.replace('_', ' ') },
  { key: 'status', header: 'Result', render: (r) => <Badge tone={REFRESH_STATUS[r.status].tone}>{REFRESH_STATUS[r.status].label}</Badge> },
  { key: 'received', header: 'Received', align: 'right', render: (r) => formatNumber(r.received) },
  { key: 'inserted', header: 'New / updated', align: 'right', render: (r) => `${formatNumber(r.inserted)} / ${formatNumber(r.updated)}` },
  { key: 'dups', header: 'Duplicates', align: 'right', render: (r) => formatNumber(r.duplicates) },
  { key: 'rejected', header: 'Rejected', align: 'right', render: (r) => formatNumber(r.rejected) },
  { key: 'retries', header: 'Requests / retries', align: 'right', render: (r) => `${r.requests} / ${r.retries}` },
  {
    key: 'error',
    header: 'Notes',
    className: 'max-w-72 truncate whitespace-nowrap',
    render: (r) => <span title={r.error ?? undefined}>{r.error ?? '—'}</span>,
  },
]

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900 tabular">{value}</dd>
    </div>
  )
}

function DatasetCard({ name, d }: { name: string; d: DatasetHealth }) {
  const status = DATASET_STATUS[d.status]
  return (
    <Card>
      <CardHeader
        title={name}
        description={d.label}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-xs text-slate-600">
          {d.reasons.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span aria-hidden>•</span>
              {r}
            </li>
          ))}
        </ul>
        <dl>
          <Stat
            label="Last successful fetch"
            value={d.last_successful_fetch ? `${formatUk(d.last_successful_fetch)} (${relativeTime(d.last_successful_fetch)})` : 'Never'}
          />
          <Stat
            label="Last attempt"
            value={
              d.last_attempt ? (
                <span className="inline-flex items-center gap-2">
                  {formatUk(d.last_attempt.finished_at)}
                  <Badge tone={REFRESH_STATUS[d.last_attempt.status].tone}>{REFRESH_STATUS[d.last_attempt.status].label}</Badge>
                </span>
              ) : (
                '—'
              )
            }
          />
          <Stat label="Records stored" value={formatNumber(d.records)} />
          <Stat label="Target range" value={d.first_target ? `${formatUk(d.first_target)} → ${formatUk(d.last_target)}` : '—'} />
          <Stat label="Latest record timestamp" value={formatUkFull(d.last_target)} />
          {d.vintages !== undefined && <Stat label="Distinct publish times (vintages)" value={formatNumber(d.vintages)} />}
          {d.last_publish !== undefined && <Stat label="Latest publish time" value={formatUkFull(d.last_publish ?? null)} />}
          <Stat label="Expected periods missing (analysis window)" value={formatNumber(d.expected_missing_in_window)} />
          <Stat label="Duplicates removed (all refreshes)" value={formatNumber(d.totals.duplicates ?? 0)} />
          <Stat label="Rows rejected (all refreshes)" value={formatNumber(d.totals.rejected ?? 0)} />
          {d.totals.missing_publish_time !== undefined && name.includes('WINDFOR') && (
            <Stat label="Missing publish timestamps" value={formatNumber(d.totals.missing_publish_time)} />
          )}
          <Stat label="Failed runs / retries" value={`${formatNumber(d.totals.failures ?? 0)} / ${formatNumber(d.totals.retries ?? 0)}`} />
          <Stat
            label="By source"
            value={Object.entries(d.by_source).map(([k, v]) => `${k === 'elexon_api' ? 'API' : 'CSV'} ${formatNumber(v)}`).join(' · ') || '—'}
          />
        </dl>
      </CardContent>
    </Card>
  )
}

export default function DataHealth() {
  const health = useDataHealth()
  const { run, isPending } = useRefreshWithFeedback()
  const h = health.data
  const last = h?.last_refresh

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Health"
        description="Freshness, completeness and integrity of the two Elexon datasets for the January 2026 decision window. Status rules are stated explicitly below."
        actions={
          <Button onClick={run} disabled={isPending || h?.refresh_in_progress}>
            <RefreshCw aria-hidden className={isPending ? 'animate-spin' : undefined} />
            {isPending ? 'Refreshing from Elexon…' : 'Refresh from Elexon'}
          </Button>
        }
      />

      {health.isLoading ? (
        <LoadingBlock />
      ) : health.isError ? (
        <ErrorState error={health.error} onRetry={() => health.refetch()} />
      ) : h ? (
        <>
          {last && (
            <div
              role="status"
              className={
                last.status === 'success'
                  ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900'
                  : last.status === 'partial'
                    ? 'rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
                    : 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900'
              }
            >
              <p className="font-medium">
                Last refresh ({last.trigger}) {REFRESH_STATUS[last.status].label.toLowerCase()} at {formatUkFull(last.finished_at)}
              </p>
              <p className="mt-0.5 text-xs">
                {Object.entries(last.datasets)
                  .map(([k, d]) => `${k === 'actual' ? 'FUELHH' : 'WINDFOR'}: ${d.status}, ${formatNumber(d.received)} received, ${formatNumber(d.inserted)} new${d.error ? ` — ${d.error}` : ''}`)
                  .join(' · ')}
              </p>
            </div>
          )}
          {isPending && (
            <div role="status" className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              Fetching FUELHH and WINDFOR from Elexon. Existing data stays available while this runs.
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <DatasetCard name="Actual generation (FUELHH)" d={h.datasets.actual} />
            <DatasetCard name="Wind forecasts (WINDFOR)" d={h.datasets.forecast} />
          </div>

          <Card>
            <CardHeader
              title="January 2026 coverage"
              description={`Default analysis window: delivery ${h.window.start_date} to ${h.window.end_date} (decision dates 1–31 Jan), cutoff ${h.window.cutoff_label}.`}
            />
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                {(
                  [
                    ['Settlement periods', formatNumber(h.coverage.total_periods)],
                    ['Hourly forecast targets', formatNumber(h.coverage.forecast_target_periods)],
                    ['Matched', formatNumber(h.coverage.matched)],
                    ['Unmatched', formatNumber(h.coverage.unmatched)],
                    ['Actual missing', formatNumber(h.coverage.actual_missing)],
                    ['Forecast missing', formatNumber(h.coverage.missing_forecast + h.coverage.missing_both)],
                    ['Late-only forecast', formatNumber(h.coverage.late_forecast_only)],
                    ['Match rate', formatPct(h.coverage.match_rate_pct)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 px-3 py-2">
                    <dt className="text-[11px] text-slate-500">{label}</dt>
                    <dd className="text-lg font-semibold text-slate-900 tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              <CoverageChart days={h.daily_coverage} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Missing or unmatched periods"
                description={`${formatNumber(h.missing_periods_total)} period(s) in the analysis window lack a decision-time forecast or an actual.`}
              />
              {h.missing_periods.length === 0 ? (
                <CardContent>
                  <p className="flex items-center gap-2 text-sm text-emerald-800">
                    <CheckCircle2 aria-hidden className="size-4" /> Every expected period has both a decision-time forecast and an actual.
                  </p>
                </CardContent>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <DataTable
                    caption="Missing periods"
                    columns={[
                      { key: 't', header: 'Period (UK)', render: (r) => formatUk(r.start_time) },
                      { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                      { key: 'a', header: 'Actual', render: (r) => (r.has_actual ? 'Observed' : 'Missing') },
                    ]}
                    rows={h.missing_periods}
                    rowKey={(r) => r.start_time}
                  />
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="Cache and storage" description="How WindScope avoids repeated downloads and recomputation." />
              <CardContent>
                <dl>
                  <Stat label="Persistence" value={h.cache.storage} />
                  <Stat label="Data version" value={h.cache.data_version} />
                  <Stat label="Cached analyses" value={formatNumber(h.cache.entries)} />
                  <Stat label="Cache hits / misses" value={`${formatNumber(h.cache.hits)} / ${formatNumber(h.cache.misses)}`} />
                  <Stat label="Refresh in progress" value={h.refresh_in_progress ? 'Yes' : 'No'} />
                  <Stat label="Stale threshold" value={`${h.stale_after_hours} h since last successful API refresh`} />
                  <Stat
                    label="Ingestion window"
                    value={`FUELHH ${h.ingestion_window.actual_settlement_from} → ${h.ingestion_window.actual_settlement_to}`}
                  />
                  <Stat
                    label=""
                    value={`WINDFOR published ${formatUk(h.ingestion_window.forecast_publish_from)} → ${formatUk(h.ingestion_window.forecast_publish_to)}`}
                  />
                </dl>
                <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                  <p className="font-medium text-slate-700">Status rules</p>
                  <p>
                    <strong>No data</strong>: nothing stored. <strong>Incomplete</strong>: an expected period in the analysis window is missing.{' '}
                    <strong>Stale</strong>: no successful Elexon refresh, or the last one is older than {h.stale_after_hours} h.{' '}
                    <strong>Healthy</strong>: none of the above. A refresh is <em>partial</em> if any request chunk failed or returned nothing,
                    and <em>failed</em> if no data could be fetched.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader title="Refresh history" description="Every API refresh and CSV import is logged, including failures and retry counts." />
            <DataTable caption="Refresh history" columns={HISTORY_COLUMNS} rows={h.refresh_history} rowKey={(r) => String(r.id)} />
          </Card>
        </>
      ) : null}
    </div>
  )
}
