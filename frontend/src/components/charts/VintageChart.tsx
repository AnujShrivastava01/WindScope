import { CartesianGrid, ComposedChart, Line, ReferenceLine, Scatter, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'

import type { Vintage, VintagesResponse } from '@/types/api'
import { formatMW, formatUkFull } from '@/utils/format'

import { axisProps, ChartFrame, COLORS, gridProps, Legend, LegendItem, niceScale, tickDateTime, tickGW, TooltipBox } from './chartTheme'

interface Point extends Vintage {
  t: number
  eligibleValue: number | null
  lateValue: number | null
}

/** Forecast value for one target period across publication vintages, with the cutoff marked. */
export function VintageChart({ data }: { data: VintagesResponse }) {
  const points: Point[] = data.vintages.map((v) => ({
    ...v,
    t: new Date(v.publish_time ?? 0).getTime(),
    eligibleValue: v.eligible ? v.generation_mw : null,
    lateValue: v.eligible ? null : v.generation_mw,
  }))
  const cutoff = new Date(data.cutoff_time).getTime()
  const target = new Date(data.target_time).getTime()
  const selected = points.find((p) => p.selected)
  // Include the actual outturn so its reference line is always inside the plot.
  const y = niceScale([...points.map((p) => p.generation_mw), data.actual_mw], { includeZero: false })

  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) => {
    if (!active || !payload?.length) return null
    const v = payload[0].payload
    return (
      <TooltipBox
        title={`Published ${formatUkFull(v.publish_time)}`}
        rows={[
          { label: 'Forecast', value: formatMW(v.generation_mw), color: v.eligible ? COLORS.forecast : COLORS.latest },
          { label: 'Lead time', value: v.horizon_hours === null ? '—' : `${v.horizon_hours} h` },
          { label: 'Error vs actual', value: formatMW(v.error_mw, { signed: true }) },
          { label: 'Eligible at cutoff', value: v.eligible ? (v.selected ? 'Yes — selected' : 'Yes') : 'No — published after cutoff' },
        ]}
      />
    )
  }

  return (
    <div>
      <Legend>
        <LegendItem color={COLORS.forecast} label="Eligible vintage" />
        <LegendItem color={COLORS.latest} dashed label="Published after cutoff (excluded)" />
        <LegendItem color={COLORS.actual} dashed label="Actual outturn" />
        <LegendItem color={COLORS.negative} dashed label="Decision cutoff" />
      </Legend>
      <ChartFrame height={260} summary="Chart of forecast value for the selected target period by publication time, showing the decision cutoff">
        <ComposedChart data={points} margin={{ top: 16, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', Math.max(target, points.at(-1)?.t ?? target)]}
            tickFormatter={tickDateTime}
            minTickGap={60}
            {...axisProps}
          />
          <YAxis tickFormatter={tickGW} width={44} domain={y.domain} ticks={y.ticks} {...axisProps} />
          <ZAxis range={[50, 50]} />
          <Tooltip content={<Tip />} />
          <ReferenceLine
            x={cutoff}
            stroke={COLORS.negative}
            strokeDasharray="4 3"
            label={{ value: 'Cutoff', position: 'top', fill: COLORS.negative, fontSize: 11 }}
          />
          <ReferenceLine
            x={target}
            stroke={COLORS.axis}
            strokeDasharray="2 3"
            label={{ value: 'Delivery', position: 'top', fill: COLORS.axis, fontSize: 11 }}
          />
          {data.actual_mw !== null && <ReferenceLine y={data.actual_mw} stroke={COLORS.actual} strokeDasharray="4 3" />}
          <Line dataKey="generation_mw" stroke={COLORS.muted} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Scatter dataKey="eligibleValue" fill={COLORS.forecast} isAnimationActive={false} />
          <Scatter dataKey="lateValue" fill="#fff" stroke={COLORS.latest} strokeWidth={1.5} isAnimationActive={false} />
          {selected && (
            <ReferenceLine
              x={selected.t}
              stroke={COLORS.forecast}
              strokeOpacity={0}
              label={{ value: '● Selected', position: 'insideBottom', fill: COLORS.forecast, fontSize: 11 }}
            />
          )}
        </ComposedChart>
      </ChartFrame>
    </div>
  )
}
