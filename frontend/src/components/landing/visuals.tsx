import { useMemo } from 'react'
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { COLORS, TooltipBox } from '@/components/charts/chartTheme'
import { usePrefersReducedMotion } from '@/hooks/useMotion'
import type { Period } from '@/types/api'
import { formatMW, formatUkFull } from '@/utils/format'

interface TurbineSpec {
  x: number
  ground: number
  height: number
  /** Seconds per revolution. */
  dur: number
  /** 0 (far, hazy) .. 1 (near, crisp). */
  depth: number
  phase: number
}

const GROUND = 285

const TURBINES: TurbineSpec[] = [
  // far ridge
  { x: 330, ground: 236, height: 70, dur: 7.5, depth: 0.25, phase: 40 },
  { x: 612, ground: 230, height: 62, dur: 6.8, depth: 0.25, phase: 95 },
  { x: 872, ground: 232, height: 74, dur: 8.1, depth: 0.25, phase: 10 },
  { x: 1128, ground: 236, height: 66, dur: 7.1, depth: 0.25, phase: 70 },
  // middle distance
  { x: 205, ground: 262, height: 118, dur: 9.4, depth: 0.6, phase: 20 },
  { x: 742, ground: 258, height: 108, dur: 8.7, depth: 0.6, phase: 85 },
  { x: 1268, ground: 262, height: 124, dur: 9.9, depth: 0.6, phase: 55 },
  // foreground
  { x: 70, ground: GROUND, height: 178, dur: 11.5, depth: 1, phase: 0 },
  { x: 1008, ground: GROUND, height: 162, dur: 10.6, depth: 1, phase: 60 },
  { x: 1392, ground: GROUND, height: 184, dur: 12.2, depth: 1, phase: 30 },
]

function Turbine({ t, animate }: { t: TurbineSpec; animate: boolean }) {
  const s = t.height / 180
  const top = t.ground - t.height
  const blade = t.height * 0.43
  const bladePath = `M0 0 C ${3.4 * s} ${-blade * 0.12} ${4.6 * s} ${-blade * 0.46} ${1.3 * s} ${-blade} L ${-0.5 * s} ${-blade} C ${-1.8 * s} ${-blade * 0.56} ${-2.8 * s} ${-blade * 0.2} 0 0 Z`
  const near = t.depth === 1
  return (
    <g opacity={0.35 + t.depth * 0.65}>
      {/* tapered tower with light from the left */}
      <path
        d={`M${t.x - 5.2 * s} ${t.ground} L${t.x - 2 * s} ${top} L${t.x + 2 * s} ${top} L${t.x + 5.2 * s} ${t.ground} Z`}
        fill={near ? 'url(#towerShade)' : '#475569'}
      />
      {/* nacelle */}
      <rect x={t.x - 4.5 * s} y={top - 4.2 * s} width={15 * s} height={8.4 * s} rx={3.2 * s} fill={near ? '#e2e8f0' : '#94a3b8'} />
      <rect x={t.x + 3 * s} y={top - 4.2 * s} width={7.5 * s} height={8.4 * s} rx={3.2 * s} fill={near ? '#94a3b8' : '#64748b'} />
      {near && (
        <circle cx={t.x + 6 * s} cy={top - 5.4 * s} r={1.6 * s} fill="#ef4444">
          {animate && <animate attributeName="opacity" values="1;0.15;1" dur="2.4s" begin={`${t.phase / 60}s`} repeatCount="indefinite" />}
        </circle>
      )}
      {/* rotor: blades rotate around the hub (local origin) */}
      <g transform={`translate(${t.x} ${top})`}>
        <g transform={`rotate(${t.phase})`}>
          <g>
            {[0, 120, 240].map((angle) => (
              <path key={angle} d={bladePath} transform={`rotate(${angle})`} fill={near ? 'url(#bladeShade)' : '#99f6e4'} />
            ))}
            {animate && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur={`${t.dur}s`} repeatCount="indefinite" />}
          </g>
        </g>
        <circle r={3.4 * s} fill="#f8fafc" stroke="#0d9488" strokeWidth={0.8 * s} />
      </g>
    </g>
  )
}

/** Animated wind-farm horizon anchored to the bottom of the hero (decorative). */
export function WindFarm({ className }: { className?: string }) {
  const animate = !usePrefersReducedMotion()
  const sorted = [...TURBINES].sort((a, b) => a.depth - b.depth)
  return (
    <svg aria-hidden viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" className={className}>
      <defs>
        <linearGradient id="towerShade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="55%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        <linearGradient id="bladeShade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#5eead4" />
        </linearGradient>
        <linearGradient id="horizonGlow" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="hillBack" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#13233f" />
          <stop offset="100%" stopColor="#0b1324" />
        </linearGradient>
      </defs>
      <rect x="0" y="150" width="1440" height="150" fill="url(#horizonGlow)" />
      {/* far ridge */}
      <path d="M0 246 C 180 222 320 230 470 236 S 760 214 900 228 S 1180 240 1300 226 S 1420 232 1440 236 V300 H0 Z" fill="url(#hillBack)" />
      {sorted.filter((t) => t.depth < 0.5).map((t) => (
        <Turbine key={t.x} t={t} animate={animate} />
      ))}
      {/* middle hills */}
      <path d="M0 270 C 160 252 300 262 460 266 S 760 248 940 262 S 1220 256 1440 264 V300 H0 Z" fill="#0d182d" />
      {sorted.filter((t) => t.depth >= 0.5 && t.depth < 1).map((t) => (
        <Turbine key={t.x} t={t} animate={animate} />
      ))}
      {sorted.filter((t) => t.depth === 1).map((t) => (
        <Turbine key={t.x} t={t} animate={animate} />
      ))}
      {/* foreground ground */}
      <path d="M0 284 C 300 278 520 288 760 284 S 1180 278 1440 284 V300 H0 Z" fill="#070d1a" />
      <path d="M0 284 C 300 278 520 288 760 284 S 1180 278 1440 284" fill="none" stroke="#14b8a6" strokeOpacity="0.25" />
    </svg>
  )
}

