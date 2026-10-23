import { CalendarDays, Globe2, Menu, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDataHealth, useHealth, useRefreshData } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import { formatLongDay, formatUkFull, relativeTime, ukZoneName } from '@/utils/format'
import { DATASET_STATUS, type Tone } from '@/utils/status'

import { Logo } from './Sidebar'

export function useRefreshWithFeedback() {
  const refresh = useRefreshData()
  const run = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        const summary = Object.entries(result.datasets)
          .map(([name, d]) => `${name === 'actual' ? 'Actuals' : 'Forecasts'}: ${d.status} (${d.received.toLocaleString('en-GB')} rows)`)
          .join(' · ')
        if (result.status === 'success') toast.success('Data refreshed from Elexon', { description: summary })
        else if (result.status === 'partial')
          toast.warning('Refresh partially succeeded', { description: `${summary}. See Data Health for details.` })
        else toast.error('Refresh failed', { description: `${summary}. Existing stored data is unchanged.` })
      },
      onError: (error) => toast.error('Refresh failed', { description: error.message }),
    })
  return { run, isPending: refresh.isPending }
}

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const { filters } = useAnalysisFilters()
  const health = useHealth()
  const dataHealth = useDataHealth()
  const { run, isPending } = useRefreshWithFeedback()

  const datasets = dataHealth.data?.datasets
  const lastFetch = [datasets?.actual.last_successful_fetch, datasets?.forecast.last_successful_fetch]
    .filter(Boolean)
    .sort()
    .at(0)

  let availability: { tone: Tone; label: string; title: string }
  if (health.isError) availability = { tone: 'danger', label: 'API offline', title: 'The backend API is unreachable.' }
  else if (health.data?.refresh_in_progress || isPending)
    availability = { tone: 'info', label: 'Loading data…', title: 'Fetching data from Elexon.' }
  else if (!datasets) availability = { tone: 'neutral', label: 'Checking…', title: 'Checking data availability.' }
  else {
    const worst = (['empty', 'incomplete', 'stale', 'ok'] as const).find(
      (s) => datasets.actual.status === s || datasets.forecast.status === s,
    )!
    const label = worst === 'ok' ? 'Jan 2026 data complete' : `Data ${DATASET_STATUS[worst].label.toLowerCase()}`
    availability = {
      tone: DATASET_STATUS[worst].tone,
      label,
      title: [...datasets.actual.reasons, ...datasets.forecast.reasons].join(' '),
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <div className="lg:hidden">
        <div className="rounded-md bg-navy-900 px-2 py-1">
          <Logo compact />
        </div>
      </div>
      <div className="hidden min-w-0 items-center gap-2 text-sm text-slate-600 md:flex">
        <CalendarDays aria-hidden className="size-4 text-slate-400" />
        <span className="truncate">
          <span className="font-medium text-slate-900">Delivery {formatLongDay(filters.startDate)}</span> –{' '}
          <span className="font-medium text-slate-900">{formatLongDay(filters.endDate)}</span>
          <span className="text-slate-500"> · cutoff {filters.cutoffTime} D-{filters.daysBefore}</span>
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span
          className="hidden items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline-flex"
          title={`All times are shown in UK local time (Europe/London). Currently ${ukZoneName()}; January 2026 data is GMT.`}
        >
          <Globe2 aria-hidden className="size-3" /> UK time · Europe/London
        </span>
        <Badge tone={availability.tone} title={availability.title} className="hidden sm:inline-flex">
          {availability.label}
        </Badge>
        <span className="hidden text-xs text-slate-500 xl:inline" title={lastFetch ? formatUkFull(lastFetch) : undefined}>
          Last refresh: {lastFetch ? relativeTime(lastFetch) : 'never'}
        </span>
        <Button variant="secondary" size="sm" onClick={run} disabled={isPending} aria-label="Refresh data from Elexon">
          <RefreshCw aria-hidden className={isPending ? 'animate-spin' : undefined} />
          <span className="hidden sm:inline">{isPending ? 'Refreshing…' : 'Refresh'}</span>
        </Button>
      </div>
    </header>
  )
}
