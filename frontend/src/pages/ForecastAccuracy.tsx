import { Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  CoverageChart,
  DailyBiasChart,
  DailyMaeChart,
  ForecastScatter,
  HistogramChart,
  HourlyErrorChart,
  OverUnderChart,
} from '@/components/charts/AccuracyCharts'
import { COLORS } from '@/components/charts/chartTheme'
import { ErrorChart, ForecastActualChart } from '@/components/charts/TimeSeriesCharts'
import { AnalysisFilterBar } from '@/components/filters/AnalysisFilterBar'
import { PageHeader } from '@/components/layout/AppLayout'
import { DataTable } from '@/components/tables/DataTable'
import { periodColumns } from '@/components/tables/periodColumns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/feedback'
import { Segmented } from '@/components/ui/form'
import { useAccuracySummary, useDistribution, useTimeseries } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import { downloadCsv } from '@/services/api'
import type { Metrics } from '@/types/api'
import { formatMW, formatNumber, formatPct } from '@/utils/format'

const LARGEST_COLUMNS = periodColumns(['target', 'forecast', 'actual', 'error', 'published', 'horizon'])

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight text-slate-900 tabular">{value}</dd>
      {hint && <dd className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</dd>}
    </div>
  )
}

function MetricsGrid({ m, loading }: { m?: Metrics; loading: boolean }) {
  if (loading || !m)
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
      <MetricTile label="MAE" value={formatMW(m.mae_mw)} hint="Mean |forecast − actual|" />
      <MetricTile label="RMSE" value={formatMW(m.rmse_mw)} hint="Penalises large misses" />
      <MetricTile
        label="Bias (mean error)"
        value={formatMW(m.bias_mw, { signed: true })}
        hint={(m.bias_mw ?? 0) > 0 ? 'Systematic over-forecast' : (m.bias_mw ?? 0) < 0 ? 'Systematic under-forecast' : undefined}
      />
      <MetricTile
        label="MAPE"
        value={formatPct(m.mape_pct)}
        hint={`${formatNumber(m.mape_excluded)} zero-actual period(s) excluded`}
      />
      <MetricTile label="WAPE" value={formatPct(m.wape_pct)} hint="Σ|error| ÷ Σ|actual|" />
      <MetricTile label="Max |error|" value={formatMW(m.max_abs_error_mw)} hint={`P90 |error| ${formatMW(m.abs_error_p90_mw)}`} />
      <MetricTile
        label="Over / under"
        value={`${formatPct(m.overestimation_pct)} / ${formatPct(m.underestimation_pct)}`}
        hint="Share of matched periods"
      />
      <MetricTile label="Matched periods" value={formatNumber(m.count)} hint={`Correlation r = ${m.correlation?.toFixed(3) ?? '—'}`} />
    </dl>
  )
}

