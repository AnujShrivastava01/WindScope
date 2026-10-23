import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ForecastAccuracy from '@/pages/ForecastAccuracy'
import HistoricalData from '@/pages/HistoricalData'
import Overview from '@/pages/Overview'

import * as fx from './fixtures'
import { currentLocation, json, mockFetch, renderWithProviders } from './utils'

const distribution = { window: fx.window, count: 0, abs_error_histogram: [], error_histogram: [], scatter: [], quantiles: {} }

describe('Overview page', () => {
  it('shows loading feedback, then KPIs from the API', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/overview') return json(fx.overview)
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    renderWithProviders(<Overview />)
    expect(screen.getByRole('article', { name: 'Mean absolute error' })).toBeInTheDocument()

    const mae = await screen.findByRole('article', { name: 'Mean absolute error' })
    await waitFor(() => expect(within(mae).getByText('75')).toBeInTheDocument())
    expect(within(screen.getByRole('article', { name: 'Forecast error' })).getByText('+100')).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Forecast coverage' })).getByText('8.3')).toBeInTheDocument()
    // Late-only period has no observed actual and must not display zero.
    const table = screen.getByRole('table', { name: 'Most recent settlement periods' })
    expect(within(table).getByText('Not observed')).toBeInTheDocument()
    expect(within(table).getByText('Late only')).toBeInTheDocument()
  })

  it('shows an empty state when no records exist', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/overview') return json(fx.emptyOverview)
      if (url.pathname === '/api/accuracy/timeseries') return json({ ...fx.timeseries, items: [], count: 0 })
    })
    renderWithProviders(<Overview />)
    expect(await screen.findByText('No data for this selection')).toBeInTheDocument()
  })

  it('shows an error state with retry when the API fails', async () => {
    let calls = 0
    mockFetch((url) => {
      if (url.pathname === '/api/overview') {
        calls += 1
        return calls === 1
          ? json({ error: { code: 'internal_error', message: 'An unexpected error occurred. Please retry.' } }, 500)
          : json(fx.overview)
      }
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    renderWithProviders(<Overview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('An unexpected error occurred')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(calls).toBe(2))
    expect(await screen.findByRole('table', { name: 'Most recent settlement periods' })).toBeInTheDocument()
  })

  it('passes filter changes to the backend query', async () => {
    const fetchSpy = mockFetch((url) => {
      if (url.pathname === '/api/overview') return json(fx.overview)
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    renderWithProviders(<Overview />)
    await screen.findByRole('table', { name: 'Most recent settlement periods' })
    await userEvent.selectOptions(screen.getByLabelText('Decision cutoff (UK)'), '09:00')
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([input]) => String(input).includes('/api/overview') && String(input).includes('cutoff_time=09%3A00')),
      ).toBe(true),
    )
    expect(currentLocation).toContain('cutoff=09%3A00')
  })
})

describe('Forecast Accuracy page', () => {
  it('renders metric tiles and the empirical range from backend data', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/accuracy/summary') return json(fx.summary)
      if (url.pathname === '/api/accuracy/distribution') return json({ ...distribution, count: 2 })
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    renderWithProviders(<ForecastAccuracy />)
    expect(await screen.findByText('0 zero-actual period(s) excluded')).toBeInTheDocument()
    expect(screen.getByText('6.8%')).toBeInTheDocument() // WAPE
    expect(screen.getByText(/descriptive, not a guaranteed interval/)).toBeInTheDocument()
  })

  it('does not draw placeholder charts when nothing is matched', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/accuracy/summary')
        return json({ ...fx.summary, metrics: { ...fx.metrics, count: 0, mae_mw: null }, daily: [], largest_errors: [] })
      if (url.pathname === '/api/accuracy/distribution') return json(distribution)
      if (url.pathname === '/api/accuracy/timeseries') return json({ ...fx.timeseries, items: [] })
    })
    renderWithProviders(<ForecastAccuracy />)
    await waitFor(() => expect(screen.getAllByText('No matched observations').length).toBeGreaterThan(3))
  })
})

describe('Historical Data page', () => {
  const actualsPage = {
    items: [
      {
        start_time: '2026-01-02T00:00:00Z',
        settlement_date: '2026-01-02',
        settlement_period: 1,
        generation_mw: 1000,
        publish_time: '2026-01-02T00:30:00Z',
        source: 'elexon_api',
        ingested_at: '2026-02-05T11:00:00Z',
      },
    ],
    total: 120,
    page: 1,
    page_size: 50,
    unit: 'MW',
    expected_periods: 48,
    missing_periods: 47,
  }

  it('requests sorted pages and flags missing periods', async () => {
    const fetchSpy = mockFetch((url) => {
      if (url.pathname === '/api/actuals') return json({ ...actualsPage, page: Number(url.searchParams.get('page')) })
    })
    renderWithProviders(<HistoricalData />)
    expect(await screen.findByText('47 periods missing')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /generation/i }))
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('sort=generation_mw') && String(u).includes('order=desc'))).toBe(true),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true))
  })

  it('exports exactly the filtered dataset as CSV', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const fetchSpy = mockFetch((url) => {
      if (url.pathname === '/api/actuals') return json(actualsPage)
      if (url.pathname === '/api/export/csv')
        return new Response('start_time_utc,generation_mw\n2026-01-02T00:00:00Z,1000\n', {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="windscope_actuals.csv"',
            'X-Record-Count': '1',
          },
        })
    })
    renderWithProviders(<HistoricalData />, { route: '/historical-data?from=2026-01-05&to=2026-01-06' })
    await screen.findByText('47 periods missing')
    await userEvent.click(screen.getByRole('button', { name: /export filtered csv/i }))
    await waitFor(() => expect(createUrl).toHaveBeenCalled())
    const exportCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/api/export/csv'))
    const exportUrl = new URL(String(exportCall?.[0]), 'http://localhost')
    expect(exportUrl.searchParams.get('dataset')).toBe('actuals')
    expect(exportUrl.searchParams.get('start_date')).toBe('2026-01-05')
    expect(exportUrl.searchParams.get('end_date')).toBe('2026-01-06')
  })
})
