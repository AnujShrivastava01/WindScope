import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Skeleton } from '@/components/ui/feedback'
import { cn } from '@/utils/cn'

export type KpiAccent = 'brand' | 'actual' | 'error' | 'neutral' | 'danger'

const accentBar: Record<KpiAccent, string> = {
  brand: 'bg-series-forecast',
  actual: 'bg-series-actual',
  error: 'bg-series-error',
  neutral: 'bg-slate-400',
  danger: 'bg-series-negative',
}

export function KpiCard({
  label,
  value,
  unit,
  detail,
  icon: Icon,
  accent = 'neutral',
  loading = false,
  footnote,
}: {
  label: string
  value: ReactNode
  unit?: string
  detail?: ReactNode
  icon?: LucideIcon
  accent?: KpiAccent
  loading?: boolean
  footnote?: ReactNode
}) {
  return (
    <article
      aria-label={label}
      className="relative flex min-h-[124px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-xs"
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', accentBar[accent])} />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-slate-500">{label}</h3>
        {Icon && <Icon aria-hidden className="size-4 text-slate-400" />}
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-1.5 tabular">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">{value}</span>
            {unit && <span className="text-sm font-medium text-slate-500">{unit}</span>}
          </p>
          {detail && <div className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</div>}
          {footnote && <div className="mt-auto pt-2 text-[11px] text-slate-400">{footnote}</div>}
        </>
      )}
    </article>
  )
}
