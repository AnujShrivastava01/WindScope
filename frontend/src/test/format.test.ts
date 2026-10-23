import { describe, expect, it } from 'vitest'

import { niceScale } from '@/components/charts/chartTheme'
import { buildUrl } from '@/services/api'
import { daysBetweenInclusive, formatMW, formatPct, formatUk, formatUkFull, shiftDate } from '@/utils/format'

describe('formatting', () => {
  it('formats megawatts with sign and missing values', () => {
    expect(formatMW(12345.6)).toBe('12,346 MW')
    expect(formatMW(250, { signed: true })).toBe('+250 MW')
    expect(formatMW(-250, { signed: true, unit: false })).toBe('-250')
    expect(formatMW(null)).toBe('—')
    expect(formatMW(Number.NaN)).toBe('—')
  })

  it('formats percentages', () => {
    expect(formatPct(21.397)).toBe('21.4%')
    expect(formatPct(null)).toBe('—')
  })

  it('renders timestamps in UK local time including BST', () => {
    expect(formatUk('2026-01-15T12:00:00Z')).toBe('15 Jan, 12:00')
    expect(formatUk('2026-07-15T12:00:00Z')).toBe('15 Jul, 13:00')
    expect(formatUkFull('2026-01-15T12:00:00Z')).toContain('GMT')
    expect(formatUkFull('2026-07-15T12:00:00Z')).toContain('BST')
  })

  it('shifts and counts calendar dates', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(daysBetweenInclusive('2026-01-02', '2026-02-01')).toBe(31)
  })
})

describe('niceScale', () => {
  it('produces rounded, evenly spaced ticks from zero', () => {
    const { domain, ticks } = niceScale([1200, 21_800])
    expect(domain).toEqual([0, 25_000])
    expect(ticks).toEqual([0, 5000, 10_000, 15_000, 20_000, 25_000])
  })

  it('supports symmetric ranges for signed errors', () => {
    const { domain } = niceScale([-3000, 6857], { symmetric: true })
    expect(domain[0]).toBe(-domain[1])
  })
})

describe('buildUrl', () => {
  it('drops empty parameters', () => {
    expect(buildUrl('/api/actuals', { a: 1, b: '', c: undefined, d: null })).toBe('/api/actuals?a=1')
  })
})
