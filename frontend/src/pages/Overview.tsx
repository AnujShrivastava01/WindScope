import { Activity, Gauge, Percent, Sigma, TrendingUp, Wind } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorChart, ForecastActualChart } from '@/components/charts/TimeSeriesCharts'
import { AnalysisFilterBar } from '@/components/filters/AnalysisFilterBar'
import { KpiCard } from '@/components/kpi/KpiCard'
import { PageHeader } from '@/components/layout/AppLayout'
import { DataTable } from '@/components/tables/DataTable'
import { periodColumns } from '@/components/tables/periodColumns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/feedback'
import { Segmented } from '@/components/ui/form'
import { useHealth, useOverview, useTimeseries } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import type { Period } from '@/types/api'
import { formatMW, formatNumber, formatPct, formatUk, formatUkFull, isNum } from '@/utils/format'

const RECENT_COLUMNS = periodColumns(['target', 'forecast', 'actual', 'error', 'abs', 'published', 'status'])

export default function Overview() {
  const { query, ready } = useAnalysisFilters()
  const overview = useOverview(query, ready)
  const series = useTimeseries(query, ready)
  const health = useHealth()
  const [recentPage, setRecentPage] = useState(1)
  const [chartRange, setChartRange] = useState<'all' | '7d' | '48h'>('all')

  const kpis = overview.data?.kpis
  const metrics = kpis?.metrics
  const coverage = kpis?.coverage
  const loading = overview.isLoading || !ready
  const ingesting = health.data?.refresh_in_progress || (health.data && health.data.records.actual === 0)

  const chartItems = useMemo(() => {
    const items: Period[] = series.data?.items ?? []
    if (chartRange === 'all' || items.length === 0) return items
    const lastObserved = [...items].reverse().find((p) => p.forecast_mw !== null || p.actual_mw !== null)
    if (!lastObserved) return items
    const end = new Date(lastObserved.start_time).getTime()
    const span = chartRange === '7d' ? 7 * 86_400_000 : 2 * 86_400_000
    return items.filter((p) => {
      const t = new Date(p.start_time).getTime()
      return t > end - span && t <= end
    })
  }, [series.data, chartRange])

  const recent = overview.data?.recent_periods ?? []
  const pageSize = 12
  const recentSlice = recent.slice((recentPage - 1) * pageSize, recentPage * pageSize)
  const hasData = (metrics?.count ?? 0) > 0 || (coverage?.actual_observed ?? 0) > 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="What wind generation was forecast when the day-ahead purchase decision had to be made, and how it compared with what was actually generated."
      />
      <AnalysisFilterBar />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !loading && !hasData ? (
        <EmptyState
          title={ingesting ? 'Loading historical data from Elexon…' : 'No data for this selection'}
          description={
            ingesting
              ? 'The first refresh is fetching FUELHH and WINDFOR records. This usually takes under a minute.'
              : 'No forecast or actual records are stored for the selected delivery window. Refresh from Elexon or import CSV data on the Historical Data page.'
          }
          action={
            <Link className="text-sm font-medium text-brand-700 hover:underline" to="/data-health">
              Open Data Health
            </Link>
          }
        />
      ) : (
        <>
          <section aria-label="Key indicators" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              label="Latest eligible forecast"
              icon={Wind}
              accent="brand"
              loading={loading}
              value={formatMW(kpis?.latest_forecast?.forecast_mw, { unit: false })}
              unit="MW"
              detail={
                kpis?.latest_forecast ? (
                  <>
                    For {formatUk(kpis.latest_forecast.start_time)}
                    <br />
                    Published {formatUk(kpis.latest_forecast.forecast_publish_time)}
                  </>
                ) : (
                  'No eligible forecast in range'
                )
              }
            />
            <KpiCard
              label="Actual generation"
              icon={Activity}
              accent="actual"
              loading={loading}
              value={kpis?.latest_matched ? formatMW(kpis.latest_matched.actual_mw, { unit: false }) : '—'}
              unit="MW"
              detail={kpis?.latest_matched ? `Outturn for ${formatUk(kpis.latest_matched.start_time)}` : 'No observed actual for a forecast period'}
            />
            <KpiCard
              label="Forecast error"
              icon={TrendingUp}
              accent="error"
              loading={loading}
              value={formatMW(kpis?.latest_matched?.error_mw, { unit: false, signed: true })}
              unit="MW"
              detail={
                isNum(kpis?.latest_matched?.error_mw)
                  ? kpis!.latest_matched!.error_mw! > 0
                    ? 'Wind over-forecast (less wind than expected)'
                    : kpis!.latest_matched!.error_mw! < 0
                      ? 'Wind under-forecast (more wind than expected)'
                      : 'Forecast matched actual'
                  : 'Latest matched period'
              }
            />
            <KpiCard
              label="Mean absolute error"
              icon={Gauge}
              accent="error"
              loading={loading}
              value={formatMW(metrics?.mae_mw, { unit: false })}
              unit="MW"
              detail={`Bias ${formatMW(metrics?.bias_mw, { signed: true })} · ${formatNumber(metrics?.count)} periods`}
            />
            <KpiCard
              label="RMSE"
              icon={Sigma}
              accent="neutral"
              loading={loading}
              value={formatMW(metrics?.rmse_mw, { unit: false })}
              unit="MW"
              detail={`Max |error| ${formatMW(metrics?.max_abs_error_mw)}`}
            />
            <KpiCard
              label="Forecast coverage"
              icon={Percent}
              accent={coverage && (coverage.forecast_coverage_pct ?? 0) < 100 ? 'danger' : 'brand'}
              loading={loading}
              value={formatPct(coverage?.forecast_coverage_pct).replace('%', '')}
              unit="%"
              detail={
                coverage
                  ? `${formatNumber(coverage.periods_with_forecast)} of ${formatNumber(coverage.forecast_target_periods)} hourly targets · ${formatNumber(coverage.unmatched)} unmatched`
                  : undefined
              }
            />
          </section>

          <Card>
            <CardHeader
              title="Decision-time forecast vs actual wind generation"
              description="Forecast = latest WINDFOR vintage published on or before the decision cutoff. Actual = FUELHH WIND half-hourly outturn. Missing actuals are left as gaps, never zero."
              actions={
                <Segmented
                  label="Chart range"
                  value={chartRange}
                  onChange={setChartRange}
                  options={[
                    { value: 'all', label: 'Full range' },
                    { value: '7d', label: 'Last 7 days' },
                    { value: '48h', label: 'Last 48 h' },
                  ]}
                />
              }
            />
            <CardContent>
              {series.isLoading ? (
                <LoadingBlock />
              ) : series.isError ? (
                <ErrorState error={series.error} onRetry={() => series.refetch()} />
              ) : (
                <ForecastActualChart items={chartItems} showBrush={chartRange === 'all'} />
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Forecast error by settlement period"
                description="Error = forecast − actual. Above zero: wind over-forecast, so more replacement power would have been needed than planned."
              />
              <CardContent>
                {series.isLoading ? (
                  <LoadingBlock />
                ) : series.isError ? (
                  <ErrorState error={series.error} onRetry={() => series.refetch()} />
                ) : (series.data?.items.filter((p) => p.status === 'matched').length ?? 0) === 0 ? (
                  <EmptyState title="No matched periods" description="Errors appear once forecast and actual both exist." />
                ) : (
                  <ErrorChart items={chartItems} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader
                title="Most recent settlement periods"
                description={`Latest hourly forecast targets in the selected window. ${
                  kpis?.latest_forecast ? `Cutoff for the last delivery day: ${formatUkFull(kpis.latest_forecast.cutoff_time)}.` : ''
                }`}
              />
              <DataTable
                caption="Most recent settlement periods"
                columns={RECENT_COLUMNS}
                rows={recentSlice}
                rowKey={(p) => p.start_time}
                loading={loading}
                pagination={{ page: recentPage, pageSize, total: recent.length, onPageChange: setRecentPage }}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