/** Compact live chart of decision-time forecast vs actual, from real API data. */
export function HeroChart({ items }: { items: Period[] }) {
  const data = useMemo(
    () =>
      items.map((p) => ({
        t: new Date(p.start_time).getTime(),
        forecast: p.forecast_mw,
        actual: p.actual_mw,
        period: p,
      })),
    [items],
  )
  const Tip = ({ active, payload }: { active?: boolean; payload?: { payload: (typeof data)[number] }[] }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload.period
    return (
      <TooltipBox
        title={formatUkFull(p.start_time)}
        rows={[
          { label: 'Decision-time forecast', value: formatMW(p.forecast_mw), color: COLORS.forecast },
          { label: 'Actual', value: p.actual_mw === null ? 'Not observed' : formatMW(p.actual_mw), color: COLORS.actual },
        ]}
      />
    )
  }
  return (
    <figure role="img" aria-label="Live chart of decision-time wind forecast versus actual generation for January 2026" className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 520, height: 224 }}>
        <ComposedChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="heroActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip content={<Tip />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
          <Area dataKey="actual" stroke="#60a5fa" strokeWidth={1.5} fill="url(#heroActual)" isAnimationActive={false} connectNulls={false} />
          <Line dataKey="forecast" stroke="#2dd4bf" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  )
}

/**
 * Explainer diagram of the decision-cutoff rule using WINDFOR's real publication
 * schedule (02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30, 22:30 UTC).
 */
export function CutoffTimeline() {
  const W = 960
  const x0 = 60
  const x1 = 900
  const hours = 24
  const toX = (h: number) => x0 + ((x1 - x0) * h) / hours
  const cutoff = 10
  const publications = [2.5, 4.5, 7.5, 9.5, 11.5, 15.5, 18.5, 22.5]
  const selected = Math.max(...publications.filter((p) => p <= cutoff))
  const label = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`

  return (
    <svg
      viewBox={`0 0 ${W} 252`}
      role="img"
      aria-label="Timeline of forecast publications on the day before delivery. Forecasts published up to the 10:00 cutoff are eligible and the 09:30 publication is selected; later publications are excluded."
      className="h-auto w-full"
    >
      <text x={x0} y={24} fill="#0f172a" fontSize={14} fontWeight={600}>
        Decision day (D-1), UK time
      </text>
      <text x={x1} y={24} fill="#64748b" fontSize={12} textAnchor="end">
        WINDFOR publications
      </text>
      {/* eligible window */}
      <rect x={x0} y={70} width={toX(cutoff) - x0} height={60} rx={8} fill="#ccfbf1" opacity={0.6} />
      <rect x={toX(cutoff)} y={70} width={x1 - toX(cutoff)} height={60} rx={8} fill="#f1f5f9" />
      <text x={x0 + 12} y={92} fill="#0f766e" fontSize={12} fontWeight={600}>
        Eligible: published on or before the cutoff
      </text>
      <text x={x1 - 12} y={92} fill="#64748b" fontSize={12} textAnchor="end">
        Excluded: hindsight, not available to buyers
      </text>
      {/* axis */}
      <line x1={x0} x2={x1} y1={150} y2={150} stroke="#cbd5e1" strokeWidth={2} />
      {[0, 6, 12, 18, 24].map((h) => (
        <g key={h}>
          <line x1={toX(h)} x2={toX(h)} y1={146} y2={154} stroke="#94a3b8" />
          <text x={toX(h)} y={172} fill="#64748b" fontSize={11} textAnchor="middle">
            {label(h % 24)}
            {h === 24 ? ' (D)' : ''}
          </text>
        </g>
      ))}
      {/* publications */}
      {publications.map((p) => {
        const eligible = p <= cutoff
        const isSelected = p === selected
        return (
          <g key={p}>
            <line x1={toX(p)} x2={toX(p)} y1={118} y2={150} stroke={eligible ? '#0d9488' : '#cbd5e1'} strokeDasharray={eligible ? undefined : '3 3'} />
            {isSelected && <circle cx={toX(p)} cy={118} r={13} fill="none" stroke="#0d9488" strokeWidth={2} opacity={0.35} />}
            <circle cx={toX(p)} cy={118} r={7} fill={eligible ? '#0d9488' : '#fff'} stroke={eligible ? '#0d9488' : '#94a3b8'} strokeWidth={2} />
            <text x={toX(p)} y={196} fill={eligible ? '#0f172a' : '#94a3b8'} fontSize={11} textAnchor="middle" fontWeight={isSelected ? 700 : 400}>
              {label(p)}
            </text>
          </g>
        )
      })}
      {/* cutoff */}
      <line x1={toX(cutoff)} x2={toX(cutoff)} y1={52} y2={210} stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" />
      <rect x={toX(cutoff) - 58} y={36} width={116} height={22} rx={11} fill="#dc2626" />
      <text x={toX(cutoff)} y={51} fill="#fff" fontSize={12} fontWeight={600} textAnchor="middle">
        Cutoff 10:00
      </text>
      <g>
        <rect x={toX(selected) - 120} y={214} width={240} height={28} rx={14} fill="#0f172a" />
        <text x={toX(selected)} y={232} fill="#5eead4" fontSize={12} fontWeight={600} textAnchor="middle">
          ✓ Selected: latest eligible (09:30)
        </text>
      </g>
    </svg>
  )
}
