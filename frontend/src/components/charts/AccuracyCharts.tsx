import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import type { DailyCoverage, DailyMetrics, HistogramBin, HourlyMetrics, Metrics, ScatterPoint } from '@/types/api'
import { formatDay, formatLongDay, formatMW, formatNumber, formatPct, formatUkFull } from '@/utils/format'

import { axisProps, ChartFrame, COLORS, gridProps, Legend, LegendItem, niceScale, tickGW, TooltipBox } from './chartTheme'

type TipProps<T> = { active?: boolean; payload?: { payload: T }[] }

function niceProps(values: (number | null)[], symmetric = false) {
  const { domain, ticks } = niceScale(values, { symmetric })
  return { domain, ticks }
}

export function HistogramChart({
  bins,
  color = COLORS.error,
  label,
  signed = false,
}: {
  bins: HistogramBin[]
  color?: string
  label: string
  signed?: boolean
}) {
  const data = bins.map((b) => ({ ...b, mid: ((b.bin_start ?? 0) + (b.bin_end ?? 0)) / 2 }))
  const Tip = ({ active, payload }: TipProps<(typeof data)[number]>) => {
    if (!active || !payload?.length) return null
    const b = payload[0].payload
    return (
      <TooltipBox
        title={`${formatMW(b.bin_start, { signed })} to ${formatMW(b.bin_end, { signed })}`}
        rows={[
          { label: 'Periods', value: formatNumber(b.count) },
          { label: 'Share', value: formatPct(b.share_pct) },
        ]}
      />
    )
  }
  return (
    <ChartFrame height={260} summary={`Histogram of ${label}`}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 16 }} barCategoryGap={2}>
        <CartesianGrid {...gridProps} />
        <XAxis
          dataKey="mid"
          tickFormatter={(v: number) => tickGW(v)}
          {...axisProps}
          label={{ value: `${label} (GW)`, position: 'insideBottom', offset: -10, fill: COLORS.axis, fontSize: 11 }}
        />
        <YAxis allowDecimals={false} width={40} {...axisProps} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
        {signed && <ReferenceLine x={0} stroke={COLORS.text} />}
        <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.mid} fill={signed && d.mid < 0 ? COLORS.negative : color} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

export function ForecastScatter({ points }: { points: ScatterPoint[] }) {
  const values = points.flatMap((p) => [p.actual_mw ?? 0, p.forecast_mw ?? 0])
  const scale = niceScale(values)
  const max = scale.domain[1]
  const Tip = ({ active, payload }: TipProps<ScatterPoint>) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    return (
      <TooltipBox
        title={formatUkFull(p.start_time)}
        rows={[
          { label: 'Forecast', value: formatMW(p.forecast_mw), color: COLORS.forecast },
          { label: 'Actual', value: formatMW(p.actual_mw), color: COLORS.actual },
          { label: 'Error', value: formatMW(p.error_mw, { signed: true }), color: COLORS.error },
        ]}
      />
    )
  }
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.forecast} label="Matched period" />
        <LegendItem color={COLORS.latest} dashed label="Perfect forecast (forecast = actual)" />
      </Legend>
      <ChartFrame height={300} summary="Scatter plot of decision-time forecast against actual generation, with a line of perfect agreement">
        <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 16 }}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="actual_mw"
            domain={[0, max]}
            ticks={scale.ticks}
            tickFormatter={tickGW}
            {...axisProps}
            label={{ value: 'Actual (GW)', position: 'insideBottom', offset: -10, fill: COLORS.axis, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="forecast_mw"
            domain={[0, max]}
            ticks={scale.ticks}
            tickFormatter={tickGW}
            width={44}
            {...axisProps}
            label={{ value: 'Forecast (GW)', angle: -90, position: 'insideLeft', fill: COLORS.axis, fontSize: 11 }}
          />
          <ZAxis range={[22, 22]} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: max, y: max },
            ]}
            stroke={COLORS.latest}
            strokeDasharray="4 3"
          />
          <Tooltip content={<Tip />} />
          <Scatter data={points} fill={COLORS.forecast} fillOpacity={0.55} isAnimationActive={false} />
        </ScatterChart>
      </ChartFrame>
    </div>
  )
}

export function DailyMaeChart({ daily }: { daily: DailyMetrics[] }) {
  const Tip = ({ active, payload }: TipProps<DailyMetrics>) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <TooltipBox
        title={formatLongDay(d.delivery_date)}
        rows={[
          { label: 'MAE', value: formatMW(d.mae_mw), color: COLORS.error },
          { label: 'RMSE', value: formatMW(d.rmse_mw), color: COLORS.actual },
          { label: 'Max |error|', value: formatMW(d.max_abs_error_mw) },
          { label: 'Matched periods', value: formatNumber(d.count) },
        ]}
      />
    )
  }
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.error} label="Daily MAE" />
        <LegendItem color={COLORS.actual} dashed label="Daily RMSE" />
      </Legend>
      <ChartFrame height={260} summary="Line chart of daily mean absolute error and root mean squared error by delivery day">
        <LineChart data={daily} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="delivery_date" tickFormatter={formatDay} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={tickGW} width={44} {...niceProps(daily.flatMap((d) => [d.mae_mw, d.rmse_mw]))} {...axisProps} />
          <Tooltip content={<Tip />} />
          <Line dataKey="mae_mw" stroke={COLORS.error} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          <Line dataKey="rmse_mw" stroke={COLORS.actual} strokeWidth={1.75} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartFrame>
    </div>
  )
}

