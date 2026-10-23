import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  Filter,
  Gauge,
  GitMerge,
  HeartPulse,
  LayoutDashboard,
  LineChart,
  Scale,
  Server,
  ShieldCheck,
  Sigma,
  Wind,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { CutoffTimeline, HeroChart, WindFarm } from '@/components/landing/visuals'
import { Logo } from '@/components/layout/Sidebar'
import { Skeleton } from '@/components/ui/feedback'
import { useAccuracySummary, useTimeseries } from '@/hooks/queries'
import { useAnalysisFilters } from '@/hooks/useAnalysisFilters'
import { useSmoothScroll } from '@/hooks/useMotion'
import { cn } from '@/utils/cn'
import { formatMW, formatNumber, formatPct } from '@/utils/format'

const DASHBOARD_PATH = '/overview'

function PrimaryCta({ children = 'Enter dashboard', className }: { children?: ReactNode; className?: string }) {
  return (
    <Link
      to={DASHBOARD_PATH}
      className={cn(
        'inline-flex items-center gap-2 rounded-md bg-brand-500 px-5 py-3 text-sm font-semibold text-navy-950 shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        className,
      )}
    >
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  )
}

function SectionHeading({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-brand-600 uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {title}
      </h2>
      {children && <p className="mt-3 text-base leading-relaxed text-slate-600">{children}</p>}
    </div>
  )
}

function LiveStat({ label, value, hint, loading }: { label: string; value: string; hint: string; loading: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd className="mt-1 text-lg font-semibold whitespace-nowrap text-white tabular">{loading ? <Skeleton className="h-6 w-20 bg-white/10" /> : value}</dd>
      <dd className="text-[11px] text-slate-500">{hint}</dd>
    </div>
  )
}

const PROBLEMS = [
  {
    icon: Clock3,
    title: 'Buy a day ahead',
    body: 'Day-ahead purchases for tomorrow are locked in the morning before delivery, long before the wind actually blows.',
  },
  {
    icon: Wind,
    title: 'Wind is uncertain',
    body: 'Every megawatt of wind that fails to appear has to be replaced by thermal or other generation at short notice.',
  },
  {
    icon: ShieldCheck,
    title: 'Avoid hindsight',
    body: 'Judging forecasts with versions published after the decision flatters accuracy. WindScope only uses what existed at the cutoff.',
  },
]

const PIPELINE = [
  { icon: Cloud, label: 'Elexon BMRS', detail: 'FUELHH · WINDFOR' },
  { icon: Server, label: 'Ingestion', detail: 'Chunked, retried' },
  { icon: Filter, label: 'Validation', detail: 'UTC, WIND, dedupe' },
  { icon: Clock3, label: 'Vintage selection', detail: 'publishTime ≤ cutoff' },
  { icon: GitMerge, label: 'Matching', detail: 'Identical startTime' },
  { icon: Sigma, label: 'Metrics', detail: 'MAE · RMSE · bias' },
  { icon: LayoutDashboard, label: 'Dashboard', detail: 'FastAPI → React' },
]

const FEATURES = [
  { to: '/overview', icon: LayoutDashboard, title: 'Overview', body: 'Decision-time forecast, actual outturn, error, MAE, RMSE and coverage at a glance.' },
  { to: '/forecast-analysis', icon: LineChart, title: 'Forecast Analysis', body: 'Inspect every forecast vintage for a period and see exactly why one was selected.' },
  { to: '/forecast-accuracy', icon: Gauge, title: 'Forecast Accuracy', body: 'Nine interactive views: distributions, scatter, daily MAE, hour-of-day, bias and coverage.' },
  { to: '/historical-data', icon: Database, title: 'Historical Data', body: 'Search, sort and export raw FUELHH and WINDFOR records; import validated CSVs.' },
  { to: '/data-health', icon: HeartPulse, title: 'Data Health', body: 'Freshness, completeness, duplicates, retries and refresh history with explicit rules.' },
  { to: '/methodology', icon: BookOpen, title: 'Methodology', body: 'Formulas, timezone handling, the cutoff assumption and procurement limitations.' },
]

