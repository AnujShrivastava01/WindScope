import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/feedback'
import { Select } from '@/components/ui/form'
import { cn } from '@/utils/cn'

export type SortOrder = 'asc' | 'desc'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** Server/client sort field. Omit for non-sortable columns. */
  sortKey?: string
  align?: 'left' | 'right' | 'center'
  className?: string
}

export interface SortState {
  key: string
  order: SortOrder
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSortChange,
  pagination,
  loading = false,
  onRowClick,
  rowLabel,
  selectedKey,
  emptyMessage = 'No records match the current filters.',
  className,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  pagination?: Pagination
  loading?: boolean
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  selectedKey?: string | null
  emptyMessage?: string
  className?: string
}) {
  const toggleSort = (key: string) => {
    if (!onSortChange) return
    if (sort?.key === key) onSortChange({ key, order: sort.order === 'asc' ? 'desc' : 'asc' })
    else onSortChange({ key, order: key === 'start_time' ? 'asc' : 'desc' })
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1
  const first = pagination ? (pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1) : 0
  const last = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : 0

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm" aria-busy={loading}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {columns.map((col) => {
                const active = col.sortKey && sort?.key === col.sortKey
                const ariaSort = active ? (sort!.order === 'asc' ? 'ascending' : 'descending') : col.sortKey ? 'none' : undefined
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'px-3 py-2.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase whitespace-nowrap',
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                      col.className,
                    )}
                  >
                    {col.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sortKey!)}
                        className={cn(
                          'inline-flex items-center gap-1 uppercase hover:text-slate-900',
                          active && 'text-slate-900',
                        )}
                      >
                        {col.header}
                        {active ? (
                          sort!.order === 'asc' ? (
                            <ArrowUp aria-hidden className="size-3" />
                          ) : (
                            <ArrowDown aria-hidden className="size-3" />
                          )
                        ) : (
                          <ArrowUpDown aria-hidden className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-slate-100">
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const key = rowKey(row)
                  const clickable = Boolean(onRowClick)
                  return (
                    <tr
                      key={key}
                      onClick={clickable ? () => onRowClick!(row) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onRowClick!(row)
                              }
                            }
                          : undefined
                      }
                      tabIndex={clickable ? 0 : undefined}
                      aria-label={clickable && rowLabel ? rowLabel(row) : undefined}
                      aria-selected={clickable ? selectedKey === key : undefined}
                      className={cn(
                        'border-b border-slate-100 transition-colors',
                        clickable && 'cursor-pointer hover:bg-brand-50/60 focus-visible:bg-brand-50',
                        selectedKey === key && 'bg-brand-50',
                        loading && 'opacity-60',
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-3 py-2 whitespace-nowrap text-slate-700 tabular',
                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                            col.className,
                          )}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <nav
          aria-label={`${caption} pagination`}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-600"
        >
          <span aria-live="polite">
            {pagination.total === 0
              ? 'No records'
              : `Showing ${first.toLocaleString('en-GB')}–${last.toLocaleString('en-GB')} of ${pagination.total.toLocaleString('en-GB')}`}
          </span>
          <div className="flex items-center gap-2">
            {pagination.onPageSizeChange && (
              <label className="flex items-center gap-1.5">
                <span>Rows</span>
                <Select
                  aria-label="Rows per page"
                  value={pagination.pageSize}
                  onChange={(e) => pagination.onPageSizeChange!(Number(e.target.value))}
                  className="h-8 px-2 text-xs"
                >
                  {(pagination.pageSizeOptions ?? [25, 50, 100]).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <Button
              variant="secondary"
              size="sm"
              aria-label="Previous page"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular">
              Page {pagination.page} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Next page"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </nav>
      )}
    </div>
  )
}
