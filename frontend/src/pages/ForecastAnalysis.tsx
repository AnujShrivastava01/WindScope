import { Info, ShieldCheck, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

import { VintageChart } from '@/components/charts/VintageChart'
import { AnalysisFilterBar } from '@/components/filters/AnalysisFilterBar'
import { PageHeader } from '@/components/layout/AppLayout'
import { DataTable, type Column, type SortState } from '@/components/tables/DataTable'
import { ErrorValue, periodColumns } from '@/components/tables/periodColumns'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/feedback'
import { Field, Select } from '@/components/ui/form'
import { useForecastPeriods, useForecastVintages, useMeta } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import type { Period, PeriodStatus, Vintage } from '@/types/api'
import { formatMW, formatUk, formatUkFull } from '@/utils/format'
import { PERIOD_STATUS } from '@/utils/status'

const COLUMNS = periodColumns(['target', 'forecast', 'published', 'vintages', 'horizon', 'actual', 'error', 'status'])

const VINTAGE_COLUMNS: Column<Vintage>[] = [
  { key: 'published', header: 'Published (UK)', render: (v) => <span className="font-medium text-slate-900">{formatUk(v.publish_time)}</span> },
  { key: 'value', header: 'Forecast (MW)', align: 'right', render: (v) => formatMW(v.generation_mw, { unit: false }) },
  { key: 'lead', header: 'Lead time', align: 'right', render: (v) => (v.horizon_hours === null ? '—' : `${v.horizon_hours} h`) },
  { key: 'error', header: 'Error vs actual', align: 'right', render: (v) => <ErrorValue value={v.error_mw} /> },
  {
    key: 'eligible',
    header: 'At decision cutoff',
    render: (v) =>
      v.selected ? (
        <Badge tone="success">Selected</Badge>
      ) : v.eligible ? (
        <Badge tone="info" icon={false}>
          Eligible, superseded
        </Badge>
      ) : (
        <Badge tone="neutral">Excluded — published late</Badge>
      ),
  },
  {
    key: 'latest',
    header: '',
    render: (v) => (v.is_latest_available ? <span className="text-[11px] text-slate-500">latest stored</span> : null),
  },
]

export default function ForecastAnalysis() {
  const { query, filters, ready } = useAnalysisFilters()
  const meta = useMeta()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(24)
  const [sort, setSort] = useState<SortState>({ key: 'start_time', order: 'asc' })
  const [status, setStatus] = useState<'' | PeriodStatus>('matched')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => setPage(1), [query, status, pageSize])

  const periods = useForecastPeriods(
    { ...query, page, page_size: pageSize, sort: sort.key, order: sort.order, status: status || undefined },
    ready,
  )

  const firstRow = periods.data?.items[0]?.start_time ?? null
  const target = selected ?? firstRow
  const vintages = useForecastVintages(
    target ? { target_time: target, cutoff_time: filters.cutoffTime, cutoff_days_before: filters.daysBefore } : null,
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Forecast Analysis"
        description="Inspect which WINDFOR forecast vintage was available at the purchase decision cutoff for each target settlement period — and which later vintages were deliberately excluded."
      />
      <AnalysisFilterBar />

      <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="leading-relaxed">
          <strong>Selection rule:</strong> for each target period, keep forecasts with <code>publishTime ≤ cutoff</code> ({filters.cutoffTime}{' '}
          UK on D-{filters.daysBefore}) and use the latest of those. Forecasts published after the cutoff are excluded even if they were more accurate:
          they were not available when the purchase had to be made. The cutoff is a configurable analysis assumption, not an official Elexon rule.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Target settlement periods"
            description="Select a row to inspect its forecast vintages."
            actions={
              <Field label="Status" htmlFor="status-filter" className="min-w-44">
                <Select id="status-filter" value={status} onChange={(e) => setStatus(e.target.value as '' | PeriodStatus)}>
                  <option value="">All periods</option>
                  {(meta.data?.statuses.map((s) => s.status) ?? (Object.keys(PERIOD_STATUS) as PeriodStatus[])).map((s) => (
                    <option key={s} value={s}>
                      {PERIOD_STATUS[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
            }
          />
          {periods.isError ? (
            <CardContent>
              <ErrorState error={periods.error} onRetry={() => periods.refetch()} />
            </CardContent>
          ) : (
            <DataTable<Period>
              caption="Target settlement periods with selected forecast"
              columns={COLUMNS}
              rows={periods.data?.items ?? []}
              rowKey={(p) => p.start_time}
              loading={periods.isFetching}
              sort={sort}
              onSortChange={(s) => {
                setSort(s)
                setPage(1)
              }}
              onRowClick={(p) => setSelected(p.start_time)}
              rowLabel={(p) => `Inspect forecast vintages for ${formatUk(p.start_time)}`}
              selectedKey={target}
              pagination={{
                page,
                pageSize,
                total: periods.data?.total ?? 0,
                onPageChange: setPage,
                onPageSizeChange: setPageSize,
                pageSizeOptions: [24, 48, 96],
              }}
            />
          )}
        </Card>

        <Card aria-live="polite">
          <CardHeader
            title={target ? `Forecast vintages for ${formatUkFull(target)}` : 'Forecast vintages'}
            description={
              vintages.data
                ? `Decision date ${vintages.data.decision_date} · cutoff ${formatUkFull(vintages.data.cutoff_time)} · rule: ${vintages.data.cutoff_rule}`
                : 'Every published forecast for the selected target period.'
            }
          />
          <CardContent className="space-y-4">
            {!target ? (
              <EmptyState title="No period selected" description="Choose a target period from the table." />
            ) : vintages.isLoading ? (
              <LoadingBlock />
            ) : vintages.isError ? (
              <ErrorState error={vintages.error} onRetry={() => vintages.refetch()} />
            ) : vintages.data ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-brand-100 bg-brand-50/60 p-3">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-brand-700 uppercase">
                      <ShieldCheck aria-hidden className="size-3" /> Decision-time forecast
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular">{formatMW(vintages.data.selected?.generation_mw)}</p>
                    <p className="text-[11px] text-slate-500">
                      {vintages.data.selected ? `Published ${formatUk(vintages.data.selected.publish_time)}` : 'None eligible'}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="flex items-center gap-1 text-[11px] font-medium text-slate-600 uppercase">
                      <Timer aria-hidden className="size-3" /> Latest available (hindsight)
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular">{formatMW(vintages.data.latest_available?.generation_mw)}</p>
                    <p className="text-[11px] text-slate-500">
                      {vintages.data.latest_available ? `Published ${formatUk(vintages.data.latest_available.publish_time)}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-md border border-blue-100 bg-blue-50/60 p-3">
                    <p className="text-[11px] font-medium text-blue-800 uppercase">Actual outturn</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular">
                      {vintages.data.actual_mw === null ? 'Not observed' : formatMW(vintages.data.actual_mw)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Decision-time error: {formatMW(vintages.data.selected?.error_mw, { signed: true })}
                    </p>
                  </div>
                </div>
                <p className="rounded-md bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">{vintages.data.explanation}</p>
                {vintages.data.vintages.length > 0 && <VintageChart data={vintages.data} />}
                <div className="rounded-md border border-slate-200">
                  <DataTable<Vintage>
                    caption="Forecast vintages for the selected period"
                    columns={VINTAGE_COLUMNS}
                    rows={vintages.data.vintages}
                    rowKey={(v) => v.publish_time ?? ''}
                    emptyMessage="No forecasts were published for this target period."
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {vintages.data.eligible_count} eligible · {vintages.data.excluded_late_count} excluded as late
                  {vintages.data.duplicates_resolved > 0 && ` · ${vintages.data.duplicates_resolved} duplicate vintage(s) resolved`}
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
