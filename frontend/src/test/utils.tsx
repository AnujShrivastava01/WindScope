import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

import * as fx from './fixtures'

export type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const defaults: Record<string, unknown> = {
  '/api/meta': fx.meta,
  '/api/health': fx.health,
  '/api/data-health': fx.dataHealth,
}

/** Mock window.fetch with per-path handlers; unhandled paths fall back to shared defaults. */
export function mockFetch(handler: Handler = () => undefined) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : (input as Request).url, 'http://localhost')
    const custom = await handler(url, init)
    if (custom) return custom
    if (url.pathname in defaults) return json(defaults[url.pathname])
    return json({ error: { code: 'not_found', message: `No mock for ${url.pathname}` } }, 404)
  })
}

export let currentLocation = ''
function LocationProbe() {
  currentLocation = useLocation().search
  return null
}

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {ui}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
