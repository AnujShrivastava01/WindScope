import { AlertOctagon, Database, Loader2, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 aria-hidden className={cn('size-4 animate-spin', className)} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function LoadingBlock({ label = 'Loading data', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="text-slate-400">{icon ?? <Database aria-hidden className="size-6" />}</div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load data',
  className,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
}) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-6 py-8 text-center',
        className,
      )}
    >
      <AlertOctagon aria-hidden className="size-6 text-red-600" />
      <p className="text-sm font-medium text-red-900">{title}</p>
      <p className="max-w-md text-xs text-red-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          <RotateCcw aria-hidden /> Retry
        </Button>
      )}
    </div>
  )
}
