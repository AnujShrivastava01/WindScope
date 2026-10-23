import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { PageHeader } from '@/components/layout/AppLayout'
import { StatusBadge } from '@/components/tables/periodColumns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useMeta } from '@/hooks/queries'

const PIPELINE = [
  'Elexon API',
  'Ingestion',
  'Normalisation',
  'Validation',
  'Forecast selection',
  'Actual/forecast matching',
  'Accuracy metrics',
  'FastAPI',
  'React dashboard',
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} titleId={id} />
      <CardContent className="space-y-3 text-sm leading-relaxed text-slate-700">{children}</CardContent>
    </Card>
  )
}

function Formula({ name, expr, note }: { name: string; expr: string; note?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold text-slate-900">{name}</p>
      <code className="mt-0.5 block font-mono text-[13px] text-slate-800">{expr}</code>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default function Methodology() {
  const meta = useMeta()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Methodology"
        description="How WindScope selects the forecast that was available at decision time, measures its accuracy, and where the analysis stops."
      />

      <Section id="architecture" title="Architecture">
        <ol aria-label="Data pipeline" className="flex flex-wrap items-center gap-2">
          {PIPELINE.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-md border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700">{step}</span>
              {i < PIPELINE.length - 1 && <ArrowRight aria-hidden className="size-4 text-slate-400" />}
            </li>
          ))}
        </ol>
        <p>
          A FastAPI service fetches the two permitted Elexon datasets, validates and normalises them into a SQLite store with unique keys, applies the
          vintage-selection rule, and serves aggregated results. The React dashboard only renders backend responses; no metric is computed or hard-coded
          in the browser.
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section id="datasets" title="Elexon datasets and filtering">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>FUELHH</strong> (<code>/datasets/FUELHH/stream</code>): half-hourly generation outturn by fuel type, average MW per settlement
              period. Only <code>fuelType = WIND</code> is kept; fields used: <code>startTime</code>, <code>generation</code>.
            </li>
            <li>
              <strong>WINDFOR</strong> (<code>/datasets/WINDFOR/stream</code>): national wind generation forecasts. Fields used: <code>startTime</code>{' '}
              (target), <code>publishTime</code> (vintage) and <code>generation</code> (MW). WINDFOR targets are hourly and are published several times
              a day.
            </li>
            <li>No demand, price, weather or other generation datasets are used.</li>
            <li>
              Rows with missing/invalid timestamps, non-numeric or negative generation, or (for WINDFOR) no publish time are rejected and counted on the
              Data Health page.
            </li>
          </ul>
        </Section>

        <Section id="time" title="Timezone normalisation">
          <p>
            Every timestamp is stored and compared as a timezone-aware UTC instant. UK local time (Europe/London) is used for three things only:
            defining delivery days (local midnight to midnight, so clock-change days have 46 or 50 settlement periods), expressing the decision cutoff,
            and display.
          </p>
          <p>January 2026 is entirely in GMT (UTC+0), but the logic is daylight-saving aware and tested for BST and clock-change days.</p>
        </Section>
      </div>

      <Section id="cutoff" title="Day-ahead cutoff assumption and forecast-vintage selection">
        <p>
          The challenge does not fix a cutoff hour. WindScope assumes purchase decisions for delivery day <em>D</em> are made by{' '}
          <strong>
            {meta.data?.default_cutoff_time ?? '10:00'} UK time on D-{meta.data?.default_cutoff_days_before ?? 1}
          </strong>
          , roughly in line with GB day-ahead auction timing. <strong>This is a configurable analysis assumption, not an official Elexon rule</strong>,
          and every page lets you change it.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Identify the target settlement period start time and its UK delivery day D.</li>
          <li>The decision date is D-n; the cutoff is the configured local time on that date, converted to UTC.</li>
          <li>Collect every WINDFOR vintage for exactly that target start time.</li>
          <li>
            Keep vintages with <code>publishTime ≤ cutoff</code> (a forecast published exactly at the cutoff is eligible).
          </li>
          <li>Select the eligible vintage with the latest publish time. Identical duplicates are resolved deterministically.</li>
          <li>Join to the FUELHH actual with the identical start time — never by row order.</li>
          <li>Compute metrics only on periods where both values exist; track missing, late-only and unmatched periods separately.</li>
        </ol>
        <p>
          Forecasts published after the cutoff are <strong>never</strong> used for evaluation, even if they are more accurate or are the newest data
          stored. They are shown separately as “latest available (hindsight)” so the difference is visible.
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section id="metrics" title="Accuracy metrics">
          <p>
            Signed error per period: <code>error = forecast − actual</code> (MW). Positive = wind over-estimated; negative = under-estimated.
          </p>
          <div className="grid gap-2">
            <Formula name="Mean Absolute Error (MAE)" expr="mean(|error|)" />
            <Formula name="Root Mean Squared Error (RMSE)" expr="sqrt(mean(error²))" note="Weights large misses more heavily than MAE." />
            <Formula name="Mean Error (Bias)" expr="mean(error)" />
            <Formula
              name="Mean Absolute Percentage Error (MAPE)"
              expr="mean(|error| / |actual|) × 100, actual ≠ 0"
              note="Zero-actual periods are excluded and counted. MAPE becomes unstable when actual wind output is very small."
            />
            <Formula
              name="Weighted Absolute Percentage Error (WAPE)"
              expr="Σ|error| / Σ|actual| × 100"
              note="Reported separately from MAPE; robust to individual low-output periods."
            />
          </div>
          <p>Also reported: max |error|, error percentiles, over/under-estimation shares, daily and hour-of-day breakdowns, correlation.</p>
        </Section>

        <Section id="missing" title="Missing data, coverage and imports">
          <ul className="space-y-2">
            {(meta.data?.statuses ?? []).map((s) => (
              <li key={s.status} className="flex items-start gap-2">
                <StatusBadge status={s.status} />
                <span className="text-xs text-slate-600">{s.description}</span>
              </li>
            ))}
          </ul>
          <p>
            Missing actuals remain blank — never zero. Forecast coverage = hourly targets with a decision-time forecast ÷ hourly targets. Half-hour
            periods have no WINDFOR target and are excluded from accuracy metrics.
          </p>
          <p>
            If the API cannot supply history, CSV files for FUELHH or WINDFOR can be imported. Rows are validated individually and rejections are
            explained; imported rows are labelled as such and never overwrite Elexon API values.
          </p>
        </Section>
      </div>

      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader title="Procurement limitations — read before using these numbers" titleId="limitations" />
        <CardContent>
          <ul className="space-y-2 text-sm leading-relaxed text-amber-950">
            {[
              'Wind generation alone cannot determine the precise additional electricity to procure. The permitted datasets contain no consumer demand, no market prices and no complete picture of other generation sources.',
              'Historical forecast error is descriptive. It is not a guaranteed forecast interval and does not directly represent financial losses or imbalance costs.',
              'Any empirical error range shown (e.g. 10th–90th percentile) describes January 2026 only and may not hold in other seasons or weather regimes.',
              'FUELHH reports metered transmission-connected output. Differences such as curtailment, constraint actions and embedded generation may contribute to systematic bias between WINDFOR and FUELHH; WindScope does not adjust for them.',
              'The decision cutoff is an assumption. Results change with the cutoff; compare several cutoffs before drawing conclusions.',
              'The sample covers one month (≈744 hourly forecast targets). Treat daily and hourly breakdowns as indicative.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {meta.data && (
        <Section id="assumptions" title="Assumptions reported by the API">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {meta.data.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            API documentation is available at <code>/api/docs</code>. Service version {meta.data.version}.
          </p>
        </Section>
      )}
    </div>
  )
}
