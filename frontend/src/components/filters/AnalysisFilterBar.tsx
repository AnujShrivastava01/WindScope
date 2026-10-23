import { CalendarRange, Clock, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Segmented, Select } from '@/components/ui/form'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import { daysBetweenInclusive, formatLongDay, shiftDate } from '@/utils/format'

type DateMode = 'decision' | 'delivery'

const CUTOFF_PRESETS = ['08:00', '09:00', '09:30', '10:00', '11:00', '12:00', '16:00']

/**
 * Shared analysis controls. Internally the range is stored as UK delivery dates;
 * analysts can edit it as procurement decision dates instead (delivery − D-n).
 */
export function AnalysisFilterBar({ showDateMode = true }: { showDateMode?: boolean }) {
  const { filters, setFilters, reset, isDefault, decisionStart, decisionEnd, maxDays } = useAnalysisFilters()
  const [mode, setMode] = useState<DateMode>('decision')
  const offset = mode === 'decision' ? -filters.daysBefore : 0
  const shownStart = shiftDate(filters.startDate, offset)
  const shownEnd = shiftDate(filters.endDate, offset)
  const days = daysBetweenInclusive(filters.startDate, filters.endDate)
  const invalid = days < 1

  const toDelivery = (value: string) => shiftDate(value, -offset)
  const minShown = mode === 'decision' ? decisionStart : shiftDate(decisionStart, filters.daysBefore)
  const maxShown = mode === 'decision' ? decisionEnd : shiftDate(decisionEnd, filters.daysBefore)

  return (
    <section
      aria-label="Analysis filters"
      className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs"
    >
      {showDateMode && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600" id="date-mode-label">
            Filter by
          </span>
          <Segmented<DateMode>
            label="Date type"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'decision', label: 'Decision date' },
              { value: 'delivery', label: 'Delivery date' },
            ]}
          />
        </div>
      )}
      <Field label={mode === 'decision' ? 'Decision from' : 'Delivery from'} htmlFor="filter-start">
        <Input
          id="filter-start"
          type="date"
          value={shownStart}
          min={minShown}
          max={maxShown}
          onChange={(e) => e.target.value && setFilters({ startDate: toDelivery(e.target.value) })}
        />
      </Field>
      <Field label={mode === 'decision' ? 'Decision to' : 'Delivery to'} htmlFor="filter-end">
        <Input
          id="filter-end"
          type="date"
          value={shownEnd}
          min={minShown}
          max={maxShown}
          onChange={(e) => e.target.value && setFilters({ endDate: toDelivery(e.target.value) })}
        />
      </Field>
      <Field label="Decision cutoff (UK)" htmlFor="filter-cutoff">
        <Select id="filter-cutoff" value={filters.cutoffTime} onChange={(e) => setFilters({ cutoffTime: e.target.value })}>
          {Array.from(new Set([...CUTOFF_PRESETS, filters.cutoffTime]))
            .sort()
            .map((t) => (
              <option key={t} value={t}>
                {t}
                {t === '10:00' ? ' (default)' : ''}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Cutoff day" htmlFor="filter-days">
        <Select
          id="filter-days"
          value={filters.daysBefore}
          onChange={(e) => {
            const next = Number(e.target.value)
            // Keep the same decision dates when the offset changes.
            const delta = next - filters.daysBefore
            setFilters({
              daysBefore: next,
              startDate: shiftDate(filters.startDate, delta),
              endDate: shiftDate(filters.endDate, delta),
            })
          }}
        >
          {Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              D-{d} {d === 1 ? '(day-ahead)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="ghost" size="sm" onClick={reset} disabled={isDefault} className="mb-0.5">
        <RotateCcw aria-hidden /> Reset
      </Button>
      <div className="ml-auto flex min-w-56 flex-col gap-0.5 text-[11px] leading-relaxed text-slate-500" aria-live="polite">
        {invalid ? (
          <span role="alert" className="font-medium text-red-700">
            Start date must be on or before end date.
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <CalendarRange aria-hidden className="size-3" />
              Delivery {formatLongDay(filters.startDate)} – {formatLongDay(filters.endDate)} ({days} days)
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-3" />
              Forecast must be published by {filters.cutoffTime} UK on D-{filters.daysBefore}
            </span>
          </>
        )}
      </div>
    </section>
  )
}
