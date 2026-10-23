export const UK_TZ = 'Europe/London'

const mwFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const pctFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TZ,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const fullDateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })
const longDayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const zoneNameFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK_TZ, timeZoneName: 'short' })

export const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

export function formatMW(value: number | null | undefined, { unit = true, signed = false } = {}): string {
  if (!isNum(value)) return '—'
  const text = mwFormatter.format(value)
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${text}${unit ? ' MW' : ''}`
}

export function formatGW(value: number | null | undefined): string {
  if (!isNum(value)) return '—'
  return `${(value / 1000).toFixed(1)} GW`
}

export function formatPct(value: number | null | undefined): string {
  if (!isNum(value)) return '—'
  return `${pctFormatter.format(value)}%`
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (!isNum(value)) return '—'
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

/** "15 Jan, 13:00" in UK local time. */
export function formatUk(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

/** "15 Jan 2026, 13:00 GMT" in UK local time with zone abbreviation. */
export function formatUkFull(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : fullDateTimeFmt.format(d).replace('GMT+1', 'BST').replace('GMT+0', 'GMT')
}

/** Calendar date (YYYY-MM-DD) rendered as "15 Jan". */
export function formatDay(date: string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '—' : dayFmt.format(d)
}

export function formatLongDay(date: string | null | undefined): string {
  if (!date) return '—'
  const d = new Date(`${date}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? '—' : longDayFmt.format(d)
}

/** Current UK zone abbreviation, GMT or BST. */
export function ukZoneName(at: Date = new Date()): string {
  return zoneNameFmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'UK'
}

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never'
  const diffMs = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(diffMs)) return '—'
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** Shift a YYYY-MM-DD date string by whole days. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetweenInclusive(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000) + 1
}
