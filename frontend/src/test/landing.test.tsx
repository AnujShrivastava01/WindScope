import { render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { describe, expect, it, vi } from 'vitest'

import { WindFarm } from '@/components/landing/visuals'
import Landing from '@/pages/Landing'

import * as fx from './fixtures'
import { json, mockFetch, renderWithProviders } from './utils'

describe('Landing page', () => {
  it('links into the dashboard and shows live metrics from the API', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/accuracy/summary') return json(fx.summary)
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    renderWithProviders(<Landing />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/actually count on/i)
    const ctas = screen.getAllByRole('link', { name: /enter (the )?dashboard/i })
    expect(ctas.length).toBeGreaterThanOrEqual(2)
    ctas.forEach((link) => expect(link).toHaveAttribute('href', '/overview'))

    const live = screen.getByRole('region', { name: 'Live January 2026 results' })
    expect(await within(live).findByText('75 MW')).toBeInTheDocument() // MAE from the API
    expect(within(live).getByText('Live API data')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /decision-time wind forecast versus actual/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Timeline of forecast publications/i })).toBeInTheDocument()
  })

  it('never shows invented numbers when the API is unavailable', async () => {
    mockFetch((url) => {
      if (url.pathname.startsWith('/api/accuracy')) return json({ error: { code: 'internal_error', message: 'down' } }, 500)
    })
    renderWithProviders(<Landing />)
    const live = screen.getByRole('region', { name: 'Live January 2026 results' })
    expect(await within(live).findByText('API unavailable')).toBeInTheDocument()
    expect(within(live).getByText(/Live metrics are unavailable/)).toBeInTheDocument()
    expect(within(live).queryByText(/MW$/)).not.toBeInTheDocument()
  })

  it('has no detectable accessibility violations', async () => {
    mockFetch((url) => {
      if (url.pathname === '/api/accuracy/summary') return json(fx.summary)
      if (url.pathname === '/api/accuracy/timeseries') return json(fx.timeseries)
    })
    const { container } = renderWithProviders(<Landing />)
    await screen.findAllByText('75 MW')
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => v.id)).toEqual([])
  })
})

describe('WindFarm hero illustration', () => {
  it('animates the rotors normally and stays still when reduced motion is requested', () => {
    const { container, unmount } = render(<WindFarm />)
    expect(container.querySelectorAll('animateTransform')).toHaveLength(10)
    unmount()

    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    )
    const still = render(<WindFarm />)
    expect(still.container.querySelectorAll('animateTransform')).toHaveLength(0)
    expect(still.container.querySelector('svg')).toHaveAttribute('aria-hidden')
  })
})
