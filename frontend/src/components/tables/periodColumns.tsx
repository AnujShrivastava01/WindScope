import type { Column } from '@/components/tables/DataTable'
import { Badge } from '@/components/ui/badge'
import type { Period } from '@/types/api'
import { cn } from '@/utils/cn'
import { formatMW, formatUk, isNum } from '@/utils/format'
import { PERIOD_STATUS } from '@/utils/status'

export function ErrorValue({ value, className }: { value: number | null; className?: string }) {
  if (!isNum(value)) return <span className="text-slate-400">—</span>
  return (
    <span className={cn('font-medium', value > 0 ? 'text-amber-700' : value < 0 ? 'text-red-700' : 'text-slate-700', className)}>
      {formatMW(value, { signed: true, unit: false })}
    </span>
  )
}

export function MwValue({ value, missingLabel = '—' }: { value: number | null; missingLabel?: string }) {
  if (!isNum(value)) return <span className="text-slate-400">{missingLabel}</span>
  return <>{formatMW(value, { unit: false })}</>
}

export function StatusBadge({ status }: { status: Period['status'] }) {
  const meta = PERIOD_STATUS[status]
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  )
}

type Key =
  | 'target'
  | 'sp'
  | 'forecast'
  | 'actual'
  | 'error'
  | 'abs'
  | 'published'
  | 'vintages'
  | 'horizon'
  | 'status'

const ALL: Record<Key, Column<Period>> = {
  target: {
    key: 'target',
    header: 'Target period (UK)',
    sortKey: 'start_time',
    render: (p) => <span className="font-medium text-slate-900">{formatUk(p.start_time)}</span>,
  },
  sp: { key: 'sp', header: 'SP', align: 'right', render: (p) => p.settlement_period },
  forecast: {
    key: 'forecast',
    header: 'Forecast (MW)',
    sortKey: 'forecast_mw',
    align: 'right',
    render: (p) => <MwValue value={p.forecast_mw} />,
  },
  actual: {
    key: 'actual',
    header: 'Actual (MW)',
    sortKey: 'actual_mw',
    align: 'right',
    render: (p) => <MwValue value={p.actual_mw} missingLabel="Not observed" />,
  },
  error: {
    key: 'error',
    header: 'Error (MW)',
    sortKey: 'error_mw',
    align: 'right',
    render: (p) => <ErrorValue value={p.error_mw} />,
  },
  abs: {
    key: 'abs',
    header: '|Error| (MW)',
    sortKey: 'abs_error_mw',
    align: 'right',
    render: (p) => <MwValue value={p.abs_error_mw} />,
  },
  published: {
    key: 'published',
    header: 'Forecast published (UK)',
    sortKey: 'forecast_publish_time',
    render: (p) => (p.forecast_publish_time ? formatUk(p.forecast_publish_time) : <span className="text-slate-400">—</span>),
  },
  vintages: {
    key: 'vintages',
    header: 'Eligible / late',
    sortKey: 'eligible_vintages',
    align: 'right',
    render: (p) => (
      <span>
        {p.eligible_vintages}
        <span className="text-slate-400"> / {p.excluded_late_vintages}</span>
      </span>
    ),
  },
  horizon: {
    key: 'horizon',
    header: 'Lead time',
    align: 'right',
    render: (p) => (isNum(p.forecast_horizon_hours) ? `${p.forecast_horizon_hours} h` : '—'),
  },
  status: { key: 'status', header: 'Status', sortKey: 'status', render: (p) => <StatusBadge status={p.status} /> },
}

export function periodColumns(keys: Key[]): Column<Period>[] {
  return keys.map((k) => ALL[k])
}
