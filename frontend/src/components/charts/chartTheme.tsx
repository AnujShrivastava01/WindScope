import type { ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

import { cn } from '@/utils/cn'

// Palette validated for colour-vision deficiency separation on the light surface.
export const COLORS = {
  actual: '#2a78d6',
  forecast: '#0d9488',
  error: '#d97706',
  negative: '#dc2626',
  latest: '#64748b',
  muted: '#cbd5e1',
  grid: '#e2e8f0',
  axis: '#64748b',
  text: '#0f172a',
} as const

export const axisProps = {
  stroke: COLORS.grid,
  tick: { fill: COLORS.axis, fontSize: 11 },
  tickLine: false,
} as const

export const gridProps = { stroke: COLORS.grid, strokeDasharray: '3 3', vertical: false } as const

/** Sized, labelled container for a chart. `summary` is read by screen readers. */
export function ChartFrame({
  height = 300,
  summary,
  children,
  className,
}: {
  height?: number
  summary: string
  children: ReactNode
  className?: string
}) {
  return (
    <figure className={cn('w-full', className)} style={{ height }} aria-label={summary} role="img">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height }}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </figure>
  )
}

export function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div className="min-w-48 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-semibold text-slate-900">{title}</p>
      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-slate-500">
              {row.color && <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: row.color }} />}
              {row.label}
            </dt>
            <dd className="font-medium text-slate-900 tabular">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function LegendItem({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <svg aria-hidden width="18" height="8">
        <line x1="1" y1="4" x2="17" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '4 3' : undefined} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  )
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">{children}</div>
}

const ukTick = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short' })
const ukTickTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const tickDate = (ms: number) => ukTick.format(new Date(ms))
export const tickDateTime = (ms: number) => ukTickTime.format(new Date(ms))
export const tickGW = (v: number) => {
  const gw = v / 1000
  return Number.isInteger(gw) ? String(gw) : gw.toFixed(1)
}

/** Round axis bounds and evenly spaced ticks (e.g. 0, 5, 10, 15, 20, 25 GW). */
export function niceScale(
  values: (number | null | undefined)[],
  { includeZero = true, symmetric = false, targetTicks = 5 } = {},
): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  let lo = finite.length ? Math.min(...finite) : 0
  let hi = finite.length ? Math.max(...finite) : 1
  if (includeZero) {
    lo = Math.min(lo, 0)
    hi = Math.max(hi, 0)
  }
  if (symmetric) {
    const bound = Math.max(Math.abs(lo), Math.abs(hi))
    lo = -bound
    hi = bound
  }
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Math.round(t * 1000) / 1000)
  return { domain: [start, end], ticks }
}
