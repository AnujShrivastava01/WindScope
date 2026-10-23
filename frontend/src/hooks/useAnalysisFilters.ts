import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useMeta } from '@/hooks/queries'
import type { AnalysisQuery } from '@/services/api'
import { shiftDate } from '@/utils/format'

export const FALLBACK_DECISION_START = '2026-01-01'
export const FALLBACK_DECISION_END = '2026-01-31'

export interface AnalysisFilters {
  /** First UK delivery date (inclusive). */
  startDate: string
  /** Last UK delivery date (inclusive). */
  endDate: string
  /** Decision cutoff, UK local HH:MM. */
  cutoffTime: string
  /** Cutoff falls on delivery date minus this many days. */
  daysBefore: number
}

/**
 * Analysis filters (delivery date range + decision cutoff) live in the URL so
 * every page shares them and views can be bookmarked or shared.
 */
export function useAnalysisFilters() {
  const [params, setParams] = useSearchParams()
  const meta = useMeta()

  const decisionStart = meta.data?.decision_date_start ?? FALLBACK_DECISION_START
  const decisionEnd = meta.data?.decision_date_end ?? FALLBACK_DECISION_END
  const defaultCutoff = meta.data?.default_cutoff_time ?? '10:00'
  const defaultDays = meta.data?.default_cutoff_days_before ?? 1
  const maxDays = meta.data?.max_cutoff_days_before ?? 2

  const daysParam = Number(params.get('days'))
  const daysBefore = Number.isInteger(daysParam) && daysParam >= 1 && daysParam <= maxDays ? daysParam : defaultDays
  const cutoffParam = params.get('cutoff')
  const cutoffTime = cutoffParam && /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffParam) ? cutoffParam : defaultCutoff
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const startDate = fromParam && dateRe.test(fromParam) ? fromParam : shiftDate(decisionStart, daysBefore)
  const endDate = toParam && dateRe.test(toParam) ? toParam : shiftDate(decisionEnd, daysBefore)

  const filters: AnalysisFilters = { startDate, endDate, cutoffTime, daysBefore }

  const query: AnalysisQuery = useMemo(
    () => ({ start_date: startDate, end_date: endDate, cutoff_time: cutoffTime, cutoff_days_before: daysBefore }),
    [startDate, endDate, cutoffTime, daysBefore],
  )

  const setFilters = useCallback(
    (next: Partial<AnalysisFilters>) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev)
          if (next.startDate !== undefined) out.set('from', next.startDate)
          if (next.endDate !== undefined) out.set('to', next.endDate)
          if (next.cutoffTime !== undefined) out.set('cutoff', next.cutoffTime)
          if (next.daysBefore !== undefined) out.set('days', String(next.daysBefore))
          return out
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const reset = useCallback(() => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        for (const key of ['from', 'to', 'cutoff', 'days']) out.delete(key)
        return out
      },
      { replace: true },
    )
  }, [setParams])

  const isDefault = !fromParam && !toParam && !cutoffParam && !params.get('days')

  return {
    filters,
    query,
    setFilters,
    reset,
    isDefault,
    decisionStart,
    decisionEnd,
    maxDays,
    ready: !meta.isLoading,
  }
}
