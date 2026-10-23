# WindScope: Renewable Generation Intelligence

WindScope is a web application for a UK electricity utility's **day-ahead power procurement team**. It answers two questions:

1. **Which wind generation forecast was actually available when the day-ahead purchase decision had to be made?**
2. **How accurate was that forecast compared with the wind generation that was later recorded?**

The scope is GB national wind generation for purchase decisions made between **1 and 31 January 2026** (delivery days 2 January to 1 February 2026). WindScope uses only Elexon BMRS **FUELHH** (actuals, `fuelType = WIND`) and **WINDFOR** (forecasts).

> **Live application:** https://windscope-vert.vercel.app (landing page; the dashboard is at [`/overview`](https://windscope-vert.vercel.app/overview))
> **Live API:** https://windscope-api.onrender.com ([health](https://windscope-api.onrender.com/api/health) · [docs](https://windscope-api.onrender.com/api/docs))
>
> The API runs on Render's free plan and sleeps after about 15 minutes idle; the first request can take up to a minute while it wakes and reloads the January data from Elexon.

---

## Contents

1. [Product overview](#1-product-overview)
2. [Business problem](#2-business-problem)
3. [Key features](#3-key-features)
4. [Technology stack](#4-technology-stack)
5. [Architecture](#5-architecture)
6. [Directory structure](#6-directory-structure)
7. [Elexon data sources](#7-elexon-data-sources)
8. [Data-processing methodology](#8-data-processing-methodology)
9. [Forecast-vintage selection algorithm](#9-forecast-vintage-selection-algorithm)
10. [Accuracy metric definitions](#10-accuracy-metric-definitions)
11. [Timezone and cutoff assumptions](#11-timezone-and-cutoff-assumptions)
12. [Data coverage and limitations](#12-data-coverage-and-limitations)
13. [Prerequisites](#13-prerequisites)
14. [Environment variables](#14-environment-variables)
15. [Local setup](#15-local-setup-without-docker)
16. [Docker](#16-docker)
17. [Tests](#17-tests)
18. [API documentation](#18-api-documentation)
19. [Deployment](#19-deployment)
20. [Troubleshooting](#20-troubleshooting)
21. [Deployment URL](#21-deployment-url)
22. [AI-tool usage disclosure](#22-ai-tool-usage-disclosure)
23. [Demo script (10 minutes)](#23-demo-script-10-minutes)

---

## 1. Product overview

WindScope opens on a **landing page** (`/`) that explains the problem and the cutoff rule with visuals: a live forecast-vs-actual preview and headline metrics from the API, a cutoff-timeline diagram, the data pipeline, an animated wind-farm hero, and Lenis smooth scrolling (disabled when the user prefers reduced motion). **Enter dashboard** leads to six analytics views (`/overview` and onwards):

| Page | Purpose |
|---|---|
| **Overview** | KPIs (latest eligible forecast, actual, error, MAE, RMSE, coverage), forecast-vs-actual chart, error chart and recent settlement periods. |
| **Forecast Analysis** | Per-period table showing the selected forecast vintage, plus a vintage inspector that explains *why* a vintage was chosen and which later ones were excluded. |
| **Forecast Accuracy** | Nine interactive charts (time series, signed error, error distribution, scatter, daily MAE, hour-of-day, daily bias, over/under-estimation, coverage) and the largest errors. |
| **Historical Data** | Searchable, sortable, paginated FUELHH and WINDFOR records with filtered CSV export and validated CSV import. |
| **Data Health** | Freshness, completeness, duplicates, rejected rows, retries, cache status, refresh history and January 2026 coverage. |
| **Methodology** | Plain-language explanation of the data, algorithm, formulas and procurement limitations. |

All figures come from backend API responses. Nothing is hard-coded, and missing observations stay missing; they are never shown as zero.

## 2. Business problem

The procurement team buys power on the day-ahead market for delivery tomorrow. To decide how much extra power to buy (for example, from thermal plant), they need to know how much wind generation to expect. Wind is weather-dependent, so they rely on forecasts. Good decisions need two things:

* **The right forecast.** That means the latest forecast that existed *at decision time*. Later forecasts are more accurate but were not available, so using them in a historical evaluation hides real uncertainty (hindsight bias).
* **Quantified error.** That means how far, how often and in which direction those forecasts missed.

WindScope reconstructs the decision-time forecast for every settlement period and measures its error against the actual outturn.

## 3. Key features

* **Decision-time forecast selection** with a configurable cutoff (default 10:00 UK time on D-1), an inclusive `publishTime ≤ cutoff` rule, and DST-correct handling.
* **Transparent vintage inspection** showing every forecast published for a target period, which were eligible, which one was selected, and which were excluded as late. The latest available (hindsight) value is shown for contrast only.
* **Accuracy analytics**: MAE, RMSE, bias, MAPE (with excluded-period count), WAPE, max error, percentiles, over/under-estimation shares, daily and hour-of-day breakdowns, and a descriptive empirical error range.
* **Honest data handling**: separate statuses for matched, missing actual, missing forecast, late-only forecast and half-hour non-target periods. Coverage and staleness follow explicit rules.
* **Resilient ingestion**: chunked requests, bounded retries with backoff, `Retry-After` support, malformed-response handling, idempotent upserts and an audit log of every refresh.
* **CSV import and export**: import validates columns and individual rows and reports rejected rows; export returns exactly the filtered data with UTC and UK timestamps, units and publish times.
* **Engineering quality**: typed API (OpenAPI docs), 78 backend tests, 29 frontend tests, Ruff and ESLint, GitHub Actions CI, Docker Compose stack.

## 4. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, accessible in-house UI primitives (shadcn-style, Radix Dialog), Recharts, React Router, TanStack Query, Lucide icons, Sonner notifications, Lenis smooth scroll (landing page) |
| Backend | Python 3.12, FastAPI, Pydantic v2, httpx, pandas, NumPy |
| Storage | SQLite (stdlib `sqlite3`) with versioned migrations, unique keys and indexes |
| Testing / quality | pytest, Ruff, Vitest, React Testing Library, axe-core, ESLint, TypeScript strict mode |
| Infrastructure | Docker, Docker Compose, nginx, GitHub Actions; Vercel (frontend) plus Render/Heroku (API) configs |

**Why SQLite and not PostgreSQL?** The dataset is small: about 1,500 actual rows and 20,000 forecast rows for the January window. SQLite still gives uniqueness constraints, indexes, idempotent upserts and persistent refresh metadata, with zero extra services to run. The repository layer is isolated, so switching to PostgreSQL later would be contained.

## 5. Architecture

```
┌────────────┐   ┌───────────┐   ┌───────────────┐   ┌────────────┐   ┌────────────────────┐
│ Elexon API │──▶│ Ingestion │──▶│ Normalisation │──▶│ Validation │──▶│ Forecast selection │
│ FUELHH     │   │ (httpx,   │   │ (UTC, WIND    │   │ (rejects,  │   │ (publishTime ≤     │
│ WINDFOR    │   │  retries) │   │  filter)      │   │  dedupe)   │   │  cutoff, latest)   │
└────────────┘   └───────────┘   └───────────────┘   └─────┬──────┘   └─────────┬──────────┘
                                                           │ SQLite store       │
                                                           ▼                    ▼
┌─────────────────┐   ┌──────────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│ React dashboard │◀──│ FastAPI (JSON + CSV) │◀──│ Accuracy metrics │◀──│ Actual / forecast  │
│ (TanStack Query)│   │ OpenAPI /api/docs    │   │ (pandas, NumPy)  │   │ matching on        │
└─────────────────┘   └──────────────────────┘   └──────────────────┘   │ identical startTime│
                                                                        └────────────────────┘
```

* **Domain logic is pure and separate from HTTP.** `forecast_selection.py` and `accuracy_metrics.py` take DataFrames and return DataFrames or dicts, and are unit-tested in isolation.
* **Caching**: data is persisted once, so historical records are not downloaded again. Analysis results are memoised per (date range, cutoff, data version), and any write bumps the data version, which invalidates the cache automatically. Concurrent refresh requests are deduplicated behind a lock.
* **Frontend**: filters live in the URL, so views are shareable and every page agrees. TanStack Query caches responses, and filtering, sorting, pagination and aggregation run on the server.

## 6. Directory structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py                    # App factory, middleware, startup ingestion
│   │   ├── api/
│   │   │   ├── deps.py                # Container, query-parameter parsing/validation
│   │   │   └── routes/                # analysis.py, records.py, system.py
│   │   ├── core/                      # config.py, logging.py (JSON), errors.py
│   │   ├── schemas/responses.py       # Pydantic response models (OpenAPI)
│   │   ├── services/
│   │   │   ├── elexon_client.py       # HTTP client: chunking, retries, parsing
│   │   │   ├── actual_generation.py   # FUELHH parsing, WIND filter, dedupe
│   │   │   ├── wind_forecasts.py      # WINDFOR parsing, publishTime validation
│   │   │   ├── forecast_selection.py  # Cutoff policy, vintage selection, matching
│   │   │   ├── accuracy_metrics.py    # MAE, RMSE, bias, MAPE, WAPE, histograms
│   │   │   ├── data_quality.py        # Coverage and staleness rules
│   │   │   ├── analysis.py            # Pipeline orchestration + result cache
│   │   │   ├── ingestion.py           # Refresh orchestration, CSV import, audit log
│   │   │   └── csv_io.py              # CSV validation and export frames
│   │   ├── repositories/              # database.py (migrations), records.py
│   │   └── utils/                     # time.py (UTC/UK helpers), numbers.py
│   ├── tests/                         # pytest suites (synthetic fixtures)
│   ├── requirements.txt / requirements-dev.txt / requirements.lock
│   ├── pyproject.toml                 # Ruff + pytest config
│   ├── Dockerfile, Procfile, .python-version
├── frontend/
│   ├── src/
│   │   ├── app/                       # App, routes, error boundary
│   │   ├── components/
│   │   │   ├── layout/                # Sidebar, Header, AppLayout
│   │   │   ├── charts/                # Time-series, accuracy, vintage charts
│   │   │   ├── landing/               # Wind-farm hero, live preview chart, cutoff timeline
│   │   │   ├── kpi/  tables/  filters/  ui/
│   │   ├── pages/                     # Landing, Overview, ForecastAnalysis, ForecastAccuracy,
│   │   │                              # HistoricalData, DataHealth, Methodology
│   │   ├── services/api.ts            # Typed API client
│   │   ├── hooks/                     # Query hooks, URL-synced filters
│   │   ├── types/api.ts               # API response types
│   │   ├── utils/                     # Formatting, status metadata
│   │   └── test/                      # Vitest suites + synthetic fixtures
│   ├── Dockerfile, nginx.conf, vercel.json, vite.config.ts
├── .github/workflows/ci.yml           # Lint, typecheck, tests, build, docker build
├── docker-compose.yml
├── render.yaml                        # Render blueprint for the API
└── .env.example
```

## 7. Elexon data sources

| Dataset | Endpoint | Request | Fields used |
|---|---|---|---|
| FUELHH | `GET https://data.elexon.co.uk/bmrs/api/v1/datasets/FUELHH/stream` | `settlementDateFrom`, `settlementDateTo` (UK settlement dates), `fuelType=WIND` | `startTime`, `generation` (+ `settlementDate`, `settlementPeriod`, `publishTime` for traceability) |
| WINDFOR | `GET https://data.elexon.co.uk/bmrs/api/v1/datasets/WINDFOR/stream` | `publishDateTimeFrom`, `publishDateTimeTo` | `startTime`, `publishTime`, `generation` |

Facts verified against the live API while building this:

* Both `/stream` endpoints return a plain JSON array with no pagination. WindScope splits requests into 7-day chunks and also accepts the `{"data": [...]}` shape used by the non-stream endpoints.
* FUELHH WIND: 48 half-hourly rows per settlement day (46 or 50 on clock-change days). Values are average MW over the period.
* WINDFOR: **hourly** target times, published 8 times a day (02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30 and 22:30 UTC), each covering roughly D-1 21:00 to D+2 21:00.
* The API is public and needs no API key.

**Ingestion window**: FUELHH settlement dates from 2 January to 2 February 2026, and WINDFOR publish times from 30 December 2025 to 3 February 2026. Forecasts published *after* the cutoffs are ingested too, so they can be shown as excluded.

## 8. Data-processing methodology

1. **Fetch** both datasets in chunks with explicit timeouts (30 s), up to 3 retries with exponential backoff for timeouts, connection errors, HTTP 429 and 5xx, and `Retry-After` honoured. A failed chunk is reported, and the other chunks are still stored.
2. **Normalise**: parse timestamps to timezone-aware UTC (`Z` or offset; naive values are treated as UTC), keep `fuelType == WIND` (case-insensitive), and coerce generation to a float.
3. **Validate**: reject rows with a missing or invalid `startTime`, start times not aligned to a 30-minute boundary, missing, non-numeric, non-finite or negative generation, and (WINDFOR only) a missing `publishTime`. Each rejection is counted, with a reason.
4. **Deduplicate deterministically**: FUELHH by `startTime` (latest `publishTime` wins), and WINDFOR by `(startTime, publishTime)`. Conflicting duplicates are counted.
5. **Store idempotently** in SQLite, with primary keys on `startTime` and `(startTime, publishTime)`. Re-running a refresh changes nothing, and inserted, updated and unchanged counts are logged. Elexon API values take precedence over CSV imports.
6. **Analyse**: build the settlement-period grid for the selected UK delivery days, select decision-time forecasts, match them to actuals, then compute metrics.

## 9. Forecast-vintage selection algorithm

Implemented in [`backend/app/services/forecast_selection.py`](backend/app/services/forecast_selection.py). For each target settlement period `t` on UK delivery day `D`:

1. Determine the decision date `D − n` (default `n = 1`) and the **cutoff** `c = local(D − n, cutoff_time)`, converted to UTC.
2. Collect every WINDFOR vintage whose `startTime == t`.
3. Keep vintages with **`publishTime ≤ c`** (inclusive: a forecast published exactly at the cutoff is eligible).
4. **Select** the eligible vintage with the latest `publishTime`. Ties on an identical `(startTime, publishTime)` resolve deterministically: API source first, then the most recently ingested row, then the larger value.
5. **Match** the selected forecast to the FUELHH actual with the identical `startTime`. Matching uses timestamp values, never row order.
6. Compute metrics **only** on matched periods. Track these separately:
   * `missing_actual`: a forecast was selected but no actual is stored;
   * `missing_forecast` / `missing_both`: no WINDFOR vintage exists;
   * `late_forecast_only`: vintages exist, but every one was published after the cutoff;
   * `no_forecast_target`: a half-hour period (WINDFOR is hourly). Its actual is shown for context, but it is excluded from metrics and coverage.

Forecasts published after the cutoff are **never** used for evaluation, even when they are newer or more accurate. They are reported as the "latest available (hindsight)" value so analysts can see the difference.

Tests prove: the latest eligible vintage is selected; publishing exactly at the cutoff is included; publishing one second later is rejected; vintages for different targets are not confused; missing forecasts stay missing; matching is independent of row order; duplicates resolve identically whatever the input order; BST and clock-change days are handled correctly.

## 10. Accuracy metric definitions

Signed error: `error_mw = forecast_mw − actual_mw`. **Positive** means wind was **over-estimated** (less wind than expected, so more replacement power was needed). **Negative** means wind was **under-estimated**.

| Metric | Formula | Notes |
|---|---|---|
| MAE | `mean(|error|)` | MW |
| RMSE | `sqrt(mean(error²))` | MW; penalises large misses |
| Bias (mean error) | `mean(error)` | MW; systematic tendency |
| MAPE | `mean(|error| / |actual|) × 100` over periods with `actual ≠ 0` | Excluded periods are counted and reported. Unstable when actual output is small. |
| WAPE | `Σ|error| / Σ|actual| × 100` | Weighted absolute percentage error, reported separately from MAPE; undefined if `Σ|actual| = 0` |
| Max absolute error | `max(|error|)` | |
| Over/under-estimation % | share of matched periods with `error > 0` / `error < 0` | |
| Distribution | abs-error P50/P90/P95, signed-error P10/P90, standard deviation, histogram, correlation | P10–P90 is labelled *descriptive*, not a guaranteed interval |
| Coverage | forecast coverage = hourly targets with a decision-time forecast ÷ hourly targets; match rate = matched ÷ hourly targets; actual coverage = periods with an actual ÷ all periods | |

Empty datasets return `null` metrics, never zero. Pairs with non-finite values are dropped and counted.

**January 2026 result** (default 10:00 D-1 cutoff, as returned by the API): 744 matched hourly periods, MAE ≈ 1,996 MW, RMSE ≈ 2,499 MW, bias ≈ +1,728 MW, MAPE ≈ 21.4 %, WAPE ≈ 17.7 %, over-forecast in ≈ 84 % of periods, max |error| 6,857 MW. Coverage is 100 % for both datasets.

## 11. Timezone and cutoff assumptions

* All timestamps are stored and compared as **UTC**. **Europe/London** is used to define delivery days (local midnight to midnight), to express the cutoff, and for display. January 2026 is all GMT, but the code is DST-aware and tested for BST and the 46- and 50-period clock-change days.
* **Cutoff assumption:** the challenge does not specify a cutoff hour. WindScope defaults to **10:00 Europe/London on D-1**, a reasonable approximation of GB day-ahead auction timing. **This is an analysis assumption, not an official Elexon rule.** Analysts can change the cutoff time (any HH:MM through the API; common presets in the UI) and the day offset (D-1 or D-2) on every page. With the default, the 09:30 UTC WINDFOR publication is normally the one selected.

## 12. Data coverage and limitations

* For the default January window, every one of the 1,488 half-hourly actuals and 744 hourly forecast targets is present. The Data Health page re-checks this on every refresh and flags gaps if they appear.
* **Wind alone cannot determine the exact amount of extra power to procure.** The permitted datasets contain no consumer demand, no market prices and no complete picture of other generation.
* Historical forecast error is **descriptive**. It is not a guaranteed forecast interval and does not directly represent financial losses or imbalance costs.
* FUELHH is metered transmission-connected output. Curtailment, constraint actions and embedded generation may contribute to the systematic positive bias seen against WINDFOR; WindScope does not adjust for them.
* One month (744 hourly targets) is a small sample, so daily and hourly breakdowns are indicative.
* WINDFOR is hourly, so half-hour periods have no forecast target and are excluded from metrics rather than interpolated.

## 13. Prerequisites

* **Docker path:** Docker Desktop or Engine with Compose v2.
* **Manual path:** Python 3.12+ and Node.js 22+ (npm 10+).
* Outbound HTTPS access to `data.elexon.co.uk` (or import CSVs instead).

## 14. Environment variables

Copy `.env.example` to `.env` (optional; every variable has a default). No secrets are required.

| Variable | Default | Purpose |
|---|---|---|
| `ELEXON_BASE_URL` | `https://data.elexon.co.uk/bmrs/api/v1` | Elexon API base |
| `ELEXON_TIMEOUT_SECONDS` / `ELEXON_MAX_RETRIES` / `ELEXON_BACKOFF_SECONDS` / `ELEXON_CHUNK_DAYS` | `30` / `3` / `1.0` / `7` | Client resilience |
| `DATABASE_PATH` | `./data/windscope.db` | SQLite file (a volume in Docker) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Allowed browser origins (add your Vercel URL) |
| `CORS_ORIGIN_REGEX` | empty | e.g. `^https://.*\.vercel\.app$` for preview deployments |
| `DECISION_DATE_START` / `DECISION_DATE_END` | `2026-01-01` / `2026-01-31` | Decision window |
| `DEFAULT_CUTOFF_TIME` / `DEFAULT_CUTOFF_DAYS_BEFORE` | `10:00` / `1` | Default cutoff assumption |
| `AUTO_INGEST_ON_STARTUP` | `true` | Fetch from Elexon when the store is empty |
| `STALE_AFTER_HOURS` | `24` | Staleness threshold |
| `LOG_LEVEL`, `APP_ENV` | `INFO`, `development` | Logging / environment |
| `VITE_API_BASE_URL` (frontend, build time) | empty | API origin; empty means same-origin `/api` (Vite dev proxy or nginx) |

## 15. Local setup (without Docker)

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

On first start, the API fetches January 2026 data from Elexon in the background (about 5 seconds).

```bash
# Frontend (new terminal)
cd frontend
npm ci
npm run dev                        # http://localhost:5173 (proxies /api to :8000)
```

## 16. Docker

```bash
docker compose up --build
```

| URL | What |
|---|---|
| http://localhost:3000 | Landing page; the dashboard is at `/overview` (nginx serves the React build and proxies `/api` to the backend) |
| http://localhost:8000/api/health | Backend health check |
| http://localhost:8000/api/docs | Interactive OpenAPI documentation (also `/api/redoc`) |

The SQLite store is kept in the `windscope-data` named volume. Both services have health checks, and the frontend starts once the backend is healthy. To reset the data, run `docker compose down -v`.

## 17. Tests

```bash
# Backend: 78 tests, lint and format checks
cd backend && pytest && ruff check . && ruff format --check .

# Frontend: 29 tests, lint, type-check and build
cd frontend && npm test && npm run lint && npm run typecheck && npm run build
```

Backend tests cover Elexon parsing, WIND filtering, timestamp normalisation, duplicates, cutoff inclusivity, rejection of late vintages, timestamp matching, DST, every metric formula, zero actuals, missing observations, empty datasets, client retry and failure paths, CSV validation and export, API parameter validation, and refresh success, partial and failed reporting.

Frontend tests cover the landing page (live metrics, dashboard links, no invented numbers when the API is down, reduced-motion behaviour), loading, success, empty and error states, KPI and chart rendering, filter-to-query propagation, server-side sorting and pagination, CSV export parameters, and an axe-core accessibility check.

All test fixtures are synthetic and labelled as such. CI runs everything on each push (`.github/workflows/ci.yml`).

## 18. API documentation

Interactive docs are at `/api/docs`. Common query parameters: `start_date` and `end_date` (UK delivery dates, `YYYY-MM-DD`), `cutoff_time` (`HH:MM` UK), `cutoff_days_before` (`1` or `2`). The range is limited to 62 days.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness, DB status, record counts |
| GET | `/api/meta` | Defaults, decision window, statuses, assumptions |
| GET | `/api/overview` | KPIs, metrics, coverage, recent periods |
| GET | `/api/accuracy/summary` | Metrics, coverage, daily, by-hour, largest errors |
| GET | `/api/accuracy/timeseries` | Every period with forecast, actual, error, status |
| GET | `/api/accuracy/distribution` | Histograms, scatter, quantiles (`bins`) |
| GET | `/api/forecast-periods` | Paginated periods (`page`, `page_size`, `sort`, `order`, `status`) |
| GET | `/api/forecast-vintages` | All vintages for `target_time`, with the explanation |
| GET | `/api/actuals` | Paginated FUELHH records (`sort`, `order`, `source`, `search`) plus missing-period counts |
| GET | `/api/forecasts` | Paginated WINDFOR records (+ `publish_from`, `publish_to`) |
| GET | `/api/data-health` | Freshness, completeness, refresh history, cache |
| POST | `/api/data/refresh` | Fetch both datasets; returns `success`, `partial` or `failed` per dataset |
| POST | `/api/data/import` | Multipart `file` + `dataset=actual\|forecast`; validation report |
| GET | `/api/export/csv` | `dataset=analysis\|actuals\|forecasts` + the same filters; CSV download |

Errors use one shape, `{"error": {"code", "message", "details"}}`, with status 422 for validation errors, 400 for an invalid CSV, 413 for files that are too large, and 500 with a generic message (internal details are never returned).

## 19. Deployment

The deployment target is the **frontend on Vercel** and the **API on Render** (Docker), or on Heroku via the `Procfile`.

**Backend (Render)**

1. In Render, choose **New → Blueprint** and select this repository. `render.yaml` creates `windscope-api` from `backend/Dockerfile`, with its health check at `/api/health`.
2. Set `CORS_ORIGINS` to the Vercel URL (for example, `https://windscope.vercel.app`). `CORS_ORIGIN_REGEX` already allows `*.vercel.app` preview URLs.
3. The free plan has an ephemeral disk, so the API re-ingests from Elexon on each cold start (`AUTO_INGEST_ON_STARTUP=true`). Attach a disk at `/app/data` to keep the data between restarts.

*Heroku alternative:* `heroku create`, set `PROJECT_PATH=backend` with a subdirectory buildpack (or deploy the `backend/` folder), then `git push heroku main`. The `Procfile` honours `$PORT`.

**Frontend (Vercel)**

1. Import the repository in Vercel and set **Root Directory** to `frontend`. `vercel.json` sets up the Vite build and SPA rewrites.
2. Add the environment variable `VITE_API_BASE_URL=https://<your-api-host>`, then deploy.
3. Check that `https://<vercel-app>/` loads and that Data Health shows both datasets as healthy.

The CLI equivalent, after `vercel login`:

```bash
cd frontend
vercel --prod --build-env VITE_API_BASE_URL=https://<your-api-host>
```

**Status:** deployed and verified. The frontend is on Vercel (project `windscope`, `VITE_API_BASE_URL=https://windscope-api.onrender.com`), and the API is on Render, created from `render.yaml` with `CORS_ORIGINS=https://windscope-vert.vercel.app`. See [Deployment URL](#21-deployment-url) for what was checked.

## 20. Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard says "Loading historical data from Elexon…" | The first ingestion is running; it normally takes under a minute. Check the Data Health page or `GET /api/health`. |
| "Cannot reach the WindScope API" | The backend is not running, or `VITE_API_BASE_URL` points to the wrong host. In dev, run uvicorn on port 8000. |
| CORS errors in the browser | Add the frontend origin to `CORS_ORIGINS` (or use `CORS_ORIGIN_REGEX`). |
| Refresh shows **failed** or **partial** | Elexon is unreachable or returned errors. Existing data is untouched, and the error is in the refresh history. Retry later, or import CSVs on Historical Data. |
| Port 8000 or 3000 already in use | Stop the other process, or change the host ports in `docker-compose.yml`. |
| Start again with empty data | `docker compose down -v` (Docker), or delete `backend/data/windscope.db`. |

## 21. Deployment URL

| | URL |
|---|---|
| **Application (Vercel)** | https://windscope-vert.vercel.app |
| **Dashboard** | https://windscope-vert.vercel.app/overview |
| **API (Render)** | https://windscope-api.onrender.com |
| **API health** | https://windscope-api.onrender.com/api/health |
| **API docs** | https://windscope-api.onrender.com/api/docs |

Verified after deployment:

* `/api/health` reports `ok`, with 1,536 FUELHH and 20,440 WINDFOR records ingested from Elexon on startup.
* `/api/accuracy/summary` matches the local results: 744 matched periods, MAE about 1,996 MW, RMSE about 2,499 MW, bias about +1,728 MW, 100 % coverage.
* CORS allows the Vercel origin (including the preflight for `POST /api/data/refresh`) and does not grant access to other origins.
* In a browser, the landing page shows *Live API data*. Overview, Forecast Analysis (vintage explanation), Forecast Accuracy (9 charts), Historical Data (1,488 records), Data Health (*Healthy*, 100 % match rate) and Methodology all load without errors, and CSV export works.

**Free-tier note:** the Render service sleeps when idle. The first visit after a pause can take up to a minute; the frontend waits up to 90 s and then loads normally.

## 22. AI-tool usage disclosure

This project was built with the help of an AI coding assistant. It helped with scaffolding, implementation, test writing, documentation and checking results against the live Elexon API. Design decisions, the methodology and all reported results were reviewed in the running application, and every test result quoted here comes from actually running the suites.

## 23. Demo script (10 minutes)

**Part 1: customer overview (up to 5 min)**

1. *(0:00)* Start on the landing page: the live forecast-vs-actual preview and the cutoff timeline set up the story. The problem: each morning you buy tomorrow's power before you know how windy it will be. WindScope shows the wind forecast you actually had at that moment, and how wrong it tended to be.
2. *(0:45)* Click **Enter dashboard** to open the **Overview**: the January 2026 decision window and the 10:00 D-1 cutoff. Walk through the KPIs, then the forecast-vs-actual chart (zoom with the brush) and the error chart. Point out the large over-forecasts around 11–12 and 27–28 January.
3. *(2:00)* **Forecast Analysis**: choose a period, show the 12 eligible vintages, the selected 09:30 forecast and the later vintages excluded as hindsight. Change the cutoff to 08:00 and watch the selection change.
4. *(3:00)* **Forecast Accuracy**: MAE about 2.0 GW, bias about +1.7 GW (wind over-forecast in 84 % of periods), the P10–P90 empirical range, error by hour of day, the daily bias and the largest errors table.
5. *(4:15)* **Data Health and Historical Data**: complete coverage, refresh with explicit status, CSV export. Close with the limitations: wind alone does not set the procurement volume, and error ranges are descriptive.

**Part 2: technical review (up to 5 min)**

1. *(5:00)* Architecture diagram: Elexon, then ingestion, validation, selection, matching, metrics, FastAPI and React. Explain why SQLite fits this data size.
2. *(5:45)* Code tour: `elexon_client.py` (chunks, retries), `forecast_selection.py` (pure function, inclusive cutoff, deterministic deduplication), `accuracy_metrics.py`, and `analysis.py` (cache keyed on data version).
3. *(7:00)* Data honesty: the status taxonomy, missing values never shown as zero, staleness rules, CSV import validation, and API data taking precedence over imports.
4. *(7:45)* Frontend: URL-synced filters, TanStack Query, typed client, accessible components, colour-vision-safe palette.
5. *(8:30)* Quality: run `pytest` (78) and `npm test` (25), show CI, `docker compose up --build`, and the OpenAPI docs.
6. *(9:30)* Next steps: deployment, more months of data, and optional uncertainty bands once a longer history is available.
