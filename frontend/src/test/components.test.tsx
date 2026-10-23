import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { Wind } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { ForecastScatter } from '@/components/charts/AccuracyCharts'
import { ErrorChart, ForecastActualChart } from '@/components/charts/TimeSeriesCharts'
import { KpiCard } from '@/components/kpi/KpiCard'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { ErrorState } from '@/components/ui/feedback'

import { period, timeseries } from './fixtures'

interface Row {
  id: string
  name: string
  value: number
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha', value: 1 },
  { id: 'b', name: 'Bravo', value: 2 },
]
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortKey: 'name', render: (r) => r.name },
  { key: 'value', header: 'Value', sortKey: 'value', align: 'right', render: (r) => r.value },
]

describe('KpiCard', () => {
  it('renders value, unit and detail', () => {
    render(<KpiCard label="Mean absolute error" value="1,996" unit="MW" detail="744 periods" icon={Wind} />)
    const card = screen.getByRole('article', { name: 'Mean absolute error' })
    expect(within(card).getByText('1,996')).toBeInTheDocument()
    expect(within(card).getByText('MW')).toBeInTheDocument()
    expect(within(card).getByText('744 periods')).toBeInTheDocument()
  })

  it('shows a skeleton instead of a value while loading', () => {
    render(<KpiCard label="RMSE" value="2,499" loading />)
    expect(screen.queryByText('2,499')).not.toBeInTheDocument()
  })
})

describe('DataTable', () => {
  it('toggles sort order and exposes aria-sort', async () => {
    const onSortChange = vi.fn()
    const { rerender } = render(
      <DataTable caption="Test" columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'name', order: 'asc' }} onSortChange={onSortChange} />,
    )
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(screen.getByRole('button', { name: /name/i }))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', order: 'desc' })
    await userEvent.click(screen.getByRole('button', { name: /value/i }))
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'value', order: 'desc' })

    rerender(
      <DataTable caption="Test" columns={columns} rows={rows} rowKey={(r) => r.id} sort={{ key: 'value', order: 'desc' }} onSortChange={onSortChange} />,
    )
    expect(screen.getByRole('columnheader', { name: /value/i })).toHaveAttribute('aria-sort', 'descending')
  })

  it('paginates and reports the visible range', async () => {
    const onPageChange = vi.fn()
    render(
      <DataTable
        caption="Paged"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        pagination={{ page: 1, pageSize: 2, total: 5, onPageChange }}
      />,
    )
    expect(screen.getByText('Showing 1–2 of 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('shows an empty message and supports keyboard row selection', async () => {
    const { rerender } = render(<DataTable caption="Empty" columns={columns} rows={[]} rowKey={(r) => r.id} />)
    expect(screen.getByText('No records match the current filters.')).toBeInTheDocument()

    const onRowClick = vi.fn()
    rerender(
      <DataTable caption="Rows" columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} rowLabel={(r) => `Open ${r.name}`} />,
    )
    screen.getByRole('row', { name: 'Open Bravo' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledWith(rows[1])
  })

  it('has no detectable accessibility violations', async () => {
    const { container } = render(
      <DataTable
        caption="Accessible table"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', order: 'asc' }}
        onSortChange={() => {}}
        pagination={{ page: 1, pageSize: 10, total: 2, onPageChange: () => {}, onPageSizeChange: () => {} }}
      />,
    )
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations).toEqual([])
  })
})

describe('charts', () => {
  it('renders the forecast vs actual chart with legend and accessible summary', () => {
    render(<ForecastActualChart items={timeseries.items} showLatest />)
    expect(screen.getByRole('img', { name: /decision-time wind forecast versus actual/i })).toBeInTheDocument()
    expect(screen.getByText('Decision-time forecast (WINDFOR)')).toBeInTheDocument()
    expect(screen.getByText('Actual generation (FUELHH WIND)')).toBeInTheDocument()
    expect(screen.getByText(/Latest available forecast/)).toBeInTheDocument()
  })

  it('renders the error chart with a zero-reference description', () => {
    render(<ErrorChart items={[period(), period({ start_time: '2026-01-02T01:00:00Z', error_mw: -20 })]} />)
    expect(screen.getByRole('img', { name: /signed forecast error/i })).toBeInTheDocument()
    expect(screen.getByText(/Under-forecast/)).toBeInTheDocument()
  })

  it('renders the scatter plot', () => {
    render(<ForecastScatter points={[{ start_time: '2026-01-02T00:00:00Z', forecast_mw: 1050, actual_mw: 1000, error_mw: 50 }]} />)
    expect(screen.getByRole('img', { name: /scatter plot/i })).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('announces errors and offers retry', async () => {
    const onRetry = vi.fn()
    render(<ErrorState error={new Error('Backend unavailable')} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