export function DailyBiasChart({ daily }: { daily: DailyMetrics[] }) {
  const Tip = ({ active, payload }: TipProps<DailyMetrics>) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <TooltipBox
        title={formatLongDay(d.delivery_date)}
        rows={[
          { label: 'Mean error (bias)', value: formatMW(d.bias_mw, { signed: true }) },
          { label: 'Mean forecast', value: formatMW(d.mean_forecast_mw), color: COLORS.forecast },
          { label: 'Mean actual', value: formatMW(d.mean_actual_mw), color: COLORS.actual },
          { label: 'Over / under periods', value: `${d.overestimation_count} / ${d.underestimation_count}` },
        ]}
      />
    )
  }
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.error} label="Over-forecast day (bias > 0)" />
        <LegendItem color={COLORS.negative} label="Under-forecast day (bias < 0)" />
      </Legend>
      <ChartFrame height={260} summary="Bar chart of mean signed forecast error (bias) by delivery day">
        <BarChart data={daily} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="delivery_date" tickFormatter={formatDay} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={tickGW} width={44} {...niceProps(daily.map((d) => d.bias_mw), true)} {...axisProps} />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
          <ReferenceLine y={0} stroke={COLORS.text} />
          <Bar dataKey="bias_mw" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {daily.map((d) => (
              <Cell key={d.delivery_date} fill={(d.bias_mw ?? 0) >= 0 ? COLORS.error : COLORS.negative} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
    </div>
  )
}

export function HourlyErrorChart({ hours }: { hours: HourlyMetrics[] }) {
  const Tip = ({ active, payload }: TipProps<HourlyMetrics>) => {
    if (!active || !payload?.length) return null
    const h = payload[0].payload
    return (
      <TooltipBox
        title={`${String(h.local_hour).padStart(2, '0')}:00 UK local`}
        rows={[
          { label: 'MAE', value: formatMW(h.mae_mw), color: COLORS.error },
          { label: 'Bias', value: formatMW(h.bias_mw, { signed: true }), color: COLORS.actual },
          { label: 'Matched periods', value: formatNumber(h.count) },
        ]}
      />
    )
  }
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.error} label="MAE by hour" />
        <LegendItem color={COLORS.actual} label="Bias by hour" />
      </Legend>
      <ChartFrame height={260} summary="Bar chart of mean absolute error by UK local hour of day with a bias line">
        <ComposedChart data={hours} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="local_hour" tickFormatter={(h: number) => `${String(h).padStart(2, '0')}h`} interval={1} {...axisProps} />
          <YAxis tickFormatter={tickGW} width={44} {...niceProps(hours.flatMap((h) => [h.mae_mw, h.bias_mw]))} {...axisProps} />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
          <ReferenceLine y={0} stroke={COLORS.text} />
          <Bar dataKey="mae_mw" fill={COLORS.error} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line dataKey="bias_mw" stroke={COLORS.actual} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ChartFrame>
    </div>
  )
}

export function OverUnderChart({ metrics }: { metrics: Metrics }) {
  const data = [
    { name: 'Over-forecast', count: metrics.overestimation_count, pct: metrics.overestimation_pct, fill: COLORS.error },
    { name: 'Under-forecast', count: metrics.underestimation_count, pct: metrics.underestimation_pct, fill: COLORS.negative },
    { name: 'Exact', count: metrics.exact_count, pct: metrics.exact_pct, fill: COLORS.latest },
  ]
  const Tip = ({ active, payload }: TipProps<(typeof data)[number]>) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return <TooltipBox title={d.name} rows={[{ label: 'Periods', value: formatNumber(d.count) }, { label: 'Share', value: formatPct(d.pct) }]} />
  }
  return (
    <ChartFrame height={180} summary="Bar chart comparing number of over-forecast and under-forecast periods">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps} />
        <YAxis type="category" dataKey="name" width={104} {...axisProps} />
        <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
        <Bar
          dataKey="count"
          radius={[0, 3, 3, 0]}
          isAnimationActive={false}
          label={{ position: 'right', fill: COLORS.text, fontSize: 11, formatter: (v: unknown) => formatNumber(Number(v)) }}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

const COVERAGE_SERIES = [
  { key: 'matched', label: 'Matched', color: COLORS.forecast },
  { key: 'missing_actual', label: 'Actual missing', color: COLORS.error },
  { key: 'missing_forecast', label: 'Forecast missing', color: COLORS.negative },
  { key: 'late_forecast_only', label: 'Late forecast only', color: COLORS.latest },
] as const

export function CoverageChart({ days }: { days: DailyCoverage[] }) {
  const Tip = ({ active, payload }: TipProps<DailyCoverage>) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <TooltipBox
        title={formatLongDay(d.delivery_date)}
        rows={[
          ...COVERAGE_SERIES.map((s) => ({ label: s.label, value: formatNumber(d[s.key]), color: s.color })),
          { label: 'Forecast targets', value: formatNumber(d.forecast_target_periods) },
          { label: 'Half-hour actuals missing', value: formatNumber(d.actual_missing) },
          { label: 'Match rate', value: formatPct(d.match_rate_pct) },
        ]}
      />
    )
  }
  return (
    <div>
      <Legend>
        {COVERAGE_SERIES.map((s) => (
          <LegendItem key={s.key} color={s.color} label={s.label} />
        ))}
      </Legend>
      <ChartFrame height={240} summary="Stacked bar chart of matched and missing forecast target periods per delivery day">
        <BarChart data={days} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="delivery_date" tickFormatter={formatDay} minTickGap={24} {...axisProps} />
          <YAxis allowDecimals={false} width={36} {...axisProps} />
          <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
          {COVERAGE_SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} stackId="cov" fill={s.color} stroke="#fff" strokeWidth={1} isAnimationActive={false} />
          ))}
        </BarChart>
      </ChartFrame>
    </div>
  )
}
