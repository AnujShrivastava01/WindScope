import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { PERIOD_STATUS } from '@/utils/status'
import type { Period } from '@/types/api'
import { formatMW, formatUkFull } from '@/utils/format'

import { axisProps, ChartFrame, COLORS, gridProps, Legend, LegendItem, niceScale, tickDate, tickGW, TooltipBox } from './chartTheme'

interface SeriesPoint {
  t: number
  forecast: number | null
  actual: number | null
  error: number | null
  latest: number | null
  period: Period
}

function toPoints(items: Period[]): SeriesPoint[] {
  return items.map((p) => ({
    t: new Date(p.start_time).getTime(),
    forecast: p.forecast_mw,
    actual: p.actual_mw,
    error: p.error_mw,
    latest: p.latest_available_mw,
    period: p,
  }))
}

function PeriodTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeriesPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload.period
  return (
    <TooltipBox
      title={formatUkFull(p.start_time)}
      rows={[
        { label: 'Decision-time forecast', value: formatMW(p.forecast_mw), color: COLORS.forecast },
        { label: 'Actual (FUELHH)', value: p.actual_mw === null ? 'Not observed' : formatMW(p.actual_mw), color: COLORS.actual },
        { label: 'Error (F − A)', value: formatMW(p.error_mw, { signed: true }), color: COLORS.error },
        { label: 'Forecast published', value: formatUkFull(p.forecast_publish_time) },
        { label: 'Status', value: PERIOD_STATUS[p.status].label },
      ]}
    />
  )
}

/** Decision-time forecast vs actual outturn over the selected delivery window. */
export function ForecastActualChart({
  items,
  height = 320,
  showBrush = true,
  showLatest = false,
}: {
  items: Period[]
  height?: number
  showBrush?: boolean
  showLatest?: boolean
}) {
  const data = useMemo(() => toPoints(items), [items])
  const y = useMemo(
    () => niceScale(data.flatMap((d) => [d.forecast, d.actual, showLatest ? d.latest : null])),
    [data, showLatest],
  )
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.forecast} label="Decision-time forecast (WINDFOR)" />
        <LegendItem color={COLORS.actual} label="Actual generation (FUELHH WIND)" />
        {showLatest && <LegendItem color={COLORS.latest} dashed label="Latest available forecast (hindsight, not used)" />}
      </Legend>
      <ChartFrame height={height} summary="Line chart of decision-time wind forecast versus actual wind generation in megawatts over time">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tickDate}
            minTickGap={40}
            {...axisProps}
          />
          <YAxis
            tickFormatter={tickGW}
            width={44}
            domain={y.domain}
            ticks={y.ticks}
            {...axisProps}
            label={{ value: 'GW', angle: 0, position: 'insideTopLeft', offset: 0, dy: -4, fill: COLORS.axis, fontSize: 11 }}
          />
          <Tooltip content={<PeriodTooltip />} cursor={{ stroke: COLORS.axis, strokeDasharray: '3 3' }} />
          <Line
            dataKey="actual"
            name="Actual"
            stroke={COLORS.actual}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Line
            dataKey="forecast"
            name="Forecast"
            stroke={COLORS.forecast}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          {showLatest && (
            <Line
              dataKey="latest"
              name="Latest available"
              stroke={COLORS.latest}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          {showBrush && data.length > 96 && (
            <Brush dataKey="t" height={22} travellerWidth={8} stroke={COLORS.forecast} tickFormatter={tickDate} />
          )}
        </ComposedChart>
      </ChartFrame>
    </div>
  )
}

/** Signed error per matched period: amber = over-forecast, red = under-forecast. */
export function ErrorChart({ items, height = 240 }: { items: Period[]; height?: number }) {
  const data = useMemo(() => toPoints(items.filter((p) => p.status === 'matched')), [items])
  const y = useMemo(() => niceScale(data.map((d) => d.error), { symmetric: true }), [data])
  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.error} label="Over-forecast (forecast > actual)" />
        <LegendItem color={COLORS.negative} label="Under-forecast (forecast < actual)" />
      </Legend>
      <ChartFrame height={height} summary="Bar chart of signed forecast error in megawatts per settlement period with a zero reference line">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barCategoryGap={0}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickDate} minTickGap={40} {...axisProps} />
          <YAxis tickFormatter={tickGW} width={44} domain={y.domain} ticks={y.ticks} {...axisProps} />
          <Tooltip content={<PeriodTooltip />} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
          <ReferenceLine y={0} stroke={COLORS.text} strokeWidth={1} />
          <Bar dataKey="error" isAnimationActive={false} maxBarSize={6}>
            {data.map((d) => (
              <Cell key={d.t} fill={(d.error ?? 0) >= 0 ? COLORS.error : COLORS.negative} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
    </div>
  )
}

