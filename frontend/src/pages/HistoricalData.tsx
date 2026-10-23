import { Download, Search, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/layout/AppLayout'
import { DataTable, type Column, type SortState } from '@/components/tables/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { ErrorState } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/form'
import { useActuals, useForecastRecords, useImportCsv } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import { downloadCsv, type QueryParams } from '@/services/api'
import type { ActualRow, ForecastRow, ImportResponse } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatMW, formatNumber, formatUk, formatUkFull } from '@/utils/format'
import { REFRESH_STATUS } from '@/utils/status'

type Tab = 'actuals' | 'forecasts'

const sourceBadge = (source: string) => (
  <Badge tone={source === 'elexon_api' ? 'info' : 'warning'} icon={false}>
    {source === 'elexon_api' ? 'Elexon API' : 'CSV import'}
  </Badge>
)

const ACTUAL_COLUMNS: Column<ActualRow>[] = [
  { key: 'start', header: 'Target period (UK)', sortKey: 'start_time', render: (r) => <span className="font-medium text-slate-900">{formatUk(r.start_time)}</span> },
  { key: 'utc', header: 'startTime (UTC)', render: (r) => <span className="font-mono text-xs text-slate-500">{r.start_time}</span> },
  { key: 'sd', header: 'Settlement date / SP', sortKey: 'settlement_date', render: (r) => `${r.settlement_date ?? '—'} / ${r.settlement_period ?? '—'}` },
  { key: 'gen', header: 'Generation', sortKey: 'generation_mw', align: 'right', render: (r) => formatMW(r.generation_mw) },
  { key: 'pub', header: 'Published (UK)', sortKey: 'publish_time', render: (r) => formatUk(r.publish_time) },
  { key: 'src', header: 'Source', sortKey: 'source', render: (r) => sourceBadge(r.source) },
]

const FORECAST_COLUMNS: Column<ForecastRow>[] = [
  { key: 'start', header: 'Target period (UK)', sortKey: 'start_time', render: (r) => <span className="font-medium text-slate-900">{formatUk(r.start_time)}</span> },
  { key: 'pub', header: 'Forecast published (UK)', sortKey: 'publish_time', render: (r) => formatUk(r.publish_time) },
  {
    key: 'lead',
    header: 'Lead time',
    align: 'right',
    render: (r) => `${Math.round((new Date(r.start_time).getTime() - new Date(r.publish_time).getTime()) / 36e5)} h`,
  },
  { key: 'gen', header: 'Generation', sortKey: 'generation_mw', align: 'right', render: (r) => formatMW(r.generation_mw) },
  { key: 'utc', header: 'publishTime (UTC)', render: (r) => <span className="font-mono text-xs text-slate-500">{r.publish_time}</span> },
  { key: 'src', header: 'Source', sortKey: 'source', render: (r) => sourceBadge(r.source) },
]

