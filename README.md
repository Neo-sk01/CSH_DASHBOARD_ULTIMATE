# CSH Call Analytics

Versature batch pipeline + Next.js dashboard. A scheduled job pulls CDRs and
queue stats from Versature into MotherDuck nightly. The dashboard reads
pre-computed snapshot rows only — it never calls Versature live.

This README is the operator's entry point. The authoritative design is
[docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md](docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md);
the implementation plan is in
[docs/superpowers/plans/2026-05-02-versature-batch-pipeline-implementation.md](docs/superpowers/plans/2026-05-02-versature-batch-pipeline-implementation.md);
the non-technical stakeholder report is at
[docs/superpowers/specs/2026-05-03-csh-dashboard-stakeholder-report.md](docs/superpowers/specs/2026-05-03-csh-dashboard-stakeholder-report.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions                                              │
│   schedule           08:00 UTC nightly                       │
│   schedule           08:30 UTC on the 2nd of each month      │
│   workflow_dispatch  manual via UI                           │
│   repository_dispatch  from /api/admin/pull                  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  jobs/run-pull.ts                                            │
│   lib/versature/  — auth, rate-limited client, retries       │
│   lib/pipeline/   — fetch → load → build logical → snapshot  │
│   lib/warehouse/  — MotherDuck client, bulk loaders          │
└──────────────────────────┬──────────────────────────────────┘
                           ▼  (HTTPS, bearer auth)
┌─────────────────────────────────────────────────────────────┐
│  MotherDuck (csh_analytics)                                  │
│   raw_cdr_segments  raw_queue_stats  raw_queue_splits        │
│   logical_calls     kpi_snapshots    pull_runs               │
└──────────────────────────▲──────────────────────────────────┘
                           │  (read-only token)
┌──────────────────────────┴──────────────────────────────────┐
│  Next.js dashboard (Vercel)                                  │
│   /                — reads kpi_snapshots                     │
│   /admin           — reads pull_runs, queues admin pulls     │
│   /api/admin/pull  — dispatches the pull workflow            │
│   /api/health/freshness  — last-pull SLO check               │
└─────────────────────────────────────────────────────────────┘
```

Strict layer boundaries are enforced by ESLint and a CI grep gate
([eslint.config.mjs](eslint.config.mjs),
[.github/workflows/ci.yml](.github/workflows/ci.yml)):

- `app/**` and `components/**` may not import `@/lib/versature/*` or
  `@/lib/pipeline/*`.
- `lib/warehouse/**` may not import `@/lib/versature/*` or
  `@/lib/pipeline/*` (closes the indirect path).
- `lib/versature/**` may not import `@/lib/warehouse/*` (the Versature
  client must not know about MotherDuck).
- `lib/versature/index.ts` and `lib/pipeline/index.ts` may not contain
  barrel re-exports.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Neo-sk01/CSH_DASHBOARD_ULTIMATE.git
cd CSH_DASHBOARD_ULTIMATE
npm install
```

### 2. Configure local env

```bash
cp .env.local.example .env.local
```

Fill in the secrets — see [Environment variables](#environment-variables)
below for what each one does. For local development you only need
`MOTHERDUCK_TOKEN_RO` (to read snapshots from the dashboard) plus the
queue IDs and `TRACKED_DNIS`. You only need `MOTHERDUCK_TOKEN_RW` if you
want to run `npm run pull` or `npm run db:migrate` locally against a
sandbox database. Versature credentials are only needed for `npm run
pull`.

### 3. Apply schema (first time only, or against a fresh database)

```bash
npm run db:migrate
```

Applies `lib/warehouse/schema.sql` to the database named in
`MOTHERDUCK_DATABASE`. Idempotent: the schema uses
`CREATE TABLE IF NOT EXISTS`.

### 4. GitHub Actions secrets

The pipeline runs in GitHub Actions, so the production secrets live in
the repository's Actions secrets/vars. See
[.github/workflows/pull.yml](.github/workflows/pull.yml) for the exact
list. The same names appear in `.env.local.example`.

## Local development

```bash
npm run dev          # dashboard at http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . (architectural rules + Next config)
npm run test         # all vitest tests
npm run test:unit    # unit tests only
npm run test:integration  # integration tests (uses real MotherDuck smoke db)
npm run build        # production Next build (webpack)

npm run pull                            # pulls a 7-day rolling window
npm run pull -- --start 2026-04-23 --end 2026-04-30   # specific window
npm run audit -- --date=2026-04-30      # one-day diagnostic
```

The audit script ([scripts/audit-day.ts](scripts/audit-day.ts)) prints
logical-call count, per-queue offered totals, drift between the two,
and five sample logical calls. Used to spot-check the warehouse
against the Versature web portal during incidents and during the
staging cutover gate.

## Scheduled jobs

`.github/workflows/pull.yml` runs `jobs/run-pull.ts` on three triggers,
serialized by a `concurrency: pull-versature` group:

| Trigger | When | Window | Finalize |
|---|---|---|---|
| `schedule` (nightly) | `0 8 * * *` UTC daily | `[today − 7, yesterday]` (rolling) | no |
| `schedule` (monthly) | `30 8 2 * *` UTC | full previous month | yes |
| `workflow_dispatch` | manual via GH Actions UI | from `inputs.windowStart`/`windowEnd` | from `inputs.forceFinalize` |
| `repository_dispatch` (`admin-pull`) | from `/api/admin/pull` | from `client_payload.windowStart`/`windowEnd` | from `client_payload.forceFinalize` |

The 08:00 UTC slot is ~03:00 ET in summer / ~04:00 ET in winter; we
accept the 1-hour DST drift since both times are deep-night for
Toronto operations.

A second workflow ([.github/workflows/missing-run.yml](.github/workflows/missing-run.yml))
runs at 10:00 UTC (≈2 hours after the nightly window's expected
completion) and alerts if no successful cron-triggered `pull_runs`
row has been written in the last 24 hours. This catches GitHub Actions
outages that the pipeline alone wouldn't notice.

A third workflow ([.github/workflows/smoke.yml](.github/workflows/smoke.yml))
runs the pipeline against a separate `csh_analytics_smoke` database on
each push, catching regressions before they touch production data.

### Snapshot finalization

`kpi_snapshots` rows have an `is_finalized` flag. Once `true`, the row
is **immutable** unless an explicit `forceFinalize` overrides it:

- **Daily** snapshots auto-finalize when `period_start < current_date − 7 days`.
- **Weekly** snapshots auto-finalize when both `period_start` and
  `period_end` are `< current_date − 7 days`.
- **Monthly** snapshots auto-finalize on the 2nd-of-month cron run.
- Any trigger with `forceFinalize: true` writes `is_finalized = true`
  unconditionally and logs the overriding `pull_run_id` in the audit
  trail.

This guarantees a finalized number quoted in a report on day N is the
same number on day N+30.

## Common operator tasks

### Dashboard says "Data not downloaded yet" for a recent period

1. Open `/admin?token=$ADMIN_PULL_TOKEN`. Find the most recent
   `pull_runs` row for the affected window.
2. If the run is `partial_fetch` or `partial_build`, click through to
   the GitHub Actions log linked from the alert webhook (or visit the
   Actions tab directly).
3. Re-run via `/admin` → "Rebuild a period" once the underlying issue
   is resolved. The pipeline is idempotent for non-finalized rows;
   re-running cannot make things worse.

### Numbers for a recent period changed today

Expected for any period that is not yet finalized — the pipeline pulls
a 7-day rolling window every night and updates non-finalized rows. If
the period is finalized (`is_finalized = true` in `kpi_snapshots`) and
the number nevertheless changed, that's a bug — open an incident and
check the audit log for an unauthorized `forceFinalize` override.

### Backfill a period (up to 90 days)

Either:
- POST to `/api/admin/pull` with `{ windowStart, windowEnd, reason,
  forceFinalize }`. The route validates and dispatches the workflow.
- Or trigger `pull-versature` via the GitHub UI ("Run workflow" with
  custom inputs).

The 90-day cap is enforced by the admin route; longer backfills must
be split into multiple admin pulls. The concurrency group serializes
runs.

### Versature changed an API field

The smoke workflow catches this within 24 hours. Steps:
1. Update [lib/versature/types.ts](lib/versature/types.ts) and any
   affected build SQL.
2. Re-run a known-good day via `/admin` → "Rebuild a period" with
   `forceFinalize: false` and confirm the snapshot matches the
   pre-change baseline.
3. After merge, run a "Rebuild a period" against the affected window
   to heal the warehouse.

### Versature credentials rotated

Update the GitHub Actions repository secrets
(`VERSATURE_CLIENT_ID`, `VERSATURE_CLIENT_SECRET`). The next nightly
run picks them up. No code change needed.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `VERSATURE_BASE_URL` | pull job | e.g. `https://integrate.versature.com/api` |
| `VERSATURE_CLIENT_ID` | pull job | OAuth client credentials |
| `VERSATURE_CLIENT_SECRET` | pull job | OAuth client credentials |
| `VERSATURE_API_VERSION` | pull job | `application/vnd.integrate.v1.10.0+json` |
| `MOTHERDUCK_TOKEN_RW` | pull job | Read-write token, scope `csh_analytics` only |
| `MOTHERDUCK_TOKEN_RO` | dashboard | Read-only token, scope `csh_analytics` only |
| `MOTHERDUCK_TOKEN_SMOKE` | smoke job | Read-write token, scope `csh_analytics_smoke` only |
| `MOTHERDUCK_DATABASE` | both | `csh_analytics` (prod) or `csh_analytics_smoke` (smoke) |
| `QUEUE_EN_MAIN` | pull job, audit | English queue ID, e.g. `8020` |
| `QUEUE_FR_MAIN` | pull job, audit | French queue ID, e.g. `8021` |
| `QUEUE_AI_OVERFLOW_EN` | pull job, audit | AI overflow EN queue ID, e.g. `8030` |
| `QUEUE_AI_OVERFLOW_FR` | pull job, audit | AI overflow FR queue ID, e.g. `8031` |
| `TRACKED_DNIS` | pull job | Comma-separated, e.g. `+16135949199,6135949199` |
| `ADMIN_PULL_TOKEN` | dashboard | Bearer token for `/admin` and `/api/admin/pull` |
| `GH_DISPATCH_TOKEN` | dashboard | GitHub PAT with `repository_dispatch` scope on this repo |
| `GH_REPO` | dashboard | `owner/repo` for the dispatch URL |
| `ALERT_WEBHOOK_URL` | pull job | Slack/Teams incoming-webhook URL for failure alerts |
| `FRESHNESS_MAX_AGE_HOURS` | dashboard (optional) | SLO threshold for `/api/health/freshness`; defaults to 36 |
| `TIMEZONE` | both | `America/Toronto` |

`.env.local.example` ships with placeholder values only.

## Disaster recovery

Recovery is bounded by **two independent retention windows**:
MotherDuck's database time-travel window, and Versature's CDR/queue-stats
retention (commonly 90 days, but verify with the Versature account).

| Scenario | Recovery |
|---|---|
| MotherDuck database dropped, within MotherDuck time-travel | Restore via MotherDuck time-travel. No Versature traffic. |
| MotherDuck database dropped, past time-travel, raw tables backed up | Restore the backup; rebuild logical + snapshots via the pipeline. |
| Raw tables corrupt/dropped, **within Versature retention** | Re-pull the affected window. Versature is the source of truth. |
| Raw tables corrupt/dropped, **past Versature retention** | **Unrecoverable from Versature.** Restore from the cold-storage export if one exists. |
| Versature credentials rotated | Update GH Actions secrets. Next nightly run picks them up. |
| GitHub Actions deprecates Node | Job is plain TypeScript; portable to any Node-capable runner via a YAML edit. |

The single point of irreversible loss is **raw data past Versature
retention**. If historical KPIs are irreplaceable, evaluate adding a
weekly export of `kpi_snapshots` (≈2,400 rows/year, essentially free)
to a separate cold-storage location.

**Verify Versature retention before launch** with the Versature account
team. If their tenant retention is less than 90 days, lower the admin
"Rebuild period" cap accordingly so operators don't get a misleading
failure on a backfill.

## Tests and CI gates

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on
every PR and push to `main`:

1. `npm run typecheck` — `next typegen && tsc --noEmit` against a
   dedicated `tsconfig.typecheck.json` (deterministic across `next dev`
   vs `next build` route-types drift).
2. `npm run lint` — ESLint with the architectural `no-restricted-imports`
   rules.
3. **Architectural grep gates** — two `grep -rE` checks that
   independently enforce the dashboard-layer and warehouse-reader-layer
   import rules. Belt-and-suspenders: if anyone disables ESLint, grep
   still catches it.
4. `npm run test:unit` — pure-function unit tests.
5. `npm run test:integration` — integration tests (uses a real
   MotherDuck smoke database via `MOTHERDUCK_TOKEN_SMOKE`).
6. `npm run build` — Next production build.

A push must clear all six gates to merge.

## Project structure

```
app/                  Next.js app router (read-only — never imports lib/versature or lib/pipeline)
  page.tsx            Dashboard root (kpi_snapshots reader)
  admin/              Token-gated admin page
  api/admin/pull/     POST endpoint that dispatches the pull workflow
  api/health/freshness/  GET endpoint for external uptime checks

components/           React components used by app/ (same import constraints)

lib/
  versature/          Versature OAuth + rate-limited HTTP client + endpoint wrappers
  pipeline/           fetch-and-load + build-logical-calls + build-snapshots
  warehouse/          MotherDuck client (Reader and Writer surfaces)
  utils/              Shared helpers (DNIS normalization, dates, logger)

jobs/
  run-pull.ts         Pipeline orchestrator (entry point for GH Actions)
  notify-failure.ts   Posts to ALERT_WEBHOOK_URL on pipeline failure

scripts/
  migrate.ts          Apply schema.sql to the configured MotherDuck database
  audit-day.ts        Read-only diagnostic for a single calendar day

tests/
  unit/               Pure-function unit tests
  integration/        Integration tests against the smoke database
  fixtures/           Sanitized real-CDR samples + Task 0 verification artifacts

.github/workflows/
  pull.yml            Nightly + monthly + manual + admin-dispatch pull
  smoke.yml           Smoke pipeline run on every push
  missing-run.yml     Daily watcher; alerts if nightly didn't run
  ci.yml              typecheck + lint + grep gates + tests + build

docs/superpowers/specs/   Design specs (one per major component)
docs/superpowers/plans/   Implementation plans
```

## Out of scope (v1)

These are deliberate non-goals — the v1 surface is intentionally small.

- Per-queue dashboards (data is in the warehouse; surfacing it is a
  later dashboard-only PR).
- Year-over-year deltas (need a full year of data first).
- Self-service user accounts (admin gate is a single shared bearer
  token).
- Real-time / sub-daily refresh.
- Streaming CDR ingest (the API is poll-only).
- ConnectWise ticket correlation — that is Part 2 of the dashboard
  program, not this codebase.
