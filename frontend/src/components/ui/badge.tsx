import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'
import type { Tone } from '@/utils/status'

const toneClasses: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  danger: 'bg-red-50 text-red-800 ring-red-600/20',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  info: 'bg-sky-50 text-sky-800 ring-sky-600/20',
}

const toneIcons: Record<Tone, typeof Info> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: CircleDashed,
  info: Info,
}

/** Status badge: colour is always paired with an icon and a text label. */
export function Badge({
  tone = 'neutral',
  children,
  className,
  icon = true,
  title,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  icon?: boolean
  title?: string
}) {
  const Icon = toneIcons[tone]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  )
}