function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [dataset, setDataset] = useState<'actual' | 'forecast'>('actual')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const importCsv = useImportCsv()

  const close = (next: boolean) => {
    if (!next) {
      setFile(null)
      setResult(null)
      setError(null)
      if (inputRef.current) inputRef.current.value = ''
    }
    onOpenChange(next)
  }

  const submit = () => {
    if (!file) return
    setError(null)
    setResult(null)
    importCsv.mutate(
      { dataset, file },
      {
        onSuccess: (res) => {
          setResult(res)
          const tone = res.status === 'success' ? toast.success : res.status === 'partial' ? toast.warning : toast.error
          tone(`Import ${REFRESH_STATUS[res.status].label.toLowerCase()}`, {
            description: `${res.accepted} accepted, ${res.rejected} rejected, ${res.inserted} new rows stored.`,
          })
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Import historical CSV"
      description="Use only when the Elexon API cannot supply records. Only the two permitted datasets are accepted."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Close
          </Button>
          <Button onClick={submit} disabled={!file || importCsv.isPending}>
            <Upload aria-hidden /> {importCsv.isPending ? 'Validating…' : 'Validate & import'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dataset" htmlFor="import-dataset">
            <Select id="import-dataset" value={dataset} onChange={(e) => setDataset(e.target.value as 'actual' | 'forecast')}>
              <option value="actual">FUELHH actual generation (WIND)</option>
              <option value="forecast">WINDFOR wind forecasts</option>
            </Select>
          </Field>
          <Field label="CSV file (UTF-8, max 10 MB)" htmlFor="import-file">
            <Input
              id="import-file"
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="py-1.5"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <p className="font-medium text-slate-700">Required columns</p>
          {dataset === 'actual' ? (
            <p>
              <code>startTime</code>, <code>generation</code> (MW). Optional: <code>fuelType</code> (non-WIND rows are skipped), <code>settlementDate</code>,{' '}
              <code>settlementPeriod</code>, <code>publishTime</code>.
            </p>
          ) : (
            <p>
              <code>startTime</code>, <code>publishTime</code>, <code>generation</code> (MW). Rows without a publish time are rejected because the vintage
              cannot be placed against the decision cutoff.
            </p>
          )}
          <p className="mt-1">
            Timestamps are ISO-8601; values without an offset are treated as UTC. WindScope export headers (e.g. <code>start_time_utc</code>) are also
            accepted. Existing Elexon API values are never overwritten by imports.
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            {error}
          </p>
        )}
        {result && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center gap-2">
              <Badge tone={REFRESH_STATUS[result.status].tone}>{REFRESH_STATUS[result.status].label}</Badge>
              <span className="text-xs text-slate-500">{result.filename}</span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
              {(
                [
                  ['Rows read', result.received],
                  ['Accepted', result.accepted],
                  ['Inserted', result.inserted],
                  ['Updated', result.updated],
                  ['Rejected', result.rejected],
                  ['Kept API value', result.skipped_existing_api],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-200 px-2 py-1.5">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-semibold text-slate-900 tabular">{formatNumber(value)}</dd>
                </div>
              ))}
            </dl>
            {result.filtered_out_non_wind > 0 && (
              <p className="text-xs text-slate-500">{result.filtered_out_non_wind} non-WIND row(s) skipped.</p>
            )}
            {result.rejected_rows.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-amber-200">
                <table className="w-full text-xs">
                  <caption className="sr-only">Rejected rows</caption>
                  <thead className="bg-amber-50 text-left text-amber-900">
                    <tr>
                      <th scope="col" className="px-2 py-1">
                        Line
                      </th>
                      <th scope="col" className="px-2 py-1">
                        Reason
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rejected_rows.map((r) => (
                      <tr key={`${r.row}-${r.reason}`} className="border-t border-amber-100">
                        <td className="px-2 py-1 tabular">{r.row}</td>
                        <td className="px-2 py-1">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export default function HistoricalData() {
  const { filters, setFilters, ready } = useAnalysisFilters()
  const [tab, setTab] = useState<Tab>('actuals')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sort, setSort] = useState<SortState>({ key: 'start_time', order: 'asc' })
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput.trim())
  const [source, setSource] = useState('')
  const [publishFrom, setPublishFrom] = useState('')
  const [publishTo, setPublishTo] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const toIso = (local: string) => (local ? new Date(`${local}:00Z`).toISOString().replace('.000', '') : undefined)
  const base: QueryParams = {
    start_date: filters.startDate,
    end_date: filters.endDate,
    sort: sort.key,
    order: sort.order,
    source: source || undefined,
    search: search || undefined,
  }
  const forecastParams: QueryParams = { ...base, publish_from: toIso(publishFrom), publish_to: toIso(publishTo) }

  useEffect(() => setPage(1), [tab, search, source, publishFrom, publishTo, filters.startDate, filters.endDate, pageSize])

  const actuals = useActuals({ ...base, page, page_size: pageSize }, ready && tab === 'actuals')
  const forecasts = useForecastRecords({ ...forecastParams, page, page_size: pageSize }, ready && tab === 'forecasts')
  const active = tab === 'actuals' ? actuals : forecasts

  const exportCsv = async () => {
    setExporting(true)
    try {
      const params = tab === 'actuals' ? { ...base, dataset: 'actuals' } : { ...forecastParams, dataset: 'forecasts' }
      const { filename, rows } = await downloadCsv(params)
      toast.success('Export ready', { description: `${rows.toLocaleString('en-GB')} filtered records saved to ${filename}` })
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message })
    } finally {
      setExporting(false)
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'actuals', label: 'Actual generation (FUELHH)' },
    { id: 'forecasts', label: 'Forecast vintages (WINDFOR)' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Historical Data"
        description="Browse, search and export the stored source records. All values are GB national wind generation in MW; timestamps shown in UK local time with UTC source values preserved."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload aria-hidden /> Import CSV
            </Button>
            <Button onClick={exportCsv} disabled={exporting || (active.data?.total ?? 0) === 0}>
              <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export filtered CSV'}
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="Dataset" className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => {
              setTab(t.id)
              setSort({ key: 'start_time', order: 'asc' })
            }}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section aria-label="Record filters" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
        <Field label="Target from (UK date)" htmlFor="hd-from">
          <Input id="hd-from" type="date" value={filters.startDate} onChange={(e) => e.target.value && setFilters({ startDate: e.target.value })} />
        </Field>
        <Field label="Target to (UK date)" htmlFor="hd-to">
          <Input id="hd-to" type="date" value={filters.endDate} onChange={(e) => e.target.value && setFilters({ endDate: e.target.value })} />
        </Field>
        {tab === 'forecasts' && (
          <>
            <Field label="Published from (UTC)" htmlFor="hd-pub-from">
              <Input id="hd-pub-from" type="datetime-local" value={publishFrom} onChange={(e) => setPublishFrom(e.target.value)} />
            </Field>
            <Field label="Published to (UTC)" htmlFor="hd-pub-to">
              <Input id="hd-pub-to" type="datetime-local" value={publishTo} onChange={(e) => setPublishTo(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Source" htmlFor="hd-source">
          <Select id="hd-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            <option value="elexon_api">Elexon API</option>
            <option value="csv_import">CSV import</option>
          </Select>
        </Field>
        <Field label="Search timestamp" htmlFor="hd-search" className="min-w-52 flex-1">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="hd-search"
              type="search"
              placeholder="e.g. 2026-01-15T12 or 2026-01-15"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-8"
              maxLength={40}
            />
          </div>
        </Field>
      </section>

      <Card id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <CardHeader
          title={tab === 'actuals' ? 'FUELHH actual generation — fuelType WIND' : 'WINDFOR forecast records — every published vintage'}
          description={
            active.data
              ? `${formatNumber(active.data.total)} matching record(s) · unit MW${
                  tab === 'actuals' && active.data.expected_periods !== null
                    ? ` · ${formatNumber(active.data.expected_periods)} settlement periods expected in range`
                    : ''
                }`
              : 'Loading record counts…'
          }
          actions={
            tab === 'actuals' && active.data && (active.data.missing_periods ?? 0) > 0 ? (
              <Badge tone="warning">
                {formatNumber(active.data.missing_periods)} periods missing
              </Badge>
            ) : tab === 'actuals' && active.data ? (
              <Badge tone="success">No missing periods</Badge>
            ) : null
          }
        />
        {active.isError ? (
          <div className="p-5">
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          </div>
        ) : tab === 'actuals' ? (
          <DataTable<ActualRow>
            caption="FUELHH actual generation records"
            columns={ACTUAL_COLUMNS}
            rows={actuals.data?.items ?? []}
            rowKey={(r) => r.start_time}
            loading={actuals.isFetching}
            sort={sort}
            onSortChange={setSort}
            pagination={{ page, pageSize, total: actuals.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: setPageSize }}
          />
        ) : (
          <DataTable<ForecastRow>
            caption="WINDFOR forecast records"
            columns={FORECAST_COLUMNS}
            rows={forecasts.data?.items ?? []}
            rowKey={(r) => `${r.start_time}|${r.publish_time}`}
            loading={forecasts.isFetching}
            sort={sort}
            onSortChange={setSort}
            pagination={{ page, pageSize, total: forecasts.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: setPageSize }}
          />
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Exports contain exactly the filtered records above (all pages), with UTC and UK-local timestamps, units and forecast publish times.
        Generated {formatUkFull(new Date().toISOString())}.
      </p>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