function Panel({
  title,
  description,
  children,
  loading,
  error,
  onRetry,
  empty,
}: {
  title: string
  description?: string
  children: React.ReactNode
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: boolean
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardContent>
        {loading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState title="No matched observations" description="This chart needs periods where both a decision-time forecast and an actual exist." />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

export default function ForecastAccuracy() {
  const { query, ready, filters } = useAnalysisFilters()
  const summary = useAccuracySummary(query, ready)
  const dist = useDistribution(query, ready)
  const series = useTimeseries(query, ready)
  const [errorView, setErrorView] = useState<'abs' | 'signed'>('abs')
  const [exporting, setExporting] = useState(false)

  const m = summary.data?.metrics
  const noMatches = !summary.isLoading && (m?.count ?? 0) === 0
  const retrySummary = () => summary.refetch()

  const exportAnalysis = async () => {
    setExporting(true)
    try {
      const { filename, rows } = await downloadCsv({ ...query, dataset: 'analysis' })
      toast.success('Export ready', { description: `${rows.toLocaleString('en-GB')} periods saved to ${filename}` })
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Forecast Accuracy"
        description="Quantified error of the decision-time forecast against observed wind generation. Every figure is computed from matched settlement periods only."
        actions={
          <Button variant="secondary" onClick={exportAnalysis} disabled={exporting}>
            <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export period analysis (CSV)'}
          </Button>
        }
      />
      <AnalysisFilterBar />

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={retrySummary} />
      ) : (
        <>
          <MetricsGrid m={m} loading={summary.isLoading || !ready} />
          {m && m.count > 0 && (
            <p className="text-xs leading-relaxed text-slate-500">
              Empirical error range (descriptive, not a guaranteed interval): 80% of matched periods had errors between{' '}
              <strong className="text-slate-700">{formatMW(m.error_p10_mw, { signed: true })}</strong> and{' '}
              <strong className="text-slate-700">{formatMW(m.error_p90_mw, { signed: true })}</strong> at cutoff {filters.cutoffTime} D-
              {filters.daysBefore}. MAPE can be unstable when actual generation is very low.
            </p>
          )}

          <Panel
            title="1 · Forecast vs actual over time"
            description="Hourly decision-time forecast against half-hourly outturn."
            loading={series.isLoading}
            error={series.error}
            onRetry={() => series.refetch()}
            empty={noMatches}
          >
            <ForecastActualChart items={series.data?.items ?? []} showLatest />
          </Panel>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel
              title="2 · Signed error over time"
              description="Positive = over-forecast (wind shortfall risk). Negative = under-forecast."
              loading={series.isLoading}
              error={series.error}
              onRetry={() => series.refetch()}
              empty={noMatches}
            >
              <ErrorChart items={series.data?.items ?? []} />
            </Panel>
            <Card>
              <CardHeader
                title="3 · Error distribution"
                description="How often errors of each size occurred."
                actions={
                  <Segmented
                    label="Error distribution type"
                    value={errorView}
                    onChange={setErrorView}
                    options={[
                      { value: 'abs', label: 'Absolute' },
                      { value: 'signed', label: 'Signed' },
                    ]}
                  />
                }
              />
              <CardContent>
                {dist.isLoading ? (
                  <LoadingBlock />
                ) : dist.isError ? (
                  <ErrorState error={dist.error} onRetry={() => dist.refetch()} />
                ) : (dist.data?.count ?? 0) === 0 ? (
                  <EmptyState title="No matched observations" />
                ) : errorView === 'abs' ? (
                  <HistogramChart bins={dist.data!.abs_error_histogram} label="Absolute error" color={COLORS.error} />
                ) : (
                  <HistogramChart bins={dist.data!.error_histogram} label="Signed error" signed />
                )}
              </CardContent>
            </Card>
            <Panel
              title="4 · Forecast vs actual scatter"
              description="Points above the dashed line were over-forecast."
              loading={dist.isLoading}
              error={dist.error}
              onRetry={() => dist.refetch()}
              empty={(dist.data?.count ?? 0) === 0}
            >
              <ForecastScatter points={dist.data?.scatter ?? []} />
            </Panel>
            <Panel
              title="5 · Daily MAE trend"
              description="Mean absolute and root mean squared error per UK delivery day."
              loading={summary.isLoading}
              empty={noMatches}
            >
              <DailyMaeChart daily={summary.data?.daily ?? []} />
            </Panel>
            <Panel
              title="6 · Error by hour of day"
              description="UK local delivery hour. Reveals whether certain hours are systematically harder to forecast."
              loading={summary.isLoading}
              empty={noMatches}
            >
              <HourlyErrorChart hours={summary.data?.by_hour ?? []} />
            </Panel>
            <Panel
              title="7 · Bias by delivery day"
              description="Mean signed error per day: which days the forecast leaned high or low."
              loading={summary.isLoading}
              empty={noMatches}
            >
              <DailyBiasChart daily={summary.data?.daily ?? []} />
            </Panel>
            <Panel
              title="8 · Over- vs under-estimation"
              description="Number of matched periods where wind was over- or under-forecast."
              loading={summary.isLoading}
              empty={noMatches}
            >
              {m && <OverUnderChart metrics={m} />}
            </Panel>
          </div>

          <Card>
            <CardHeader
              title="9 · Data coverage and missing observations"
              description={
                summary.data
                  ? `${formatNumber(summary.data.coverage.matched)} of ${formatNumber(summary.data.coverage.forecast_target_periods)} hourly forecast targets matched · ${formatNumber(summary.data.coverage.actual_missing)} half-hourly actuals missing · ${formatNumber(summary.data.coverage.no_forecast_target)} half-hour periods have no WINDFOR target (hourly product).`
                  : undefined
              }
            />
            <CardContent>
              {summary.isLoading ? <LoadingBlock /> : <CoverageChart days={summary.data?.daily_coverage ?? []} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Largest historical errors" description="The ten matched periods with the biggest absolute error in this window." />
            <DataTable
              caption="Largest forecast errors"
              columns={LARGEST_COLUMNS}
              rows={summary.data?.largest_errors ?? []}
              rowKey={(p) => p.start_time}
              loading={summary.isLoading}
            />
          </Card>
        </>
      )}
    </div>
  )
}