/** Every landing section fills at least one viewport and centres its content. */
const SCREEN = 'flex min-h-[100svh] flex-col justify-center'

export default function Landing() {
  useSmoothScroll()
  const { query, ready } = useAnalysisFilters()
  const summary = useAccuracySummary(query, ready)
  const series = useTimeseries(query, ready)
  const m = summary.data?.metrics
  const coverage = summary.data?.coverage
  const loading = summary.isLoading || !ready
  const live = !summary.isError && (m?.count ?? 0) > 0

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* ------------------------------------------------------------------ hero */}
      <header className={cn('relative overflow-hidden bg-navy-950 text-white', SCREEN, 'justify-start')}>
        <div aria-hidden className="landing-grid absolute inset-0 opacity-60" />
        <div aria-hidden className="absolute -top-40 right-0 h-[480px] w-[480px] rounded-full bg-brand-500/15 blur-3xl" />

        <nav aria-label="Landing" className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
          <Logo />
          <div className="flex items-center gap-6 text-sm">
            <a href="#how-it-works" className="hidden text-slate-300 hover:text-white sm:inline">
              How it works
            </a>
            <a href="#features" className="hidden text-slate-300 hover:text-white sm:inline">
              Features
            </a>
            <Link to="/methodology" className="hidden text-slate-300 hover:text-white md:inline">
              Methodology
            </Link>
            <Link
              to={DASHBOARD_PATH}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 font-medium text-white hover:bg-white/10"
            >
              Open dashboard <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </nav>

        <div
          id="main-content"
          className="relative mx-auto grid w-full max-w-7xl flex-1 content-center gap-12 px-6 pt-6 pb-4 lg:grid-cols-[1.05fr_1fr] lg:items-center"
        >
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-100">
              <Wind aria-hidden className="size-3.5" /> GB day-ahead procurement · January 2026 pilot
            </p>
            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
              Know the wind you could <span className="text-brand-500">actually count on</span>, when you had to buy.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
              WindScope reconstructs the national wind forecast that was available at your day-ahead decision cutoff, then measures how far it
              missed the real outturn, so every purchase can account for quantified uncertainty.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PrimaryCta />
              <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/5">
                See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
              {['Elexon FUELHH + WINDFOR only', '30-minute settlement periods', 'No hindsight in evaluation'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 aria-hidden className="size-3.5 text-brand-500" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* live preview card */}
          <section
            aria-label="Live January 2026 results"
            className="rounded-xl border border-white/10 bg-navy-900/80 p-5 shadow-2xl shadow-black/40 backdrop-blur"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Decision-time forecast vs actual</p>
                <p className="text-xs text-slate-400">GB wind · delivery 2 Jan – 1 Feb 2026 · cutoff 10:00 D-1</p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  live ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-slate-400',
                )}
              >
                <span aria-hidden className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-emerald-400' : 'bg-slate-500')} />
                {live ? 'Live API data' : summary.isError ? 'API unavailable' : 'Loading'}
              </span>
            </div>

            <div className="mt-4">
              {series.isLoading || !ready ? (
                <Skeleton className="h-56 w-full bg-white/5" />
              ) : series.isError || !series.data?.items.length ? (
                <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 text-center text-sm text-slate-400">
                  <Activity aria-hidden className="size-5" />
                  Live chart appears once the API has loaded Elexon data.
                </div>
              ) : (
                <HeroChart items={series.data.items} />
              )}
              <div className="mt-2 flex gap-4 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded bg-[#2dd4bf]" /> Forecast at cutoff
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-4 rounded bg-[#60a5fa]" /> Actual outturn
                </span>
              </div>
            </div>

            {summary.isError ? (
              <p className="mt-4 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-400">
                Live metrics are unavailable right now. Enter the dashboard to retry or check Data Health.
              </p>
            ) : (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <LiveStat label="MAE" value={formatMW(m?.mae_mw)} hint="mean |error|" loading={loading} />
                <LiveStat label="Bias" value={formatMW(m?.bias_mw, { signed: true })} hint="+ = over-forecast" loading={loading} />
                <LiveStat label="Over-forecast" value={formatPct(m?.overestimation_pct)} hint="of matched hours" loading={loading} />
                <LiveStat label="Coverage" value={formatPct(coverage?.forecast_coverage_pct)} hint={`${formatNumber(coverage?.matched)} matched`} loading={loading} />
              </dl>
            )}
          </section>
        </div>
        <WindFarm className="pointer-events-none relative z-0 -mt-6 h-[190px] w-full shrink-0 sm:h-[230px] lg:h-[280px]" />
      </header>

      <main>
        {/* ---------------------------------------------------------- problem */}
        <section aria-labelledby="problem-title" className={cn('mx-auto max-w-7xl px-6 py-20', SCREEN)}>
          <SectionHeading id="problem-title" eyebrow="The procurement problem" title="How much power do we still need to buy?">
            To cover demand, the team buys whatever renewables will not supply. That depends on a wind forecast, and on knowing how wrong such
            forecasts tend to be.
          </SectionHeading>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon aria-hidden className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------- how it works */}
        <section id="how-it-works" aria-labelledby="how-title" className={cn('border-y border-slate-200 bg-slate-50 py-20', SCREEN)}>
          <div className="mx-auto w-full max-w-7xl px-6">
            <SectionHeading id="how-title" eyebrow="How it works" title="One rule: only forecasts published before the cutoff count">
              For each half-hour target period, WindScope keeps the forecast vintages published on or before the decision cutoff and selects the
              latest of them. Anything published later is excluded from evaluation.
            </SectionHeading>
            <div className="mx-auto mt-10 max-w-5xl rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-6">
              <CutoffTimeline />
              <p className="mt-2 text-center text-xs text-slate-500">
                Publication times follow Elexon's WINDFOR schedule (UTC, equal to UK time in January). The 10:00 cutoff is a configurable analysis
                assumption, not an Elexon rule.
              </p>
            </div>

            <div className="mx-auto mt-14 max-w-6xl">
              <p className="text-center text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">Data pipeline</p>
              <ol className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {PIPELINE.map(({ icon: Icon, label, detail }, i) => (
                  <li key={label} className="relative">
                    <div className="h-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-center shadow-xs">
                      <span className="mx-auto inline-flex size-8 items-center justify-center rounded-md bg-navy-900 text-brand-500">
                        <Icon aria-hidden className="size-4" />
                      </span>
                      <p className="mt-2 text-xs font-semibold text-slate-900">{label}</p>
                      <p className="text-[11px] text-slate-500">{detail}</p>
                    </div>
                    {i < PIPELINE.length - 1 && (
                      <ArrowRight aria-hidden className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 text-slate-400 lg:block" />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- metrics */}
        <section aria-labelledby="metrics-title" className={cn('mx-auto max-w-7xl px-6 py-20', SCREEN)}>
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-semibold tracking-[0.18em] text-brand-600 uppercase">Quantified error</p>
              <h2 id="metrics-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Measured on real outcomes, reported honestly
              </h2>
              <p className="mt-3 leading-relaxed text-slate-600">
                Error is <code className="rounded bg-slate-100 px-1 text-sm">forecast − actual</code>. A positive value means wind was over-forecast,
                so more replacement power was needed than planned. Metrics use matched periods only; missing data stays missing and is reported.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-700">
                {[
                  ['MAE and RMSE', 'typical and large-miss error in MW'],
                  ['Bias', 'systematic over- or under-forecasting'],
                  ['MAPE and WAPE', 'percentage error, with zero-actual exclusions counted'],
                  ['Distributions', 'by hour of day, by delivery day and largest misses'],
                ].map(([title, body]) => (
                  <li key={title} className="flex gap-3">
                    <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    <span>
                      <strong className="font-semibold text-slate-900">{title}</strong>: {body}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">January 2026 decisions · 10:00 D-1 cutoff</p>
                <Scale aria-hidden className="size-4 text-slate-400" />
              </div>
              {summary.isError ? (
                <p className="mt-6 text-sm text-slate-500">Results load from the live API. It is unavailable at the moment.</p>
              ) : (
                <dl className="mt-5 grid grid-cols-2 gap-4">
                  {(
                    [
                      ['Matched hourly periods', formatNumber(m?.count)],
                      ['Mean absolute error', formatMW(m?.mae_mw)],
                      ['RMSE', formatMW(m?.rmse_mw)],
                      ['Mean error (bias)', formatMW(m?.bias_mw, { signed: true })],
                      ['WAPE', formatPct(m?.wape_pct)],
                      ['Largest miss', formatMW(m?.max_abs_error_mw)],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-1 text-lg font-semibold text-slate-900 tabular">{loading ? <Skeleton className="h-6 w-24" /> : value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {m && m.count > 0 && (
                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                  80% of matched hours had errors between {formatMW(m.error_p10_mw, { signed: true })} and {formatMW(m.error_p90_mw, { signed: true })}.
                  This is a descriptive historical range, not a guaranteed interval.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- features */}
        <section id="features" aria-labelledby="features-title" className={cn('border-t border-slate-200 bg-slate-50 py-20', SCREEN)}>
          <div className="mx-auto w-full max-w-7xl px-6">
            <SectionHeading id="features-title" eyebrow="Inside the dashboard" title="Six views, one consistent analysis">
              Change the date range or decision cutoff once and every chart, table and export follows.
            </SectionHeading>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ to, icon: Icon, title, body }) => (
                <Link
                  key={to}
                  to={to}
                  className="group rounded-xl border border-slate-200 bg-white p-6 shadow-xs transition-colors hover:border-brand-500/60 hover:bg-brand-50/30"
                >
                  <span className="inline-flex size-10 items-center justify-center rounded-lg bg-navy-900 text-brand-500">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <h3 className="mt-4 flex items-center gap-1.5 text-base font-semibold text-slate-900">
                    {title}
                    <ArrowRight aria-hidden className="size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- closing: CTA + limitations */}
        <section aria-labelledby="cta-title" className={cn('relative overflow-hidden bg-navy-950 text-white', SCREEN, 'justify-between')}>
          <div aria-hidden className="landing-grid absolute inset-0 opacity-40" />
          <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-16 px-6 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 id="cta-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                See the forecast your team really had
              </h2>
              <p className="mt-3 text-slate-300">Explore every settlement period, every forecast vintage and every error, for January 2026.</p>
              <div className="mt-8 flex justify-center">
                <PrimaryCta>Enter the dashboard</PrimaryCta>
              </div>
            </div>
            <aside aria-labelledby="limits-title" className="flex gap-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-6">
              <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-400" />
              <div>
                <h3 id="limits-title" className="text-base font-semibold text-amber-200">
                  What this analysis does not tell you
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-amber-100/80">
                  Wind alone cannot set the exact volume to procure: the permitted data has no demand, prices or other generation. Historical error
                  describes the past; it is not a guaranteed interval and does not translate directly into financial loss.
                </p>
              </div>
            </aside>
          </div>
          <footer className="relative border-t border-white/5 text-slate-500">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-xs">
              <Logo compact />
              <p>Data: Elexon BMRS FUELHH (fuelType WIND) and WINDFOR · GB national wind · times in UK local time</p>
              <Link to="/methodology" className="hover:text-slate-300">
                Methodology &amp; limitations
              </Link>
            </div>
          </footer>
        </section>
      </main>
    </div>
  )
}
