import { BookOpen, Database, Gauge, HeartPulse, LayoutDashboard, LineChart, X } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { cn } from '@/utils/cn'

export const NAV_ITEMS = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/forecast-analysis', label: 'Forecast Analysis', icon: LineChart },
  { to: '/forecast-accuracy', label: 'Forecast Accuracy', icon: Gauge },
  { to: '/historical-data', label: 'Historical Data', icon: Database },
  { to: '/data-health', label: 'Data Health', icon: HeartPulse },
  { to: '/methodology', label: 'Methodology', icon: BookOpen },
] as const

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg aria-hidden viewBox="0 0 32 32" className="size-8 shrink-0">
        <rect width="32" height="32" rx="7" fill="#14b8a6" fillOpacity="0.14" />
        <path d="M16 16 L16 6 A4 4 0 0 1 19 12 Z M16 16 L24.7 21 A4 4 0 0 1 18 20.5 Z M16 16 L7.3 21 A4 4 0 0 1 11 14.5 Z" fill="#2dd4bf" />
        <circle cx="16" cy="16" r="2" fill="#f8fafc" />
        <rect x="15.2" y="17" width="1.6" height="11" rx=".8" fill="#94a3b8" />
      </svg>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-white">WindScope</p>
          <p className="text-[10.5px] text-slate-400">Renewable Generation Intelligence</p>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { search } = useLocation()
  return (
    <>
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-slate-300 transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        <div className="flex h-16 items-center justify-between border-b border-white/5 px-5">
          <Link to="/" aria-label="WindScope home" className="rounded-md">
            <Logo />
          </Link>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={{ pathname: to, search }}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden className={cn('size-4', isActive ? 'text-brand-500' : 'text-slate-500 group-hover:text-slate-300')} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/5 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
          <p className="font-medium text-slate-400">Data: Elexon BMRS</p>
          <p>FUELHH (WIND) · WINDFOR</p>
          <p className="mt-1">GB national wind · 30-min settlement periods</p>
        </div>
      </aside>
    </>
  )
}
