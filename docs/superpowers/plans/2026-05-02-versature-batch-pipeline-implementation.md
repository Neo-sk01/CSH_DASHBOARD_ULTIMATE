# Versature Batch Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a brand-new scheduled batch pipeline that pulls Versature CDRs, queue stats, and split reports into MotherDuck nightly under documented rate limits, derives logical calls and KPI snapshots, and lets a Next.js dashboard read snapshot rows directly without ever touching Versature.

**Architecture:** A single `jobs/run-pull.ts` script — invoked by GitHub Actions (cron + workflow_dispatch + repository_dispatch) — orchestrates seven sequential stages: open run, fetch CDRs, fetch queue stats, fetch splits, build logical calls (DuckDB SQL), build KPI snapshots (DuckDB SQL with update-only-on-change), close run. Stages 4–5 only run when all of Stages 1–3 succeed for the window. The Next.js dashboard reads `kpi_snapshots` directly via a read-only MotherDuck token and never imports anything under `lib/versature/` or `lib/pipeline/` (enforced by ESLint, type surfaces, and a CI grep gate).

**Tech Stack:** Next.js 16 + React 19, TypeScript 5.7, Vitest 3, MotherDuck (DuckDB), msw 2.x for HTTP mocking, ulid, date-fns + @date-fns/tz, GitHub Actions for scheduling.

**Spec:** [`docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md`](../specs/2026-05-02-versature-batch-pipeline-design.md)

---

## Pre-Flight

This plan modifies an existing Next.js scaffold at `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`. Before starting:

1. Create a worktree off the current branch (use `superpowers:using-git-worktrees`) so the existing app/scripts remain intact for reference.
2. Confirm you have:
   - A MotherDuck account with two databases provisioned: `csh_analytics` (production) and `csh_analytics_smoke` (smoke test).
   - Three MotherDuck service tokens: `MOTHERDUCK_TOKEN_RW` (job, RW on prod), `MOTHERDUCK_TOKEN_RO` (dashboard, RO on prod), `MOTHERDUCK_TOKEN_SMOKE` (smoke, RW on smoke DB).
   - Versature OAuth credentials (`VERSATURE_CLIENT_ID`, `VERSATURE_CLIENT_SECRET`).
   - A GitHub repo for the project, with Actions enabled and a fine-scoped PAT for `repo:dispatch`.
   - A Slack/Teams incoming webhook URL for `ALERT_WEBHOOK_URL`.
3. The plan assumes the spec is the source of truth. When something in the plan and the spec disagree, stop and ask.

---

## File Structure

This plan creates and modifies the following files. Each file has a single, named responsibility.

### Configuration
- Modify `package.json` — replace `pg` with a MotherDuck/DuckDB client, add `msw`, `ulid`, dev deps for tests.
- Modify `app/layout.tsx` — minor updates for new app shell.
- Replace `app/page.tsx` — new dashboard root.
- Create `.env.local.example` — placeholder env vars.
- Create `eslint.config.mjs` (or modify if exists) — architectural lint rules.
- Create `.github/workflows/pull.yml` — nightly + monthly + manual + admin.
- Create `.github/workflows/smoke.yml` — nightly smoke.
- Create `.github/workflows/missing-run.yml` — alert on missing nightly.
- Create `.github/workflows/ci.yml` — typecheck/lint/test/build.

### Schema
- Create `lib/warehouse/schema.sql` — all 6 CREATE TABLE statements + indexes.

### Versature client (`lib/versature/`)
- Create `types.ts` — `VersatureCdr`, `QueueStatsResponse`, `QueueSplitsResponse`, `EndpointName`.
- Create `auth.ts` — OAuth client-credentials token cache.
- Create `rate-limiter.ts` — endpoint-aware sliding window + sub-second floor.
- Create `client.ts` — `request(endpoint, path, init)` HTTP wrapper with retry/backoff.
- Create `endpoints.ts` — typed wrappers `fetchCdrs`, `fetchQueueStats`, `fetchQueueSplits`.

### Warehouse layer (`lib/warehouse/`)
- Create `client.ts` — MotherDuck connection + `WarehouseReader`/`WarehouseWriter` type surfaces + `normalize_dnis` UDF registration.
- Create `pull-runs.ts` — open/update/close `pull_runs` rows.
- Create `snapshots.ts` — read-only `getSnapshot`, `getMostRecentFinalizedDay`, `getLatestSuccessfulPull`.

### Pipeline (`lib/pipeline/`)
- Create `fetch-and-load.ts` — Stages 1–3: bulk-load helpers for CDRs, queue stats, splits.
- Create `build-logical-calls.ts` — Stage 4 SQL.
- Create `build-snapshots.ts` — Stage 5 SQL with update-only-on-change.

### Utils (`lib/utils/`)
- Create `dnis.ts` — `normalizeDnis(s)` (TS) + DuckDB UDF body string.
- Create `dates.ts` — `eachBusinessDate`, `resolvePeriodStart`, Toronto-local helpers.
- Create `logger.ts` — structured logger (one-liner JSON to stdout for GH Actions).

### Job runner
- Create `jobs/run-pull.ts` — orchestrator (Stages 0 + 6, dispatches Stages 1–5).
- Create `jobs/notify-failure.ts` — posts to `ALERT_WEBHOOK_URL`.

### Scripts
- Create `scripts/migrate.ts` — apply `lib/warehouse/schema.sql` to MotherDuck.
- Create `scripts/audit-day.ts` — per-day diagnostic.
- Create `scripts/inspect-queue-shape.mjs` — Task 0 verification helper for queue-touch inference.
- Keep existing `scripts/inspect-cdr-shape.mjs` for re-verification.

### Dashboard (`app/` + `components/`)
- Replace `app/page.tsx` — server component, reads snapshot.
- Create `app/admin/page.tsx` — pull history + rebuild form.
- Create `app/api/admin/pull/route.ts` — dispatches GH workflow.
- Create `app/api/health/freshness/route.ts` — uptime endpoint.
- Create `components/DashboardView.tsx`.
- Create `components/NotDownloadedYet.tsx`.
- Create `components/KpiCard.tsx`.
- Create `components/PeriodToggle.tsx`.
- Create `components/WeekendToggle.tsx`.

### Tests
- Create `vitest.config.ts` — two projects: `unit` (no DB) and `integration` (real DuckDB).
- Create `tests/unit/dnis.test.ts`.
- Create `tests/unit/dates.test.ts`.
- Create `tests/unit/rate-limiter.test.ts`.
- Create `tests/unit/client.test.ts`.
- Create `tests/unit/build-logical-calls.test.ts`.
- Create `tests/unit/build-snapshots.test.ts`.
- Create `tests/unit/snapshots.test.ts`.
- Create `tests/integration/pull-cdrs.test.ts`.
- Create `tests/integration/mutable-segments.test.ts`.
- Create `tests/integration/pull-queue-stats.test.ts`.
- Create `tests/integration/full-pipeline.test.ts`.
- Create `tests/integration/partial-failure.test.ts`.
- Create `tests/integration/finalized-immutability.test.ts`.
- Create `tests/fixtures/real-cdr-samples.ndjson` — sanitized CDRs from Task 0.
- Create `tests/fixtures/real-cdr-samples.expected.json` — known-good logical-call counts.
- Create `tests/helpers/test-warehouse.ts` — in-memory DuckDB factory for tests.

### Docs
- Replace `README.md` — full local dev + ops runbook.

---

## Task 0: Run verification scripts (HARD GATE)

The spec defines six Task 0 gates (gates 1–5 are hard pass/fail; gate 6 is informational). None of the rest of the plan can proceed until each one is resolved. **Failure on a hard gate halts implementation until the design is updated** per the gate-specific failure decision in the spec.

This task produces three artifacts that all must land in the same commit:
1. `docs/versature-task-0-verification.md` — human-readable report with full audit metadata.
2. `tests/fixtures/versature-task-0-results.json` — machine-readable equivalent for future CI ingestion.
3. `tests/fixtures/real-cdr-samples.ndjson` + `tests/fixtures/real-cdr-samples.expected.json` + `tests/fixtures/dnis-allowed-exceptions.json` — sanitized fixtures + canary expected counts + DNIS exception list.

Plus three new scripts:
4. `scripts/inspect-queue-shape.mjs` — Gate 2 verification.
5. `scripts/sanitize-cdr-samples.mjs` — produces the redacted NDJSON from a raw CDR response.
6. `scripts/breakdown-cdr-samples.mjs` — runs the production SQL against the sanitized fixtures and emits a per-bucket count for cross-checking the manual classification.

**Audit metadata** (must appear in both the .md and .json artifacts): command run, executor name, timestamp (UTC + Toronto-local), tenant label, queue IDs tested, exact API parameters, total CDR rows inspected, pagination page count, observed `Retry-After` or rate-limit response headers if any, pass/fail per gate, decision taken on any failure.

---

### Gate 1: CDR shape unchanged (two sample dates)

- [ ] **Step 1.1: Re-run CDR shape inspection on a high-volume date**

Pick a recent business-day date with high call volume (e.g. a recent Tuesday, Wednesday, or Thursday).

Run: `node --env-file=.env.local --import tsx scripts/inspect-cdr-shape.mjs YYYY-MM-DD`

Expected output: `rowArrayKey: '<array-root>'`, non-zero `rowCount`, `firstRowKeys` matching `["duration","answer_time","start_time","end_time","from","to"]`, every sampled `from.call_id` non-null.

- [ ] **Step 1.2: Re-run on a low-volume / boundary date**

Pick a Sunday, holiday, or a date adjacent to a DST change.

Run: `node --env-file=.env.local --import tsx scripts/inspect-cdr-shape.mjs YYYY-MM-DD`

Expected: same shape as Step 1.1 (allow `rowCount` to be small or zero — boundary dates often have low volume).

**Pass criterion:** both responses match the expected shape. Both `firstRowKeys` arrays are identical.

**If fail:** stop. Update the spec's "Tenant-Specific Facts" section AND `lib/versature/types.ts` before proceeding.

---

### Gate 2: Queue-touch inference (CRITICAL)

- [ ] **Step 2.1: Create the queue-shape inspection script**

Create `scripts/inspect-queue-shape.mjs`. Outline (full implementation in spec; copy + flesh out):

1. Authenticate via OAuth client credentials (copy auth pattern from `scripts/inspect-cdr-shape.mjs`).
2. For ONE date, fetch CDRs via `GET /cdrs/?start_date=DATE&end_date=DATE&limit=2000` (paginate if `limit < total`).
3. For each tracked queue ID in `8020,8021,8030,8031`, fetch `GET /call_queues/{queue}/stats/?start_date=DATE&end_date=DATE`.
4. **Use the EXACT same date range, timezone (America/Toronto), queue list, and inclusion rules that the production pipeline will use.** Do not loosen any of these for verification; the goal is to compare apples to apples.
5. For each tracked queue, compute `A` = count of distinct `from.call_id`s in the CDR set where at least one segment has `to.user === queueId`.
6. Compute `B` = `calls_offered` from the queue stats response.
7. Compute `diff = A - B` and `tolerance = max(0.05 * B, 3)`.
8. Pass if `abs(diff) <= tolerance` for every tracked queue. Otherwise fail (per-queue and aggregate).
9. Also output the top 30 distinct `to.user` values NOT in the tracked-queue set so you can confirm there isn't a different queue identifier in use.
10. Output as a single JSON object suitable for diffing across runs.

- [ ] **Step 2.2: Run the inspection**

Run: `node --env-file=.env.local --import tsx scripts/inspect-queue-shape.mjs YYYY-MM-DD`

Record per-queue and aggregate accuracy in the verification artifacts.

**Pass criterion:** for every tracked queue, `abs(A - B) <= max(0.05 * B, 3)`.

**If fail (any queue):** **PAUSE IMPLEMENTATION AND REDESIGN QUEUE ATTRIBUTION.** Do not continue to Task 1. Investigate the top non-tracked `to.user` values from step 9 — the queue identifier may live in a different field. The pipeline's KPIs depend entirely on this gate; building on a broken assumption produces broken numbers everywhere downstream.

---

### Gate 3: Splits endpoint rate limit (CALIBRATION)

- [ ] **Step 3.1: Probe the splits endpoint**

Write a tiny throwaway TypeScript at `scripts/probe-splits-rate.mjs`:

1. Auth (same pattern as above).
2. Issue 30 sequential requests to `GET /call_queues/8020/reports/splits/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&period=day` with no delay between them, all within a 60-second window.
3. Capture each response: status code, `Retry-After` header if present, the index of the first 429 (if any).
4. Output JSON.

Run: `node --env-file=.env.local --import tsx scripts/probe-splits-rate.mjs YYYY-MM-DD`

- [ ] **Step 3.2: Calibrate the budget**

Apply this decision tree based on the output:

- **0 of 30 returned 429** → safe to raise `queue_splits.perMinute` to 24 (matching `queue_stats`). Set this in `lib/versature/rate-limiter.ts` and re-run unit tests.
- **First 429 at request N where N ≤ 12** → **fail.** Lower `queue_splits.perMinute` below N. Reconsider the architecture if N < 6.
- **First 429 at request N where 13 ≤ N ≤ 30** → keep the conservative 12/min budget; document the observed ceiling at `N - 1`.

**Pass criterion:** the API safely supports at least 12/min (the design's minimum).

**If fail (< 12/min ceiling):** reduce the budget OR redesign the split-fetch schedule to spread requests across multiple GH Actions runs. Discuss before proceeding.

---

### Gate 4: `from_call_id` uniqueness over 30 days (with diagnosis)

- [ ] **Step 4.1: Pull and aggregate**

Write a TypeScript helper at `scripts/check-call-id-uniqueness.mjs`:

1. Auth.
2. Loop over the 30 most recent dates (one date per request).
3. For each CDR row, accumulate `Map<from.call_id, Set<call_date>>` where `call_date = toTorontoDate(start_time)`.
4. Output every entry where Set size > 1.

Run: `node --env-file=.env.local --import tsx scripts/check-call-id-uniqueness.mjs`

- [ ] **Step 4.2: Diagnose any duplicates**

If duplicates are found, do NOT immediately change the schema PK. Instead, categorize each duplicate into one of:

- **Timezone spillover** — the call's `start_time` is near midnight Toronto-local. Inspect the timestamp; if it crosses midnight in one zone but not another, the duplicate is a TZ artifact and the existing Toronto-local `call_date` derivation handles it. **No PK change needed.**
- **Pagination duplication** — the same `(from.call_id, to.call_id, start_time)` triple appears across two pages. Already handled by the `source_hash` PK. **No PK change needed.**
- **Multi-segment artifact** — should be impossible given SBC ID format. Investigate if seen.
- **True ID reuse across days** — Versature legitimately reuses the same ID later. **This is the only case requiring a PK change** to `(from_call_id, call_date)` in `lib/warehouse/schema.sql` plus updates to `build-logical-calls.ts`.

Record the count and category breakdown in the verification artifacts.

**Pass criterion:** zero duplicates, OR all duplicates fall into the "no PK change needed" categories.

**If fail (true ID reuse confirmed):** before continuing, change the schema PK to `(from_call_id, call_date)` in `lib/warehouse/schema.sql`, update the `INSERT INTO logical_calls` SQL in `lib/pipeline/build-logical-calls.ts`, and re-run from Task 2.

---

### Gate 5: DNIS normalization coverage (with allowed-exception list)

- [ ] **Step 5.1: Build the allowed-exception list**

Create `tests/fixtures/dnis-allowed-exceptions.json` with the categories of `to.id` values that legitimately don't normalize to a 10-digit form:

```json
{
  "shortDigitOnly": "values like 40, 211, 8020 — internal extensions or queue IDs",
  "sipPrefix": "values starting with sip:",
  "anonymous": ["", "anonymous", "restricted", "private", "unknown"],
  "examplePatterns": [
    "^\\d{1,9}$",
    "^sip:",
    "^anonymous$"
  ]
}
```

Adjust the `examplePatterns` based on what you actually see in the next step.

- [ ] **Step 5.2: Sample one month of distinct `to.id` values**

Reuse the 30-day pull from Gate 4. Extract distinct non-null `to.id` values, run each through `normalizeDnis()` (paste the function body from `lib/utils/dnis.ts` into a scratch script if Task 3 hasn't shipped yet — but Task 3 IS done, so import it).

- [ ] **Step 5.3: Categorize NULL results**

For each `to.id` where `normalizeDnis(to.id) === null`, classify it:

- Matches an allowed-exception pattern → fine, ignore.
- Doesn't match → **unexpected NULL**. Either extend `normalizeDnis()` to handle the new pattern, OR add the pattern to the allowed-exception list with a comment explaining why it's a non-customer DNIS.

**Pass criterion:** zero unexpected NULLs after the allowed-exception list is updated.

**If fail (unexpected NULLs remain):** extend the normalizer or the exception list and re-run.

---

### Gate 6: Segment timestamp tie-breaking (INFORMATIONAL)

- [ ] **Step 6.1: Count tied-`start_time` segments**

From the 30-day sample, count `from_call_id` groups where 2+ tracked-queue segments share an exact-equal `start_time`. Record the count.

**Pass criterion:** none — informational only.

**Outcome:**
- If 0 ties found → flag in the report. The tie-break path won't be exercised by real data; rely on the hand-crafted test in `tests/unit/build-logical-calls.test.ts`.
- If ≥ 1 tie found → confirms the existing SQL secondary sort (`ORDER BY start_time, source_hash`) handles real data.

---

### Capture and sanitize CDR samples

- [ ] **Step 7.1: Pick a source date for the fixtures**

A recent business day with diverse routing patterns (English, French, AI, AI-overflow, abandoned). Use the same date as Gate 1.1 if possible.

- [ ] **Step 7.2: Create the sanitization script**

Create `scripts/sanitize-cdr-samples.mjs`. Outline:

1. Read raw CDR JSON from stdin (or a file argument).
2. Select 50–100 segments belonging to ~25 distinct `from.call_id`s with mixed routing patterns. Prioritize: at least 5 English-only, 3 French-only, 3 AI-only, 2 AI-overflow (English-then-AI or French-then-AI), 2 abandoned, plus a few multi-segment calls.
3. Apply the redaction policy from the spec:
   - Preserve `to.user` exactly (queue IDs and internal extensions are operational, not customer data).
   - Optionally apply a fixed timestamp offset (e.g. shift all by `-6 months`). If you do, record the offset in `real-cdr-samples.expected.json`.
   - Replace `from.id` (caller phone) with a deterministic safe equivalent — same number → same redacted number, but never a real phone. Use `+15555550100`, `+15555550101`, ... pool. Preserve the format characters (parens, dashes, dots).
   - For any `to.id` that's an external customer DID (not the tracked DNIS, not an internal extension, not a SIP address), redact the same way.
   - Tracked DNIS (`+16135949199` and variants) — preserve as-is. This is the public DNIS the pipeline tracks. Confirm with the operator before committing.
   - Replace SBC-style `from.call_id` and `to.call_id` with synthetic IDs that preserve grouping behavior. Maintain the original-to-synthetic mapping deterministically.
4. Output as NDJSON to stdout (one JSON object per line).

- [ ] **Step 7.3: Run the sanitization**

```
node --env-file=.env.local --import tsx scripts/sanitize-cdr-samples.mjs YYYY-MM-DD > tests/fixtures/real-cdr-samples.ndjson
```

Inspect the output by hand for any leakage — open the file and search for any digit string starting with `+1` that's NOT in the `+15555550xxx` redacted pool. Search for SBC IPs like `169.132.`. Search for any string that looks like an unredacted phone number.

- [ ] **Step 7.4: Compute expected counts via TWO methods**

**Method A — manual classification:** read the NDJSON file, group by `from.call_id`, classify each group into a bucket (English / French / AI / AI-overflow / excluded), and count.

**Method B — script-assisted:** create `scripts/breakdown-cdr-samples.mjs` that loads the NDJSON into an in-memory DuckDB, runs the production `build-logical-calls.ts` SQL against it (or imports the function from `lib/pipeline/build-logical-calls.ts`), and prints the per-bucket counts.

```
node --env-file=.env.local --import tsx scripts/breakdown-cdr-samples.mjs tests/fixtures/real-cdr-samples.ndjson
```

**Both methods must agree.** Any disagreement is itself a finding — investigate the disagreement before declaring the gate complete.

- [ ] **Step 7.5: Write the expected file**

```json
{
  "sourceDate": "YYYY-MM-DD",
  "sourceTimezone": "America/Toronto",
  "timestampOffsetApplied": "P-6M",
  "queues": ["8020", "8021", "8030", "8031"],
  "trackedDnisNormalized": ["6135949199"],
  "totalSegments": 87,
  "logicalCallCount": 25,
  "englishCalls": 9,
  "frenchCalls": 4,
  "aiCalls": 3,
  "aiOverflowCalls": 2,
  "computedBy": "manual + scripts/breakdown-cdr-samples.mjs (both agreed)",
  "scriptAssistedBreakdown": "scripts/breakdown-cdr-samples.mjs (v1)"
}
```

These exact numbers become the canary in `tests/unit/build-logical-calls.test.ts` (Task 14).

---

### Write the verification artifacts

- [ ] **Step 8.1: Write the human-readable report**

Create `docs/versature-task-0-verification.md` with one section per gate. Each section includes:

- Command run (with date arguments)
- Date / time executed (UTC and Toronto-local)
- Tenant label (e.g. "neolore.com production")
- Exact API parameters used
- Total CDR rows inspected
- Pagination page count
- Any observed `Retry-After` or rate-limit response headers
- Measured value
- Tolerance (where applicable)
- Pass / fail
- Decision taken on any failure (which the spec's failure-decision table maps to)

- [ ] **Step 8.2: Write the machine-readable results**

Create `tests/fixtures/versature-task-0-results.json` with the same data in structured form:

```json
{
  "executedAt": { "utc": "...", "toronto": "..." },
  "executor": "...",
  "tenant": "...",
  "gates": {
    "shape": { "dates": [...], "passed": true, "details": {...} },
    "queueTouch": { "date": "...", "perQueue": { "8020": { "A": ..., "B": ..., "diff": ..., "tolerance": ..., "passed": true }, ... }, "aggregatePassed": true },
    "splitsRate": { "date": "...", "first429At": null, "ceiling": "≥30/min", "passed": true, "newBudget": 24 },
    "callIdUniqueness": { "windowDays": 30, "duplicateCount": 0, "categoryBreakdown": {}, "passed": true },
    "dnisCoverage": { "windowDays": 30, "totalDistinct": ..., "unexpectedNulls": 0, "passed": true },
    "tieBreak": { "windowDays": 30, "tieGroupCount": ... }
  }
}
```

---

### Commit

- [ ] **Step 9.1: Commit verification artifacts**

```
git add scripts/inspect-queue-shape.mjs \
        scripts/sanitize-cdr-samples.mjs \
        scripts/breakdown-cdr-samples.mjs \
        scripts/probe-splits-rate.mjs \
        scripts/check-call-id-uniqueness.mjs \
        tests/fixtures/real-cdr-samples.ndjson \
        tests/fixtures/real-cdr-samples.expected.json \
        tests/fixtures/dnis-allowed-exceptions.json \
        tests/fixtures/versature-task-0-results.json \
        docs/versature-task-0-verification.md
git commit -m "task-0: verify Versature tenant assumptions and capture sanitized fixtures"
```

**HARD GATE:** Do not proceed to Task 1 unless gates 1–5 pass per their criteria and the verification artifacts (both `.md` and `.json`) are committed. Gate 6 is informational and does not block.

---

## Task 1: Project scaffold

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Modify: `tsconfig.json` — add path alias `@/*`

- [ ] **Step 1: Replace pg with DuckDB client and add test deps**

Edit `package.json`. Replace `dependencies`:

```json
{
  "dependencies": {
    "@date-fns/tz": "^1.2.0",
    "date-fns": "^4.1.0",
    "duckdb-async": "^1.1.3",
    "next": "16.1.1",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "recharts": "2.15.4",
    "ulid": "^2.3.0"
  }
}
```

Replace `devDependencies`:

```json
{
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.9",
    "@types/node": "^22.10.1",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "msw": "^2.4.9",
    "postcss": "^8.5.1",
    "tailwindcss": "^4.1.9",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.1.1"
  }
}
```

Replace `scripts`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:watch": "vitest",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:migrate": "node --env-file=.env.local --import tsx scripts/migrate.ts",
    "pull": "node --env-file=.env.local --import tsx jobs/run-pull.ts",
    "audit": "node --env-file=.env.local --import tsx scripts/audit-day.ts"
  }
}
```

Note: `duckdb-async` is the Node binding. MotherDuck connection string format is `md:DBNAME?motherduck_token=TOKEN`.

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: clean install. If `duckdb-async` build fails on macOS, you may need `npm install --build-from-source duckdb-async`.

- [ ] **Step 3: Configure Vitest with two projects**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
      },
    ],
  },
})
```

- [ ] **Step 4: Create .env.local.example**

Create `.env.local.example`:

```
VERSATURE_BASE_URL=https://integrate.versature.com/api
VERSATURE_CLIENT_ID=
VERSATURE_CLIENT_SECRET=
VERSATURE_API_VERSION=application/vnd.integrate.v1.10.0+json

MOTHERDUCK_TOKEN_RW=
MOTHERDUCK_TOKEN_RO=
MOTHERDUCK_TOKEN_SMOKE=
MOTHERDUCK_DATABASE=csh_analytics

QUEUE_EN_MAIN=8020
QUEUE_FR_MAIN=8021
QUEUE_AI_OVERFLOW_EN=8030
QUEUE_AI_OVERFLOW_FR=8031

TRACKED_DNIS=+16135949199,6135949199

ADMIN_PULL_TOKEN=
GH_DISPATCH_TOKEN=
GH_REPO=owner/repo

ALERT_WEBHOOK_URL=

TIMEZONE=America/Toronto
```

- [ ] **Step 5: Verify TypeScript path alias is set**

Edit `tsconfig.json` and confirm `compilerOptions.paths` contains:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

- [ ] **Step 6: Sanity check**

Run: `npm run typecheck`
Expected: passes (no source files yet to check).

Run: `npm test`
Expected: "No test files found" — no failure, just nothing to run.

- [ ] **Step 7: Commit scaffold**

```
git add package.json package-lock.json vitest.config.ts .env.local.example tsconfig.json
git commit -m "task-1: scaffold deps, vitest projects, env template"
```

---

## Task 2: MotherDuck schema + migration

**Files:**
- Create: `lib/warehouse/schema.sql`
- Create: `scripts/migrate.ts`

- [ ] **Step 1: Write the schema file**

Create `lib/warehouse/schema.sql` with all six tables from the spec (Section: Data Model). Copy the `CREATE TABLE` blocks verbatim from the spec — `raw_cdr_segments`, `raw_queue_stats`, `raw_queue_splits`, `logical_calls`, `kpi_snapshots`, `pull_runs` — plus their indexes. Add this comment at the top:

```sql
-- Schema for csh_analytics. Source of truth: docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md
-- All CREATE statements use IF NOT EXISTS; safe to run repeatedly.
COMMENT ON COLUMN raw_cdr_segments.source_hash IS
  'sha256(from_call_id || coalesce(to_call_id,'''') || start_time::VARCHAR). SENSITIVE TO PAYLOAD-SHAPE CHANGES.';
```

Place the `COMMENT ON COLUMN` statement after the `CREATE TABLE raw_cdr_segments` block.

- [ ] **Step 2: Write the migration script**

Create `scripts/migrate.ts`:

```typescript
import { Database } from 'duckdb-async'
import fs from 'node:fs/promises'
import path from 'node:path'

const token = process.env.MOTHERDUCK_TOKEN_RW
const dbName = process.env.MOTHERDUCK_DATABASE
if (!token) throw new Error('MOTHERDUCK_TOKEN_RW is required')
if (!dbName) throw new Error('MOTHERDUCK_DATABASE is required')

const db = await Database.create(`md:${dbName}?motherduck_token=${token}`)
const sql = await fs.readFile(path.join(process.cwd(), 'lib/warehouse/schema.sql'), 'utf8')

// Strip line comments, then split on `;` at statement end
const cleaned = sql.replace(/--.*$/gm, '')
const statements = cleaned.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)

for (const stmt of statements) {
  const preview = stmt.split('\n')[0].slice(0, 80)
  console.log(`> ${preview}...`)
  await db.exec(stmt + ';')
}

console.log('Migration complete.')
await db.close()
```

- [ ] **Step 3: Run migration against your dev MotherDuck**

Run: `npm run db:migrate`
Expected: one log line per statement, ending with `Migration complete.` Verify in the MotherDuck UI that all 6 tables exist with the documented columns.

- [ ] **Step 4: Run migration a second time (idempotency check)**

Run: `npm run db:migrate`
Expected: same output, no errors. `IF NOT EXISTS` keeps it safe.

- [ ] **Step 5: Commit**

```
git add lib/warehouse/schema.sql scripts/migrate.ts
git commit -m "task-2: MotherDuck schema and migration script"
```

---

## Task 3: DNIS normalization (`lib/utils/dnis.ts`)

**Files:**
- Create: `lib/utils/dnis.ts`
- Create: `tests/unit/dnis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dnis.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeDnis, normalizeDnisList } from '@/lib/utils/dnis'

describe('normalizeDnis', () => {
  it('returns null for null/empty/undefined input', () => {
    expect(normalizeDnis(null)).toBeNull()
    expect(normalizeDnis('')).toBeNull()
    expect(normalizeDnis(undefined)).toBeNull()
  })

  it('strips + and returns 10-digit form', () => {
    expect(normalizeDnis('+16135949199')).toBe('6135949199')
    expect(normalizeDnis('16135949199')).toBe('6135949199')
    expect(normalizeDnis('6135949199')).toBe('6135949199')
  })

  it('handles formatted variants', () => {
    expect(normalizeDnis('+1 (613) 594-9199')).toBe('6135949199')
    expect(normalizeDnis('613-594-9199')).toBe('6135949199')
    expect(normalizeDnis('613.594.9199')).toBe('6135949199')
    expect(normalizeDnis('  613 594 9199  ')).toBe('6135949199')
  })

  it('returns null when result is not 10 digits', () => {
    expect(normalizeDnis('123')).toBeNull()
    expect(normalizeDnis('+44 20 7946 0958')).toBeNull()
    expect(normalizeDnis('abc')).toBeNull()
  })

  it('strips leading 1 from 11-digit form when valid NANP', () => {
    expect(normalizeDnis('16135949199')).toBe('6135949199')
    expect(normalizeDnis('15551234567')).toBe('5551234567')
  })
})

describe('normalizeDnisList', () => {
  it('normalizes and dedupes a comma-separated string', () => {
    expect(normalizeDnisList('+16135949199,6135949199, +1 (613) 594-9199'))
      .toEqual(['6135949199'])
  })

  it('drops invalid entries, keeps valid ones', () => {
    expect(normalizeDnisList('+16135949199,bad,+15551234567'))
      .toEqual(['6135949199', '5551234567'])
  })
})
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npm run test:unit -- dnis`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/utils/dnis.ts`**

```typescript
export function normalizeDnis(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

export function normalizeDnisList(csv: string): string[] {
  const seen = new Set<string>()
  for (const raw of csv.split(',')) {
    const n = normalizeDnis(raw.trim())
    if (n) seen.add(n)
  }
  return [...seen]
}

// SQL body for the DuckDB scalar UDF — registered by lib/warehouse/client.ts.
// Implemented as a MACRO so it lives entirely in DuckDB without needing a UDF host.
export const NORMALIZE_DNIS_UDF_SQL = `
CREATE OR REPLACE MACRO normalize_dnis(s) AS (
  CASE
    WHEN s IS NULL THEN NULL
    WHEN length(regexp_replace(s, '\\D', '', 'g')) = 11
         AND regexp_replace(s, '\\D', '', 'g') LIKE '1%'
      THEN substr(regexp_replace(s, '\\D', '', 'g'), 2, 10)
    WHEN length(regexp_replace(s, '\\D', '', 'g')) = 10
      THEN regexp_replace(s, '\\D', '', 'g')
    ELSE NULL
  END
);
`
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- dnis`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```
git add lib/utils/dnis.ts tests/unit/dnis.test.ts
git commit -m "task-3: DNIS normalization (TS + DuckDB UDF body)"
```

---

## Task 4: Date helpers (`lib/utils/dates.ts`)

**Files:**
- Create: `lib/utils/dates.ts`
- Create: `tests/unit/dates.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/dates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  resolvePeriodStart,
  resolvePeriodEnd,
  eachBusinessDate,
  eachDate,
  isWeekend,
  toTorontoDate,
} from '@/lib/utils/dates'

describe('resolvePeriodStart', () => {
  it('daily returns the same Toronto-local date', () => {
    expect(resolvePeriodStart('daily', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-30')
  })

  it('weekly returns Monday of the ISO week', () => {
    // 2026-04-30 is a Thursday; ISO Monday = 2026-04-27
    expect(resolvePeriodStart('weekly', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-27')
  })

  it('monthly returns the 1st of the month', () => {
    expect(resolvePeriodStart('monthly', new Date('2026-04-30T12:00:00Z'))).toBe('2026-04-01')
  })
})

describe('resolvePeriodEnd', () => {
  it('weekly returns Friday when includeWeekends=false', () => {
    expect(resolvePeriodEnd('weekly', '2026-04-27', false)).toBe('2026-05-01')
  })
  it('weekly returns Sunday when includeWeekends=true', () => {
    expect(resolvePeriodEnd('weekly', '2026-04-27', true)).toBe('2026-05-03')
  })
  it('monthly returns the last day of the month', () => {
    expect(resolvePeriodEnd('monthly', '2026-04-01', true)).toBe('2026-04-30')
    expect(resolvePeriodEnd('monthly', '2026-02-01', true)).toBe('2026-02-28')
  })
})

describe('eachDate', () => {
  it('yields all dates in [start, end] inclusive', () => {
    expect(eachDate('2026-04-28', '2026-04-30')).toEqual([
      '2026-04-28', '2026-04-29', '2026-04-30',
    ])
  })
})

describe('eachBusinessDate', () => {
  it('skips Sat and Sun', () => {
    // Apr 30 Thu, May 1 Fri, May 2 Sat, May 3 Sun, May 4 Mon
    expect(eachBusinessDate({ start: '2026-04-30', end: '2026-05-04' }))
      .toEqual(['2026-04-30', '2026-05-01', '2026-05-04'])
  })
})

describe('isWeekend', () => {
  it('detects Saturday and Sunday', () => {
    expect(isWeekend('2026-05-02')).toBe(true)
    expect(isWeekend('2026-05-03')).toBe(true)
    expect(isWeekend('2026-05-04')).toBe(false)
  })
})

describe('toTorontoDate', () => {
  it('converts a UTC ISO timestamp to a Toronto-local YYYY-MM-DD', () => {
    // 07:00 UTC on 2026-03-08 (DST start day) is 03:00 EDT
    expect(toTorontoDate('2026-03-08T07:00:00Z')).toBe('2026-03-08')
    // 04:00 UTC on 2026-01-01 is 23:00 EST on 2025-12-31
    expect(toTorontoDate('2026-01-01T04:00:00Z')).toBe('2025-12-31')
  })
})
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm run test:unit -- dates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/utils/dates.ts`**

```typescript
import { tz } from '@date-fns/tz'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfISOWeek,
  endOfISOWeek,
  addDays,
  isAfter,
  parseISO,
  getDay,
} from 'date-fns'

const TZ = 'America/Toronto'

export type Period = 'daily' | 'weekly' | 'monthly'

export function resolvePeriodStart(period: Period, ref: Date): string {
  switch (period) {
    case 'daily':
      return format(ref, 'yyyy-MM-dd', { in: tz(TZ) })
    case 'weekly':
      return format(startOfISOWeek(ref, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
    case 'monthly':
      return format(startOfMonth(ref, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
  }
}

export function resolvePeriodEnd(period: Period, periodStart: string, includeWeekends: boolean): string {
  const start = parseISO(periodStart)
  if (period === 'daily') return periodStart
  if (period === 'monthly') {
    return format(endOfMonth(start, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
  }
  // weekly
  const end = includeWeekends
    ? endOfISOWeek(start, { in: tz(TZ) })  // Sunday
    : addDays(start, 4)                    // Friday
  return format(end, 'yyyy-MM-dd', { in: tz(TZ) })
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  let cursor = parseISO(start)
  const last = parseISO(end)
  while (!isAfter(cursor, last)) {
    out.push(format(cursor, 'yyyy-MM-dd'))
    cursor = addDays(cursor, 1)
  }
  return out
}

export function eachBusinessDate(window: { start: string; end: string }): string[] {
  return eachDate(window.start, window.end).filter((d) => !isWeekend(d))
}

export function isWeekend(date: string): boolean {
  const dow = getDay(parseISO(date))
  return dow === 0 || dow === 6
}

export function toTorontoDate(isoTimestamp: string): string {
  return format(parseISO(isoTimestamp), 'yyyy-MM-dd', { in: tz(TZ) })
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- dates`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add lib/utils/dates.ts tests/unit/dates.test.ts
git commit -m "task-4: date and timezone helpers"
```

---

## Task 5: Logger (`lib/utils/logger.ts`)

**Files:**
- Create: `lib/utils/logger.ts`

A minimal structured logger — single-line JSON to stdout for GH Actions log readability.

- [ ] **Step 1: Implement the logger**

Create `lib/utils/logger.ts`:

```typescript
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(fields ?? {}) })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info:  (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn:  (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
}
```

- [ ] **Step 2: Commit**

```
git add lib/utils/logger.ts
git commit -m "task-5: structured one-line JSON logger"
```

---

## Task 6: Versature types (`lib/versature/types.ts`)

**Files:**
- Create: `lib/versature/types.ts`

Types-only file — establishes the contract used by every other module under `lib/versature/`.

- [ ] **Step 1: Implement the types**

Create `lib/versature/types.ts`:

```typescript
export type EndpointName = 'cdrs' | 'queue_stats' | 'queue_splits'

export interface VersatureCdr {
  duration: number
  answer_time: string | null
  start_time: string
  end_time: string
  from: {
    call_id: string
    name: string | null
    id: string | null
    user: string | null
    domain: string | null
  }
  to: {
    call_id: string | null
    id: string | null
    user: string | null
    domain: string | null
  }
}

export interface QueueStatsResponse {
  calls_offered: number | null
  abandoned_calls: number | null
  abandoned_rate: number | null
  average_talk_time: number | null
  average_handle_time: number | null
  // Versature may include other fields; we capture them in raw_payload for audit.
  [key: string]: unknown
}

export interface QueueSplitsResponse {
  // The shape varies by `period`. We treat it as opaque JSON in raw_queue_splits
  // and inspect it later. Define an open shape.
  [key: string]: unknown
}

export interface DateWindow {
  start: string  // YYYY-MM-DD
  end: string    // YYYY-MM-DD
}

export class VersatureError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'VersatureError'
  }
}
```

- [ ] **Step 2: Commit**

```
git add lib/versature/types.ts
git commit -m "task-6: Versature type definitions"
```

---

## Task 7: Auth (`lib/versature/auth.ts`)

**Files:**
- Create: `lib/versature/auth.ts`

OAuth client-credentials token cache. Single in-memory token per process.

- [ ] **Step 1: Implement auth**

Create `lib/versature/auth.ts`:

```typescript
import { VersatureError } from './types'

interface CachedToken { accessToken: string; expiresAt: number }

let cached: CachedToken | null = null

const baseUrl = () => {
  const v = process.env.VERSATURE_BASE_URL
  if (!v) throw new Error('VERSATURE_BASE_URL is required')
  return v
}

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken
  cached = await fetchNewToken()
  return cached.accessToken
}

export function invalidateToken(): void {
  cached = null
}

async function fetchNewToken(): Promise<CachedToken> {
  const clientId = process.env.VERSATURE_CLIENT_ID
  const clientSecret = process.env.VERSATURE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('VERSATURE_CLIENT_ID and VERSATURE_CLIENT_SECRET are required')

  const res = await fetch(`${baseUrl()}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    throw new VersatureError(res.status, `OAuth token request failed: ${await res.text()}`)
  }

  const payload = await res.json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token) {
    throw new VersatureError(0, 'OAuth response missing access_token')
  }

  const expiresInMs = (payload.expires_in ?? 3600) * 1000
  return { accessToken: payload.access_token, expiresAt: Date.now() + expiresInMs }
}

// Exposed for tests only.
export function _resetForTests(): void { cached = null }
```

- [ ] **Step 2: Commit**

```
git add lib/versature/auth.ts
git commit -m "task-7: Versature OAuth token cache"
```

---

## Task 8: Rate limiter (`lib/versature/rate-limiter.ts`)

**Files:**
- Create: `lib/versature/rate-limiter.ts`
- Create: `tests/unit/rate-limiter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { acquire, _resetForTests } from '@/lib/versature/rate-limiter'

beforeEach(() => {
  vi.useFakeTimers()
  _resetForTests()
})

describe('rate limiter', () => {
  it('lets the first per-minute budget through immediately', async () => {
    // CDR budget is 12/min; 12 calls should not block on the per-minute window.
    for (let i = 0; i < 12; i++) {
      const startedAt = Date.now()
      const wait = acquire('cdrs')
      // Sub-second floor (200ms) means call N>=2 will sleep ~200ms
      vi.advanceTimersByTime(250)
      await wait
      // Still under 60s window; per-minute limit not exceeded
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    }
  })

  it('blocks the 13th CDR call within 60s until the oldest entry ages out', async () => {
    // Burn the 12-per-minute budget
    for (let i = 0; i < 12; i++) {
      const wait = acquire('cdrs')
      vi.advanceTimersByTime(250)
      await wait
    }
    // 13th call should sleep until the first call's timestamp is >60s old.
    const wait13 = acquire('cdrs')
    let resolved = false
    wait13.then(() => { resolved = true })
    vi.advanceTimersByTime(50_000)
    await Promise.resolve()
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(15_000)  // total 65s past the first call
    await wait13
    expect(resolved).toBe(true)
  })

  it('per-endpoint buckets are isolated', async () => {
    // Burn CDR budget
    for (let i = 0; i < 12; i++) {
      const wait = acquire('cdrs')
      vi.advanceTimersByTime(250)
      await wait
    }
    // queue_stats should still be unblocked
    const wait = acquire('queue_stats')
    vi.advanceTimersByTime(150)
    await wait
    expect(true).toBe(true)  // didn't time out
  })

  it('enforces sub-second minIntervalMs floor', async () => {
    // First CDR call goes immediately; second must wait at least 200ms.
    await acquire('cdrs')
    const wait = acquire('cdrs')
    let resolved = false
    wait.then(() => { resolved = true })
    vi.advanceTimersByTime(150)
    await Promise.resolve()
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(60)  // total 210ms
    await wait
    expect(resolved).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:unit -- rate-limiter`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rate limiter**

Create `lib/versature/rate-limiter.ts`:

```typescript
import type { EndpointName } from './types'

interface Budget {
  perMinute: number
  minIntervalMs: number
}

const BUDGETS: Record<EndpointName, Budget> = {
  cdrs:         { perMinute: 12, minIntervalMs: 200 },  // docs say 5/s, 15/min — we sit below
  queue_stats:  { perMinute: 24, minIntervalMs: 100 },  // docs say 10/s, 30/min — below
  queue_splits: { perMinute: 12, minIntervalMs: 200 },  // conservative until verified in Task 0 step 4
}

interface Bucket {
  timestamps: number[]   // sliding window of recent acquire timestamps (ms)
  lastAt: number         // last acquire timestamp for sub-second floor
}

const buckets: Record<EndpointName, Bucket> = {
  cdrs:         { timestamps: [], lastAt: 0 },
  queue_stats:  { timestamps: [], lastAt: 0 },
  queue_splits: { timestamps: [], lastAt: 0 },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function acquire(endpoint: EndpointName): Promise<void> {
  const budget = BUDGETS[endpoint]
  const bucket = buckets[endpoint]

  // 1. Sub-second floor
  const sinceLast = Date.now() - bucket.lastAt
  if (bucket.lastAt > 0 && sinceLast < budget.minIntervalMs) {
    await sleep(budget.minIntervalMs - sinceLast)
  }

  // 2. Per-minute sliding window
  const cutoff = Date.now() - 60_000
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff)
  if (bucket.timestamps.length >= budget.perMinute) {
    const oldest = bucket.timestamps[0]
    const waitMs = oldest + 60_000 - Date.now() + 1
    if (waitMs > 0) await sleep(waitMs)
    bucket.timestamps = bucket.timestamps.filter((t) => t > Date.now() - 60_000)
  }

  // 3. Record this acquire
  const now = Date.now()
  bucket.timestamps.push(now)
  bucket.lastAt = now
}

export function _resetForTests(): void {
  for (const key of Object.keys(buckets) as EndpointName[]) {
    buckets[key] = { timestamps: [], lastAt: 0 }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- rate-limiter`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add lib/versature/rate-limiter.ts tests/unit/rate-limiter.test.ts
git commit -m "task-8: endpoint-aware rate limiter (sliding window + sub-second floor)"
```

---

## Task 9: HTTP client (`lib/versature/client.ts`)

**Files:**
- Create: `lib/versature/client.ts`
- Create: `tests/unit/client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { request } from '@/lib/versature/client'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'
import { VersatureError } from '@/lib/versature/types'

const server = setupServer()

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  resetLimiter()
  resetAuth()
  process.env.VERSATURE_BASE_URL = 'https://test.versature.com/api'
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'

  server.listen({ onUnhandledRequest: 'error' })
  // Default OAuth handler — every test gets a token without setup
  server.use(
    http.post('https://test.versature.com/api/oauth/token/', () =>
      HttpResponse.json({ access_token: 'tok-1', expires_in: 3600 }),
    ),
  )
})

afterEach(() => {
  server.resetHandlers()
  server.close()
  vi.useRealTimers()
})

describe('request()', () => {
  it('passes Accept and Authorization headers', async () => {
    let captured: Headers | null = null
    server.use(
      http.get('https://test.versature.com/api/cdrs/', ({ request }) => {
        captured = request.headers
        return HttpResponse.json([])
      }),
    )
    await request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    expect(captured?.get('accept')).toBe('application/vnd.integrate.v1.10.0+json')
    expect(captured?.get('authorization')).toBe('Bearer tok-1')
  })

  it('on 401 invalidates the token, refreshes, retries once, then succeeds', async () => {
    let tokenCallCount = 0
    let cdrCallCount = 0
    server.use(
      http.post('https://test.versature.com/api/oauth/token/', () => {
        tokenCallCount += 1
        return HttpResponse.json({ access_token: `tok-${tokenCallCount}`, expires_in: 3600 })
      }),
      http.get('https://test.versature.com/api/cdrs/', () => {
        cdrCallCount += 1
        if (cdrCallCount === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json([])
      }),
    )
    await request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    expect(tokenCallCount).toBe(2)
    expect(cdrCallCount).toBe(2)
  })

  it('on second 401 throws fatal', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 401 })),
    )
    await expect(
      request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30'),
    ).rejects.toBeInstanceOf(VersatureError)
  })

  it('on 429 honors Retry-After header', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        calls += 1
        if (calls === 1) return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '5' } })
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(4_999)
    // Should still be waiting
    let resolved = false
    promise.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await promise
    expect(calls).toBe(2)
  })

  it('on 5xx backs off 2s/8s/32s', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        calls += 1
        if (calls < 4) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 32_000 + 100)
    await promise
    expect(calls).toBe(4)
  })

  it('on persistent 5xx throws after 3 retries', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 503 })),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 32_000 + 100)
    await expect(promise).rejects.toBeInstanceOf(VersatureError)
  })

  it('on other 4xx throws immediately', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 400 })),
    )
    await expect(
      request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30'),
    ).rejects.toBeInstanceOf(VersatureError)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:unit -- client`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `lib/versature/client.ts`:

```typescript
import { acquire } from './rate-limiter'
import { getAccessToken, invalidateToken } from './auth'
import { VersatureError, type EndpointName } from './types'
import { log } from '@/lib/utils/logger'

const RETRY_BACKOFF_MS = [2_000, 8_000, 32_000]
const DEFAULT_RETRY_AFTER_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function baseUrl(): string {
  const v = process.env.VERSATURE_BASE_URL
  if (!v) throw new Error('VERSATURE_BASE_URL is required')
  return v
}

function apiVersion(): string {
  return process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.10.0+json'
}

export async function request<T>(
  endpoint: EndpointName,
  path: string,
  init?: RequestInit,
): Promise<T> {
  await acquire(endpoint)

  let unauthorizedRetried = false
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken()
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: apiVersion(),
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })

    if (res.status === 401 && !unauthorizedRetried) {
      log.warn('versature 401 — invalidating token and retrying once', { endpoint, path })
      invalidateToken()
      unauthorizedRetried = true
      continue
    }

    if (res.status === 429) {
      if (attempt >= RETRY_BACKOFF_MS.length) {
        throw new VersatureError(429, 'rate-limited (429) after retries')
      }
      const ra = Number(res.headers.get('Retry-After'))
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1_000 : DEFAULT_RETRY_AFTER_MS
      log.warn('versature 429 — sleeping per Retry-After', { endpoint, path, waitMs })
      await sleep(waitMs)
      continue
    }

    if (res.status >= 500 && res.status < 600) {
      if (attempt >= RETRY_BACKOFF_MS.length) {
        throw new VersatureError(res.status, `5xx after retries: ${await res.text()}`)
      }
      const waitMs = RETRY_BACKOFF_MS[attempt]
      log.warn('versature 5xx — backing off', { endpoint, path, status: res.status, waitMs })
      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      throw new VersatureError(res.status, `${res.status}: ${await res.text()}`)
    }

    return res.json() as Promise<T>
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- client`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```
git add lib/versature/client.ts tests/unit/client.test.ts
git commit -m "task-9: HTTP client with 401/429/5xx handling"
```

---

## Task 10: Endpoint wrappers (`lib/versature/endpoints.ts`)

**Files:**
- Create: `lib/versature/endpoints.ts`

Thin typed wrappers — no tests of their own; covered by the integration tests in Task 14.

- [ ] **Step 1: Implement endpoints**

Create `lib/versature/endpoints.ts`:

```typescript
import { request } from './client'
import type { VersatureCdr, QueueStatsResponse, QueueSplitsResponse, DateWindow } from './types'

const CDR_PAGE_SIZE = 500

export async function* fetchCdrs(window: DateWindow): AsyncIterable<VersatureCdr> {
  let page = 1
  while (true) {
    const rows = await request<VersatureCdr[]>(
      'cdrs',
      `/cdrs/?start_date=${window.start}&end_date=${window.end}&limit=${CDR_PAGE_SIZE}&page=${page}`,
    )
    if (rows.length === 0) return
    for (const row of rows) yield row
    if (rows.length < CDR_PAGE_SIZE) return
    page += 1
  }
}

export async function fetchQueueStats(queueId: string, window: DateWindow): Promise<QueueStatsResponse> {
  return request<QueueStatsResponse>(
    'queue_stats',
    `/call_queues/${queueId}/stats/?start_date=${window.start}&end_date=${window.end}`,
  )
}

export async function fetchQueueSplits(
  queueId: string,
  period: 'day' | 'hour' | 'month',
  window: DateWindow,
): Promise<QueueSplitsResponse> {
  return request<QueueSplitsResponse>(
    'queue_splits',
    `/call_queues/${queueId}/reports/splits/?start_date=${window.start}&end_date=${window.end}&period=${period}`,
  )
}
```

- [ ] **Step 2: Commit**

```
git add lib/versature/endpoints.ts
git commit -m "task-10: typed endpoint wrappers (CDRs/queue stats/splits)"
```

---

## Task 11: Warehouse client (`lib/warehouse/client.ts`)

**Files:**
- Create: `lib/warehouse/client.ts`
- Create: `tests/helpers/test-warehouse.ts`

The warehouse client exposes two type-only surfaces (`WarehouseReader` and `WarehouseWriter`) over a single underlying connection. Test helper provides an in-memory DuckDB factory.

- [ ] **Step 1: Write the test helper**

Create `tests/helpers/test-warehouse.ts`:

```typescript
import { Database } from 'duckdb-async'
import fs from 'node:fs/promises'
import path from 'node:path'
import { NORMALIZE_DNIS_UDF_SQL } from '@/lib/utils/dnis'

export async function makeTestWarehouse(): Promise<Database> {
  const db = await Database.create(':memory:')
  const schemaSql = await fs.readFile(path.join(process.cwd(), 'lib/warehouse/schema.sql'), 'utf8')
  const cleaned = schemaSql.replace(/--.*$/gm, '')
  for (const stmt of cleaned.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await db.exec(stmt + ';')
  }
  await db.exec(NORMALIZE_DNIS_UDF_SQL)
  return db
}
```

- [ ] **Step 2: Implement the warehouse client**

Create `lib/warehouse/client.ts`:

```typescript
import { Database } from 'duckdb-async'
import { NORMALIZE_DNIS_UDF_SQL } from '@/lib/utils/dnis'

export type SnapshotRow = {
  period: 'daily' | 'weekly' | 'monthly'
  period_start: string
  period_end: string
  include_weekends: boolean
  total_incoming: number
  english_calls: number
  french_calls: number
  ai_calls: number
  ai_overflow_calls: number
  total_queue_activity: unknown
  is_finalized: boolean
  computed_at: string
  pull_run_id: string
}

export type PullRunRow = {
  pull_run_id: string
  triggered_by: string
  triggered_at: string
  finished_at: string | null
  status: string
  window_start: string
  window_end: string
  cdr_segments_count: number | null
  queue_stats_count: number | null
  splits_count: number | null
  logical_calls_built: number | null
  snapshots_built: number | null
  error_summary: string | null
  finalized_month: string | null
}

// Read-only surface used by app/ and components/
export interface WarehouseReader {
  getSnapshot(args: { period: SnapshotRow['period']; periodStart: string; includeWeekends: boolean }): Promise<SnapshotRow | null>
  getMostRecentFinalizedDay(): Promise<string | null>
  getLatestSuccessfulPull(): Promise<PullRunRow | null>
  getRecentPullRuns(limit: number): Promise<PullRunRow[]>
  close(): Promise<void>
}

// Write surface used by jobs/ and lib/pipeline/
export interface WarehouseWriter extends WarehouseReader {
  exec(sql: string, params?: unknown[]): Promise<void>
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>
}

export interface OpenWarehouseOpts {
  mode: 'read' | 'write'
}

export async function openWarehouse(opts: OpenWarehouseOpts): Promise<WarehouseWriter> {
  const dbName = process.env.MOTHERDUCK_DATABASE
  if (!dbName) throw new Error('MOTHERDUCK_DATABASE is required')
  const token = opts.mode === 'write'
    ? process.env.MOTHERDUCK_TOKEN_RW
    : process.env.MOTHERDUCK_TOKEN_RO
  if (!token) {
    throw new Error(opts.mode === 'write' ? 'MOTHERDUCK_TOKEN_RW is required' : 'MOTHERDUCK_TOKEN_RO is required')
  }

  const db = await Database.create(`md:${dbName}?motherduck_token=${token}`)
  // Register the normalize_dnis UDF/macro for this connection
  await db.exec(NORMALIZE_DNIS_UDF_SQL)
  return wrap(db)
}

export function wrap(db: Database): WarehouseWriter {
  return {
    async exec(sql, params = []) {
      await db.run(sql, ...params)
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await db.all(sql, ...params)) as T[]
    },
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = (await db.all(sql, ...params)) as T[]
      return rows[0] ?? null
    },
    async getSnapshot({ period, periodStart, includeWeekends }) {
      const rows = await db.all(
        `SELECT * FROM kpi_snapshots
         WHERE period = ? AND period_start = ? AND include_weekends = ?
         LIMIT 1`,
        period, periodStart, includeWeekends,
      )
      return (rows[0] as SnapshotRow | undefined) ?? null
    },
    async getMostRecentFinalizedDay() {
      const rows = await db.all(
        `SELECT period_start FROM kpi_snapshots
         WHERE period = 'daily' AND is_finalized = true
         ORDER BY period_start DESC LIMIT 1`,
      )
      return ((rows[0] as { period_start?: string } | undefined)?.period_start) ?? null
    },
    async getLatestSuccessfulPull() {
      const rows = await db.all(
        `SELECT * FROM pull_runs
         WHERE status = 'success'
         ORDER BY finished_at DESC LIMIT 1`,
      )
      return (rows[0] as PullRunRow | undefined) ?? null
    },
    async getRecentPullRuns(limit) {
      return (await db.all(
        `SELECT * FROM pull_runs ORDER BY triggered_at DESC LIMIT ?`,
        limit,
      )) as PullRunRow[]
    },
    async close() {
      await db.close()
    },
  }
}
```

- [ ] **Step 3: Sanity test — warehouse boots and the schema applies**

Run a quick smoke check (no formal test file yet — Task 13 onwards exercises this through integration tests):

```
node --import tsx -e "
import('./tests/helpers/test-warehouse.ts').then(async ({ makeTestWarehouse }) => {
  const db = await makeTestWarehouse()
  const rows = await db.all('SHOW TABLES')
  console.log(rows.map(r => r.name))
  await db.close()
})
"
```

Expected: `['kpi_snapshots','logical_calls','pull_runs','raw_cdr_segments','raw_queue_splits','raw_queue_stats']` (alphabetical).

- [ ] **Step 4: Commit**

```
git add lib/warehouse/client.ts tests/helpers/test-warehouse.ts
git commit -m "task-11: warehouse client with reader/writer surfaces and UDF registration"
```

---

## Task 12: pull_runs operations (`lib/warehouse/pull-runs.ts`)

**Files:**
- Create: `lib/warehouse/pull-runs.ts`

Helpers used by the orchestrator to open/update/close `pull_runs` rows.

- [ ] **Step 1: Implement pull-runs helpers**

Create `lib/warehouse/pull-runs.ts`:

```typescript
import { ulid } from 'ulid'
import type { WarehouseWriter } from './client'

export type TriggeredBy = 'cron' | 'cron-month-rollover' | 'admin' | 'manual'
export type PullStatus = 'running' | 'success' | 'partial_fetch' | 'partial_build' | 'failed'

export interface OpenRunArgs {
  triggeredBy: TriggeredBy
  windowStart: string
  windowEnd: string
}

export async function openPullRun(w: WarehouseWriter, args: OpenRunArgs): Promise<string> {
  const id = ulid()
  await w.exec(
    `INSERT INTO pull_runs
       (pull_run_id, triggered_by, triggered_at, status, window_start, window_end)
     VALUES (?, ?, now(), 'running', ?, ?)`,
    [id, args.triggeredBy, args.windowStart, args.windowEnd],
  )
  return id
}

export interface CloseRunArgs {
  pullRunId: string
  status: PullStatus
  cdrSegmentsCount?: number
  queueStatsCount?: number
  splitsCount?: number
  logicalCallsBuilt?: number
  snapshotsBuilt?: number
  errorSummary?: string
  finalizedMonth?: string
}

export async function closePullRun(w: WarehouseWriter, args: CloseRunArgs): Promise<void> {
  await w.exec(
    `UPDATE pull_runs SET
       finished_at = now(),
       status = ?,
       cdr_segments_count = ?,
       queue_stats_count = ?,
       splits_count = ?,
       logical_calls_built = ?,
       snapshots_built = ?,
       error_summary = ?,
       finalized_month = ?
     WHERE pull_run_id = ?`,
    [
      args.status,
      args.cdrSegmentsCount ?? null,
      args.queueStatsCount ?? null,
      args.splitsCount ?? null,
      args.logicalCallsBuilt ?? null,
      args.snapshotsBuilt ?? null,
      args.errorSummary ?? null,
      args.finalizedMonth ?? null,
      args.pullRunId,
    ],
  )
}

export async function updatePullRunCounts(
  w: WarehouseWriter,
  pullRunId: string,
  field: 'cdr_segments_count' | 'queue_stats_count' | 'splits_count' | 'logical_calls_built' | 'snapshots_built',
  value: number,
): Promise<void> {
  await w.exec(`UPDATE pull_runs SET ${field} = ? WHERE pull_run_id = ?`, [value, pullRunId])
}
```

- [ ] **Step 2: Commit**

```
git add lib/warehouse/pull-runs.ts
git commit -m "task-12: pull_runs open/update/close helpers"
```

---

## Task 13: Fetch-and-load (`lib/pipeline/fetch-and-load.ts`)

Stages 1, 2, and 3 — bulk loaders for CDRs, queue stats, splits. Each loader uses `INSERT OR REPLACE` against MotherDuck so re-pulls are no-ops.

**Files:**
- Create: `lib/pipeline/fetch-and-load.ts`
- Create: `tests/integration/pull-cdrs.test.ts`
- Create: `tests/integration/pull-queue-stats.test.ts`
- Create: `tests/integration/mutable-segments.test.ts`

- [ ] **Step 1: Implement the loaders**

Create `lib/pipeline/fetch-and-load.ts`:

```typescript
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow, VersatureCdr, QueueStatsResponse, QueueSplitsResponse } from '@/lib/versature/types'
import { fetchCdrs, fetchQueueStats, fetchQueueSplits } from '@/lib/versature/endpoints'
import { eachBusinessDate, toTorontoDate } from '@/lib/utils/dates'
import { log } from '@/lib/utils/logger'

function sourceHash(c: VersatureCdr): string {
  return createHash('sha256')
    .update(`${c.from.call_id}|${c.to.call_id ?? ''}|${c.start_time}`)
    .digest('hex')
}

interface LoadCdrArgs {
  pullRunId: string
  pulledAt: string  // ISO
  window: DateWindow
}

export async function loadCdrs(w: WarehouseWriter, args: LoadCdrArgs): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `cdrs_${args.pullRunId}.ndjson`)
  let count = 0

  // Stream pages directly to a temp NDJSON file
  const lines: string[] = []
  for await (const row of fetchCdrs(args.window)) {
    const flat = {
      source_hash:      sourceHash(row),
      from_call_id:     row.from.call_id,
      to_call_id:       row.to.call_id,
      from_id:          row.from.id,
      from_name:        row.from.name,
      from_user:        row.from.user,
      from_domain:      row.from.domain,
      to_id:            row.to.id,
      to_user:          row.to.user,
      to_domain:        row.to.domain,
      duration_seconds: row.duration,
      start_time:       row.start_time,
      end_time:         row.end_time,
      answer_time:      row.answer_time,
      call_date:        toTorontoDate(row.start_time),
      pulled_at:        args.pulledAt,
      pull_run_id:      args.pullRunId,
    }
    lines.push(JSON.stringify(flat))
    count += 1
  }

  if (count === 0) {
    log.info('loadCdrs: no rows', { window: args.window })
    return 0
  }

  await fs.writeFile(tmpFile, lines.join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_cdr_segments
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})

  log.info('loadCdrs: complete', { window: args.window, count })
  return count
}

export async function loadQueueStats(
  w: WarehouseWriter,
  args: { pullRunId: string; pulledAt: string; window: DateWindow; queueIds: string[] },
): Promise<number> {
  const rows: Array<Record<string, unknown>> = []
  for (const queueId of args.queueIds) {
    for (const date of eachBusinessDate(args.window)) {
      const stats: QueueStatsResponse = await fetchQueueStats(queueId, { start: date, end: date })
      rows.push({
        queue_id:           queueId,
        business_date:      date,
        calls_offered:      Number(stats.calls_offered ?? 0),
        abandoned_calls:    Number(stats.abandoned_calls ?? 0),
        abandoned_rate:     Number(stats.abandoned_rate ?? 0),
        avg_talk_seconds:   Number(stats.average_talk_time ?? 0),
        avg_handle_seconds: Number(stats.average_handle_time ?? 0),
        raw_payload:        JSON.stringify(stats),
        pulled_at:          args.pulledAt,
        pull_run_id:        args.pullRunId,
      })
    }
  }

  if (rows.length === 0) return 0
  const tmpFile = path.join(os.tmpdir(), `queue_stats_${args.pullRunId}.ndjson`)
  await fs.writeFile(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_queue_stats
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})
  return rows.length
}

export async function loadQueueSplits(
  w: WarehouseWriter,
  args: { pullRunId: string; pulledAt: string; window: DateWindow; queueIds: string[] },
): Promise<number> {
  const rows: Array<Record<string, unknown>> = []
  for (const queueId of args.queueIds) {
    for (const period of ['day', 'hour', 'month'] as const) {
      const splits: QueueSplitsResponse = await fetchQueueSplits(queueId, period, args.window)
      // Splits are opaque per-period; flatten to one row per (queue, period, bucket_start).
      // For now, persist a single row keyed at the window start with the full payload — the build
      // tasks (Stage 4 / 5) only consume queue_stats today; split shape is captured for future use.
      rows.push({
        queue_id:     queueId,
        period,
        bucket_start: `${args.window.start}T00:00:00`,
        raw_payload:  JSON.stringify(splits),
        pulled_at:    args.pulledAt,
        pull_run_id:  args.pullRunId,
      })
    }
  }

  if (rows.length === 0) return 0
  const tmpFile = path.join(os.tmpdir(), `queue_splits_${args.pullRunId}.ndjson`)
  await fs.writeFile(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_queue_splits
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})
  return rows.length
}
```

- [ ] **Step 2: Write integration test for CDR loading**

Create `tests/integration/pull-cdrs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { loadCdrs } from '@/lib/pipeline/fetch-and-load'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'

const server = setupServer()

const BASE = 'https://test.versature.com/api'

beforeEach(() => {
  resetLimiter(); resetAuth()
  process.env.VERSATURE_BASE_URL = BASE
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'
  server.listen({ onUnhandledRequest: 'error' })
  server.use(http.post(`${BASE}/oauth/token/`, () => HttpResponse.json({ access_token: 'tok', expires_in: 3600 })))
})

afterEach(() => { server.resetHandlers(); server.close() })

function makeRow(callId: string, startTime: string, toUser: string | null, duration = 60) {
  return {
    duration,
    answer_time: startTime,
    start_time: startTime,
    end_time: startTime,
    from: { call_id: callId, name: null, id: '+15551234567', user: null, domain: null },
    to:   { call_id: 'tcid-' + callId, id: '+16135949199', user: toUser, domain: 'neolore.com' },
  }
}

describe('loadCdrs', () => {
  it('paginates and writes all rows; re-running is a no-op', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => makeRow(`c${i}`, '2026-04-30T12:00:00', '8020'))
    const page2 = Array.from({ length: 200 }, (_, i) => makeRow(`c${500 + i}`, '2026-04-30T13:00:00', '8021'))
    let calls = 0
    server.use(http.get(`${BASE}/cdrs/`, ({ request }) => {
      const u = new URL(request.url)
      const page = Number(u.searchParams.get('page'))
      calls += 1
      return HttpResponse.json(page === 1 ? page1 : page === 2 ? page2 : [])
    }))

    const db = await makeTestWarehouse()
    const w = wrap(db)
    const count = await loadCdrs(w, {
      pullRunId: 'run-1',
      pulledAt: '2026-05-01T08:00:00Z',
      window: { start: '2026-04-30', end: '2026-04-30' },
    })
    expect(count).toBe(700)
    expect(calls).toBe(2)

    const rowCount = (await w.all<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments'))[0].c
    expect(Number(rowCount)).toBe(700)

    // Re-run, expect same count
    await loadCdrs(w, {
      pullRunId: 'run-2',
      pulledAt: '2026-05-01T08:05:00Z',
      window: { start: '2026-04-30', end: '2026-04-30' },
    })
    const rowCount2 = (await w.all<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments'))[0].c
    expect(Number(rowCount2)).toBe(700)
    await db.close()
  })
})
```

- [ ] **Step 3: Run the CDR integration test**

Run: `npm run test:integration -- pull-cdrs`
Expected: passes.

- [ ] **Step 4: Write integration test for mutable segments**

Create `tests/integration/mutable-segments.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { loadCdrs } from '@/lib/pipeline/fetch-and-load'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'

const BASE = 'https://test.versature.com/api'
const server = setupServer()

beforeEach(() => {
  resetLimiter(); resetAuth()
  process.env.VERSATURE_BASE_URL = BASE
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'
  server.listen({ onUnhandledRequest: 'error' })
  server.use(http.post(`${BASE}/oauth/token/`, () => HttpResponse.json({ access_token: 'tok', expires_in: 3600 })))
})

afterEach(() => { server.resetHandlers(); server.close() })

it('updates an existing row in place when duration changes', async () => {
  const baseRow = {
    duration: 60,
    answer_time: '2026-04-30T12:00:00',
    start_time: '2026-04-30T12:00:00',
    end_time:   '2026-04-30T12:01:00',
    from: { call_id: 'c1', name: null, id: '+15551234567', user: null, domain: null },
    to:   { call_id: 'tc1', id: '+16135949199', user: '8020', domain: 'neolore.com' },
  }

  let firstCall = true
  server.use(http.get(`${BASE}/cdrs/`, () => {
    if (firstCall) { firstCall = false; return HttpResponse.json([baseRow]) }
    return HttpResponse.json([{ ...baseRow, duration: 120, end_time: '2026-04-30T12:02:00' }])
  }))

  const db = await makeTestWarehouse()
  const w = wrap(db)

  await loadCdrs(w, { pullRunId: 'run-1', pulledAt: '2026-05-01T08:00:00Z', window: { start: '2026-04-30', end: '2026-04-30' } })
  let dur = (await w.all<{ d: number }>('SELECT duration_seconds as d FROM raw_cdr_segments'))[0].d
  expect(Number(dur)).toBe(60)

  await loadCdrs(w, { pullRunId: 'run-2', pulledAt: '2026-05-01T08:05:00Z', window: { start: '2026-04-30', end: '2026-04-30' } })
  const rows = await w.all<{ d: number; c: number }>('SELECT duration_seconds as d, count(*) as c FROM raw_cdr_segments GROUP BY duration_seconds')
  expect(rows).toHaveLength(1)
  expect(Number(rows[0].d)).toBe(120)

  await db.close()
})
```

- [ ] **Step 5: Run the mutable-segments test**

Run: `npm run test:integration -- mutable-segments`
Expected: passes.

- [ ] **Step 6: Write integration test for queue stats loading**

Create `tests/integration/pull-queue-stats.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { loadQueueStats } from '@/lib/pipeline/fetch-and-load'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'

const BASE = 'https://test.versature.com/api'
const server = setupServer()

beforeEach(() => {
  resetLimiter(); resetAuth()
  process.env.VERSATURE_BASE_URL = BASE
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'
  server.listen({ onUnhandledRequest: 'error' })
  server.use(http.post(`${BASE}/oauth/token/`, () => HttpResponse.json({ access_token: 'tok', expires_in: 3600 })))
})

afterEach(() => { server.resetHandlers(); server.close() })

it('writes 4 queues × N business dates rows; re-pull updates in place', async () => {
  server.use(http.get(`${BASE}/call_queues/:qid/stats/`, ({ params }) => HttpResponse.json({
    calls_offered: params.qid === '8020' ? 100 : 50,
    abandoned_calls: 5, abandoned_rate: 0.05,
    average_talk_time: 120, average_handle_time: 150,
  })))

  const db = await makeTestWarehouse()
  const w = wrap(db)
  // Mon 2026-04-27 to Wed 2026-04-29 = 3 business dates × 4 queues = 12
  const count = await loadQueueStats(w, {
    pullRunId: 'run-1', pulledAt: '2026-05-01T08:00:00Z',
    window: { start: '2026-04-27', end: '2026-04-29' },
    queueIds: ['8020', '8021', '8030', '8031'],
  })
  expect(count).toBe(12)

  // Re-pull with different mock value should update existing rows, not duplicate
  server.use(http.get(`${BASE}/call_queues/:qid/stats/`, () => HttpResponse.json({
    calls_offered: 200, abandoned_calls: 0, abandoned_rate: 0,
    average_talk_time: 100, average_handle_time: 100,
  })))
  await loadQueueStats(w, {
    pullRunId: 'run-2', pulledAt: '2026-05-01T08:05:00Z',
    window: { start: '2026-04-27', end: '2026-04-29' },
    queueIds: ['8020', '8021', '8030', '8031'],
  })
  const total = (await w.all<{ c: number; o: number }>('SELECT count(*) as c, max(calls_offered) as o FROM raw_queue_stats'))[0]
  expect(Number(total.c)).toBe(12)  // no duplicates
  expect(Number(total.o)).toBe(200) // updated value won
  await db.close()
})
```

- [ ] **Step 7: Run all integration tests**

Run: `npm run test:integration`
Expected: all 3 tests pass (`pull-cdrs`, `mutable-segments`, `pull-queue-stats`).

- [ ] **Step 8: Commit**

```
git add lib/pipeline/fetch-and-load.ts tests/integration/pull-cdrs.test.ts tests/integration/mutable-segments.test.ts tests/integration/pull-queue-stats.test.ts
git commit -m "task-13: fetch-and-load Stages 1-3 with integration tests"
```

---

## Task 14: Build logical_calls (`lib/pipeline/build-logical-calls.ts`)

This is the most important file in the pipeline. It groups CDR segments by `from_call_id` and applies the inclusion rule, bucket assignments, and tie-break logic.

**Files:**
- Create: `lib/pipeline/build-logical-calls.ts`
- Create: `tests/unit/build-logical-calls.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/build-logical-calls.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from 'duckdb-async'
import { buildLogicalCalls } from '@/lib/pipeline/build-logical-calls'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

const QUEUES = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }
const TRACKED_DNIS = ['6135949199']

interface SegmentSeed {
  from_call_id: string
  to_user: string | null
  to_id: string | null
  start_time: string
  duration?: number
}

async function seed(db: Database, seeds: SegmentSeed[]) {
  for (const s of seeds) {
    const sourceHash = `${s.from_call_id}|${s.to_user ?? ''}|${s.start_time}`
    await db.run(
      `INSERT INTO raw_cdr_segments (
         source_hash, from_call_id, to_call_id, from_id, from_name, from_user, from_domain,
         to_id, to_user, to_domain, duration_seconds, start_time, end_time, answer_time,
         call_date, pulled_at, pull_run_id
       ) VALUES (?, ?, NULL, '+15551234567', NULL, NULL, NULL, ?, ?, 'neolore.com',
                 ?, ?, ?, ?, '2026-04-30', now(), 'seed-run')`,
      sourceHash, s.from_call_id, s.to_id, s.to_user,
      s.duration ?? 60, s.start_time, s.start_time, s.start_time,
    )
  }
}

beforeEach(() => { /* nothing */ })
afterEach(() => { /* nothing */ })

describe('buildLogicalCalls', () => {
  it('25 distinct from_call_ids across 100 segments → 25 logical calls', async () => {
    const db = await makeTestWarehouse()
    const seeds: SegmentSeed[] = []
    for (let i = 0; i < 25; i++) {
      for (let s = 0; s < 4; s++) {
        seeds.push({
          from_call_id: `c${i}`,
          to_user: s === 0 ? QUEUES.en : '40',
          to_id: '+16135949199',
          start_time: `2026-04-30T12:0${s}:00`,
        })
      }
    }
    await seed(db, seeds)
    const w = wrap(db)
    const built = await buildLogicalCalls(w, {
      pullRunId: 'r1',
      window: { start: '2026-04-30', end: '2026-04-30' },
      queues: QUEUES,
      trackedDnisNormalized: TRACKED_DNIS,
    })
    expect(built).toBe(25)
    const rows = await w.all<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(rows[0].c)).toBe(25)
    await db.close()
  })

  it('English-then-AI call → is_ai_overflow=true, is_english=true', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'cA', to_user: QUEUES.en,    to_id: '+16135949199', start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'cA', to_user: QUEUES.aiEn,  to_id: null,            start_time: '2026-04-30T12:01:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const lc = await w.one<{ is_english: boolean; is_ai: boolean; is_ai_overflow: boolean }>('SELECT * FROM logical_calls WHERE from_call_id = ?', ['cA'])
    expect(lc?.is_english).toBe(true)
    expect(lc?.is_ai).toBe(true)
    expect(lc?.is_ai_overflow).toBe(true)
    await db.close()
  })

  it('AI-only call (no EN/FR) → is_ai=true, is_ai_overflow=false', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'cB', to_user: QUEUES.aiEn, to_id: null, start_time: '2026-04-30T12:00:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const lc = await w.one<{ is_ai: boolean; is_ai_overflow: boolean; is_english: boolean }>('SELECT * FROM logical_calls WHERE from_call_id = ?', ['cB'])
    expect(lc?.is_ai).toBe(true)
    expect(lc?.is_ai_overflow).toBe(false)
    expect(lc?.is_english).toBe(false)
    await db.close()
  })

  it('DNIS in multiple formats are all included', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'd1', to_user: null, to_id: '+16135949199',     start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd2', to_user: null, to_id: '6135949199',       start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd3', to_user: null, to_id: '+1 (613) 594-9199',start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd4', to_user: null, to_id: '613-594-9199',     start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd5', to_user: null, to_id: '6135949198',       start_time: '2026-04-30T12:00:00' }, // NOT included
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const ids = (await w.all<{ from_call_id: string }>('SELECT from_call_id FROM logical_calls ORDER BY from_call_id')).map((r) => r.from_call_id)
    expect(ids).toEqual(['d1', 'd2', 'd3', 'd4'])
    await db.close()
  })

  it('Call with no DNIS and no tracked queue is excluded', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'x1', to_user: '40', to_id: '+15551234567', start_time: '2026-04-30T12:00:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const c = await w.one<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(c?.c)).toBe(0)
    await db.close()
  })

  it('first_tracked_queue is by start_time, not lexicographic queue id', async () => {
    const db = await makeTestWarehouse()
    // FR=8021 (lex > EN=8020) but starts EARLIER → first_tracked_queue should be 8021
    await seed(db, [
      { from_call_id: 'cF', to_user: QUEUES.fr, to_id: '+16135949199', start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'cF', to_user: QUEUES.en, to_id: '+16135949199', start_time: '2026-04-30T12:01:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const lc = await w.one<{ first_tracked_queue: string; is_french: boolean }>('SELECT * FROM logical_calls WHERE from_call_id = ?', ['cF'])
    expect(lc?.first_tracked_queue).toBe(QUEUES.fr)
    expect(lc?.is_french).toBe(true)
    await db.close()
  })

  it('total_duration_seconds is the sum across segments', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'cD', to_user: QUEUES.en, to_id: '+16135949199', start_time: '2026-04-30T12:00:00', duration: 30 },
      { from_call_id: 'cD', to_user: '40',      to_id: null,           start_time: '2026-04-30T12:01:00', duration: 90 },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const lc = await w.one<{ total_duration_seconds: number }>('SELECT * FROM logical_calls WHERE from_call_id = ?', ['cD'])
    expect(Number(lc?.total_duration_seconds)).toBe(120)
    await db.close()
  })

  it('Real-sample fixture matches expected counts (canary)', async () => {
    const ndjson = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.ndjson'), 'utf8')
    const expected = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.expected.json'), 'utf8'))

    const db = await makeTestWarehouse()
    // Bulk-insert sanitized fixtures via the same NDJSON path the production loader uses.
    const tmp = path.join(process.cwd(), 'tests/fixtures/.real-cdr-samples-flat.ndjson')
    const flat = ndjson.split('\n').filter(Boolean).map((line) => {
      const r = JSON.parse(line)
      const sourceHash = require('node:crypto')
        .createHash('sha256').update(`${r.from.call_id}|${r.to.call_id ?? ''}|${r.start_time}`).digest('hex')
      return JSON.stringify({
        source_hash: sourceHash,
        from_call_id: r.from.call_id, to_call_id: r.to.call_id,
        from_id: r.from.id, from_name: r.from.name, from_user: r.from.user, from_domain: r.from.domain,
        to_id: r.to.id, to_user: r.to.user, to_domain: r.to.domain,
        duration_seconds: r.duration, start_time: r.start_time, end_time: r.end_time,
        answer_time: r.answer_time, call_date: r.start_time.slice(0, 10),
        pulled_at: '2026-05-01T08:00:00Z', pull_run_id: 'fixture',
      })
    }).join('\n') + '\n'
    await fs.writeFile(tmp, flat, 'utf8')
    await db.exec(`INSERT INTO raw_cdr_segments SELECT * FROM read_json('${tmp}', format='newline_delimited', auto_detect=true)`)
    await fs.unlink(tmp)

    const w = wrap(db)
    await buildLogicalCalls(w, {
      pullRunId: 'fixture',
      window: { start: '2026-04-30', end: '2026-04-30' },
      queues: QUEUES,
      trackedDnisNormalized: TRACKED_DNIS,
    })
    const counts = await w.one<{ lc: number; en: number; fr: number; ai: number; aiov: number }>(
      `SELECT count(*) as lc,
              count(*) FILTER (WHERE is_english) as en,
              count(*) FILTER (WHERE is_french) as fr,
              count(*) FILTER (WHERE is_ai) as ai,
              count(*) FILTER (WHERE is_ai_overflow) as aiov
       FROM logical_calls`,
    )
    expect(Number(counts?.lc)).toBe(expected.logicalCallCount)
    expect(Number(counts?.en)).toBe(expected.englishCalls)
    expect(Number(counts?.fr)).toBe(expected.frenchCalls)
    expect(Number(counts?.ai)).toBe(expected.aiCalls)
    expect(Number(counts?.aiov)).toBe(expected.aiOverflowCalls)
    await db.close()
  })
})
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm run test:unit -- build-logical-calls`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildLogicalCalls`**

Create `lib/pipeline/build-logical-calls.ts`:

```typescript
import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow } from '@/lib/versature/types'

export interface BuildLogicalCallsArgs {
  pullRunId: string
  window: DateWindow
  queues: { en: string; fr: string; aiEn: string; aiFr: string }
  trackedDnisNormalized: string[]   // pre-normalized 10-digit strings
}

export async function buildLogicalCalls(
  w: WarehouseWriter,
  args: BuildLogicalCallsArgs,
): Promise<number> {
  const { en, fr, aiEn, aiFr } = args.queues
  // Build a SQL list literal from the tracked DNIS strings (already 10-digit, no quoting hazards).
  // For safety: validate each string is exactly 10 digits before substituting.
  for (const d of args.trackedDnisNormalized) {
    if (!/^\d{10}$/.test(d)) {
      throw new Error(`trackedDnisNormalized contains non-canonical entry: ${d}`)
    }
  }
  const dnisList = args.trackedDnisNormalized.map((d) => `'${d}'`).join(',') || `''`

  await w.exec(`DELETE FROM logical_calls WHERE call_date BETWEEN ? AND ?`, [args.window.start, args.window.end])

  await w.exec(`
    INSERT INTO logical_calls
    WITH segments AS (
      SELECT * FROM raw_cdr_segments
      WHERE call_date BETWEEN ? AND ?
    ),
    tracked_touch AS (
      SELECT
        from_call_id,
        list(to_user ORDER BY start_time)
          FILTER (WHERE to_user IN ('${en}','${fr}','${aiEn}','${aiFr}')) AS touched_queues,
        bool_or(to_user IN ('${aiEn}','${aiFr}')) AS touched_ai,
        bool_or(
          normalize_dnis(to_id) IN (${dnisList})
          OR to_user IN ('${en}','${fr}','${aiEn}','${aiFr}')
        ) AS touched_dnis
      FROM segments
      GROUP BY from_call_id
    ),
    first_tracked AS (
      SELECT from_call_id, to_user AS first_tracked_queue
      FROM (
        SELECT from_call_id, to_user,
               row_number() OVER (
                 PARTITION BY from_call_id
                 ORDER BY start_time, source_hash
               ) AS rn
        FROM segments
        WHERE to_user IN ('${en}','${fr}','${aiEn}','${aiFr}')
      )
      WHERE rn = 1
    )
    SELECT
      s.from_call_id,
      date_trunc('day', min(s.start_time))::DATE                        AS call_date,
      any_value(s.from_id ORDER BY s.start_time)                        AS caller_id,
      min(s.start_time)                                                 AS start_time,
      max(s.end_time)                                                   AS end_time,
      sum(s.duration_seconds)                                           AS total_duration_seconds,
      count(*)                                                          AS segment_count,
      any_value(t.touched_dnis)                                         AS touched_dnis,
      any_value(t.touched_queues)                                       AS touched_queues,
      any_value(f.first_tracked_queue)                                  AS first_tracked_queue,
      any_value(t.touched_ai)                                           AS touched_ai,
      any_value(f.first_tracked_queue) = '${en}'                        AS is_english,
      any_value(f.first_tracked_queue) = '${fr}'                        AS is_french,
      any_value(t.touched_ai)                                           AS is_ai,
      any_value(t.touched_ai)
        AND any_value(f.first_tracked_queue) IN ('${en}','${fr}')       AS is_ai_overflow,
      now()                                                             AS rebuilt_at,
      ?                                                                 AS pull_run_id
    FROM segments s
    JOIN tracked_touch t USING (from_call_id)
    LEFT JOIN first_tracked f USING (from_call_id)
    WHERE t.touched_dnis = true
    GROUP BY s.from_call_id
  `, [args.window.start, args.window.end, args.window.start, args.window.end, args.pullRunId])

  const c = await w.one<{ c: number }>(
    `SELECT count(*) as c FROM logical_calls WHERE call_date BETWEEN ? AND ?`,
    [args.window.start, args.window.end],
  )
  return Number(c?.c ?? 0)
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- build-logical-calls`
Expected: 8 tests pass — including the real-sample canary against the Task 0 fixture.

- [ ] **Step 5: Commit**

```
git add lib/pipeline/build-logical-calls.ts tests/unit/build-logical-calls.test.ts
git commit -m "task-14: build-logical-calls Stage 4 with hand-crafted + real-sample tests"
```

---

## Task 15: Build snapshots (`lib/pipeline/build-snapshots.ts`)

Stage 5: rolls up `logical_calls` into daily/weekly/monthly snapshots with update-only-on-change and finalization rules.

**Files:**
- Create: `lib/pipeline/build-snapshots.ts`
- Create: `tests/unit/build-snapshots.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/build-snapshots.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

const QUEUES = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }

async function seedLogical(db: any, rows: Array<{
  from_call_id: string; call_date: string; first_tracked_queue?: string | null;
  is_english?: boolean; is_french?: boolean; is_ai?: boolean; is_ai_overflow?: boolean;
}>) {
  for (const r of rows) {
    await db.run(
      `INSERT INTO logical_calls (
         from_call_id, call_date, caller_id, start_time, end_time, total_duration_seconds,
         segment_count, touched_dnis, touched_queues, first_tracked_queue,
         touched_ai, is_english, is_french, is_ai, is_ai_overflow,
         rebuilt_at, pull_run_id
       ) VALUES (?, ?, '+15551234567', ?, ?, 60, 1, true, [?], ?,
                 ?, ?, ?, ?, ?, now(), 'seed')`,
      r.from_call_id, r.call_date, `${r.call_date}T12:00:00`, `${r.call_date}T12:01:00`,
      r.first_tracked_queue ?? QUEUES.en, r.first_tracked_queue ?? null,
      Boolean(r.is_ai), Boolean(r.is_english), Boolean(r.is_french),
      Boolean(r.is_ai), Boolean(r.is_ai_overflow),
    )
  }
}

async function seedQueueStats(db: any, rows: Array<{ queue_id: string; business_date: string; calls_offered: number }>) {
  for (const r of rows) {
    await db.run(
      `INSERT INTO raw_queue_stats (queue_id, business_date, calls_offered, abandoned_calls, abandoned_rate, avg_talk_seconds, avg_handle_seconds, raw_payload, pulled_at, pull_run_id)
       VALUES (?, ?, ?, 0, 0, 0, 0, '{}', now(), 'seed')`,
      r.queue_id, r.business_date, r.calls_offered,
    )
  }
}

describe('buildSnapshots', () => {
  it('writes a daily snapshot for each affected date with both weekend variants', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [
      { from_call_id: 'a', call_date: '2026-04-30', first_tracked_queue: QUEUES.en, is_english: true },
      { from_call_id: 'b', call_date: '2026-04-30', first_tracked_queue: QUEUES.fr, is_french: true },
    ])
    await seedQueueStats(db, [{ queue_id: '8020', business_date: '2026-04-30', calls_offered: 100 }])
    const w = wrap(db)
    const built = await buildSnapshots(w, {
      pullRunId: 'r1',
      window: { start: '2026-04-30', end: '2026-04-30' },
      forceFinalize: false,
    })
    expect(built).toBeGreaterThanOrEqual(2) // 2 daily rows (weekend variants); weekly + monthly may also write
    const daily = await w.all<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' ORDER BY include_weekends`)
    expect(daily).toHaveLength(2)
    expect(Number(daily[0].total_incoming)).toBe(2)
    expect(Number(daily[0].english_calls)).toBe(1)
    expect(Number(daily[0].french_calls)).toBe(1)
    await db.close()
  })

  it('re-running with no data changes is a strict no-op (computed_at unchanged)', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30', first_tracked_queue: QUEUES.en, is_english: true }])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r1', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false })
    const before = await w.one<{ ca: string; pid: string }>(`SELECT computed_at as ca, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    await new Promise((r) => setTimeout(r, 25))
    await buildSnapshots(w, { pullRunId: 'r2', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false })
    const after = await w.one<{ ca: string; pid: string }>(`SELECT computed_at as ca, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    expect(after?.ca).toBe(before?.ca)
    expect(after?.pid).toBe(before?.pid)
    await db.close()
  })

  it('updates exactly the row whose data changed', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30', first_tracked_queue: QUEUES.en, is_english: true }])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r1', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false })
    // Add one new logical call → daily total goes 1 → 2
    await seedLogical(db, [{ from_call_id: 'b', call_date: '2026-04-30', first_tracked_queue: QUEUES.fr, is_french: true }])
    await buildSnapshots(w, { pullRunId: 'r2', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false })
    const row = await w.one<{ total_incoming: number; pid: string }>(`SELECT total_incoming, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    expect(Number(row?.total_incoming)).toBe(2)
    expect(row?.pid).toBe('r2')
    await db.close()
  })

  it('finalized snapshot is not overwritten without forceFinalize', async () => {
    const db = await makeTestWarehouse()
    // Manually seed a finalized snapshot row that DISAGREES with what the build would compute
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-01', first_tracked_queue: QUEUES.en, is_english: true }])
    await db.run(
      `INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
         total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
         total_queue_activity, is_finalized, computed_at, pull_run_id)
       VALUES ('daily','2026-04-01','2026-04-01',true,
               999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`,
    )
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'rNew', window: { start: '2026-04-01', end: '2026-04-01' }, forceFinalize: false })
    const row = await w.one<{ total_incoming: number; pid: string }>(`SELECT total_incoming, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-01' AND include_weekends=true`)
    expect(Number(row?.total_incoming)).toBe(999)  // unchanged
    expect(row?.pid).toBe('old')
    await db.close()
  })

  it('forceFinalize=true overrides and updates a finalized row', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-01', first_tracked_queue: QUEUES.en, is_english: true }])
    await db.run(
      `INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
         total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
         total_queue_activity, is_finalized, computed_at, pull_run_id)
       VALUES ('daily','2026-04-01','2026-04-01',true,
               999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`,
    )
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'rForce', window: { start: '2026-04-01', end: '2026-04-01' }, forceFinalize: true })
    const row = await w.one<{ total_incoming: number; pid: string }>(`SELECT total_incoming, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-01' AND include_weekends=true`)
    expect(Number(row?.total_incoming)).toBe(1)
    expect(row?.pid).toBe('rForce')
    await db.close()
  })

  it('total_queue_activity JSON is sorted by queue_id deterministically', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30', first_tracked_queue: QUEUES.en, is_english: true }])
    await seedQueueStats(db, [
      { queue_id: '8030', business_date: '2026-04-30', calls_offered: 30 },
      { queue_id: '8020', business_date: '2026-04-30', calls_offered: 20 },
      { queue_id: '8021', business_date: '2026-04-30', calls_offered: 21 },
    ])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false })
    const row = await w.one<{ tqa: string }>(`SELECT total_queue_activity::VARCHAR as tqa FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    // Asserts sorted by k
    expect(row?.tqa).toMatch(/^\[\{"k":"8020"/)
    expect(row?.tqa.indexOf('"8020"')).toBeLessThan(row?.tqa.indexOf('"8021"') ?? -1)
    expect(row?.tqa.indexOf('"8021"')).toBeLessThan(row?.tqa.indexOf('"8030"') ?? -1)
    await db.close()
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm run test:unit -- build-snapshots`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildSnapshots`**

Create `lib/pipeline/build-snapshots.ts`:

```typescript
import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow } from '@/lib/versature/types'
import { eachDate, resolvePeriodEnd, resolvePeriodStart } from '@/lib/utils/dates'
import { parseISO } from 'date-fns'
import { log } from '@/lib/utils/logger'

export interface BuildSnapshotsArgs {
  pullRunId: string
  window: DateWindow
  forceFinalize: boolean
}

export async function buildSnapshots(w: WarehouseWriter, args: BuildSnapshotsArgs): Promise<number> {
  let written = 0
  for (const date of eachDate(args.window.start, args.window.end)) {
    written += await writeDaily(w, date, true,  args.pullRunId, args.forceFinalize)
    written += await writeDaily(w, date, false, args.pullRunId, args.forceFinalize)
  }
  // Compute affected weekly + monthly periods (deduped)
  const weeklyStarts = new Set<string>()
  const monthlyStarts = new Set<string>()
  for (const d of eachDate(args.window.start, args.window.end)) {
    weeklyStarts.add(resolvePeriodStart('weekly', parseISO(d)))
    monthlyStarts.add(resolvePeriodStart('monthly', parseISO(d)))
  }
  for (const ws of weeklyStarts) {
    written += await writeWeekly(w, ws, true,  args.pullRunId, args.forceFinalize)
    written += await writeWeekly(w, ws, false, args.pullRunId, args.forceFinalize)
  }
  for (const ms of monthlyStarts) {
    written += await writeMonthly(w, ms, true,  args.pullRunId, args.forceFinalize)
    written += await writeMonthly(w, ms, false, args.pullRunId, args.forceFinalize)
  }
  return written
}

const SHARED_AGG = `
  count(*)                                                AS total_incoming,
  count(*) FILTER (WHERE is_english)                      AS english_calls,
  count(*) FILTER (WHERE is_french)                       AS french_calls,
  count(*) FILTER (WHERE is_ai)                           AS ai_calls,
  count(*) FILTER (WHERE is_ai_overflow)                  AS ai_overflow_calls
`

const WEEKEND_FILTER = (includeWeekends: boolean) =>
  includeWeekends ? '' : 'AND extract(dow FROM call_date) NOT IN (0, 6)'

async function writeDaily(w: WarehouseWriter, date: string, includeWeekends: boolean, pullRunId: string, forceFinalize: boolean): Promise<number> {
  return upsertSnapshot(w, {
    period: 'daily', periodStart: date, periodEnd: date,
    includeWeekends, pullRunId, forceFinalize,
    aggSql: `
      SELECT ${SHARED_AGG}
      FROM logical_calls
      WHERE call_date = '${date}' ${WEEKEND_FILTER(includeWeekends)}
    `,
    queueActivityWindow: { start: date, end: date },
    finalizedSql: `(DATE '${date}' < current_date - INTERVAL 7 DAY) OR ${forceFinalize}`,
  })
}

async function writeWeekly(w: WarehouseWriter, weekStart: string, includeWeekends: boolean, pullRunId: string, forceFinalize: boolean): Promise<number> {
  const weekEnd = resolvePeriodEnd('weekly', weekStart, includeWeekends)
  return upsertSnapshot(w, {
    period: 'weekly', periodStart: weekStart, periodEnd: weekEnd,
    includeWeekends, pullRunId, forceFinalize,
    aggSql: `
      SELECT ${SHARED_AGG}
      FROM logical_calls
      WHERE call_date BETWEEN '${weekStart}' AND '${weekEnd}' ${WEEKEND_FILTER(includeWeekends)}
    `,
    queueActivityWindow: { start: weekStart, end: weekEnd },
    finalizedSql: `(DATE '${weekEnd}' < current_date - INTERVAL 7 DAY) OR ${forceFinalize}`,
  })
}

async function writeMonthly(w: WarehouseWriter, monthStart: string, includeWeekends: boolean, pullRunId: string, forceFinalize: boolean): Promise<number> {
  const monthEnd = resolvePeriodEnd('monthly', monthStart, includeWeekends)
  return upsertSnapshot(w, {
    period: 'monthly', periodStart: monthStart, periodEnd: monthEnd,
    includeWeekends, pullRunId, forceFinalize,
    aggSql: `
      SELECT ${SHARED_AGG}
      FROM logical_calls
      WHERE call_date BETWEEN '${monthStart}' AND '${monthEnd}' ${WEEKEND_FILTER(includeWeekends)}
    `,
    queueActivityWindow: { start: monthStart, end: monthEnd },
    // Monthly is finalized only by force or by a previous-month rollover at the orchestrator level
    finalizedSql: `${forceFinalize}`,
  })
}

interface UpsertArgs {
  period: 'daily' | 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  includeWeekends: boolean
  pullRunId: string
  forceFinalize: boolean
  aggSql: string
  queueActivityWindow: { start: string; end: string }
  finalizedSql: string
}

async function upsertSnapshot(w: WarehouseWriter, a: UpsertArgs): Promise<number> {
  // Block update if existing row is finalized AND not forcing
  const existing = await w.one<{ is_finalized: boolean }>(
    `SELECT is_finalized FROM kpi_snapshots WHERE period=? AND period_start=? AND include_weekends=?`,
    [a.period, a.periodStart, a.includeWeekends],
  )

  // Compute the candidate
  const candidate = await w.one<any>(`
    WITH agg AS (${a.aggSql}),
    queue_activity AS (
      SELECT to_json(list(struct_pack(k := queue_id, v := calls_offered) ORDER BY queue_id)) AS tqa
      FROM raw_queue_stats
      WHERE business_date BETWEEN '${a.queueActivityWindow.start}' AND '${a.queueActivityWindow.end}'
    )
    SELECT
      a.total_incoming, a.english_calls, a.french_calls, a.ai_calls, a.ai_overflow_calls,
      coalesce(q.tqa, '[]'::JSON) AS total_queue_activity,
      (${a.finalizedSql}) AS is_finalized
    FROM agg a
    CROSS JOIN queue_activity q
  `)

  if (!candidate) return 0

  if (existing?.is_finalized && !a.forceFinalize) {
    log.warn('snapshot finalized — skipping update', { period: a.period, period_start: a.periodStart, include_weekends: a.includeWeekends })
    return 0
  }

  // Update-only-on-change comparison
  const same = await w.one<{ same: boolean }>(`
    SELECT (
      e.total_incoming = ? AND e.english_calls = ? AND e.french_calls = ?
      AND e.ai_calls = ? AND e.ai_overflow_calls = ?
      AND e.total_queue_activity::VARCHAR = ?::VARCHAR
      AND e.is_finalized = ?
    ) AS same
    FROM kpi_snapshots e
    WHERE e.period=? AND e.period_start=? AND e.include_weekends=?
  `, [
    candidate.total_incoming, candidate.english_calls, candidate.french_calls,
    candidate.ai_calls, candidate.ai_overflow_calls,
    JSON.stringify(candidate.total_queue_activity), candidate.is_finalized,
    a.period, a.periodStart, a.includeWeekends,
  ])

  if (same?.same) return 0

  await w.exec(`
    INSERT OR REPLACE INTO kpi_snapshots
      (period, period_start, period_end, include_weekends,
       total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
       total_queue_activity, is_finalized, computed_at, pull_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::JSON, ?, now(), ?)
  `, [
    a.period, a.periodStart, a.periodEnd, a.includeWeekends,
    candidate.total_incoming, candidate.english_calls, candidate.french_calls,
    candidate.ai_calls, candidate.ai_overflow_calls,
    JSON.stringify(candidate.total_queue_activity), candidate.is_finalized,
    a.pullRunId,
  ])
  return 1
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:unit -- build-snapshots`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```
git add lib/pipeline/build-snapshots.ts tests/unit/build-snapshots.test.ts
git commit -m "task-15: build-snapshots Stage 5 with finalization + update-only-on-change"
```

---

## Task 16: Orchestrator (`jobs/run-pull.ts`)

The script that GitHub Actions invokes. Resolves the window from env vars, opens a `pull_runs` row, runs Stages 1–5 with structural gating, and closes the run.

**Files:**
- Create: `jobs/run-pull.ts`
- Create: `tests/integration/full-pipeline.test.ts`
- Create: `tests/integration/partial-failure.test.ts`
- Create: `tests/integration/finalized-immutability.test.ts`

- [ ] **Step 1: Implement the window resolver and orchestrator**

Create `jobs/run-pull.ts`:

```typescript
import { addDays, format, parseISO, startOfMonth, subDays, lastDayOfMonth } from 'date-fns'
import { tz } from '@date-fns/tz'

import { openWarehouse } from '@/lib/warehouse/client'
import { openPullRun, closePullRun, updatePullRunCounts, type TriggeredBy } from '@/lib/warehouse/pull-runs'
import { loadCdrs, loadQueueStats, loadQueueSplits } from '@/lib/pipeline/fetch-and-load'
import { buildLogicalCalls } from '@/lib/pipeline/build-logical-calls'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'
import { normalizeDnisList } from '@/lib/utils/dnis'
import { log } from '@/lib/utils/logger'

const TZ = 'America/Toronto'
const NIGHTLY_CRON = '0 8 * * *'
const MONTHLY_CRON = '30 8 2 * *'

interface ResolvedWindow {
  start: string
  end: string
  triggeredBy: TriggeredBy
  forceFinalize: boolean
}

export function resolveWindow(env: NodeJS.ProcessEnv, now: Date = new Date()): ResolvedWindow {
  const start = env.PULL_WINDOW_START?.trim() || ''
  const end   = env.PULL_WINDOW_END?.trim()   || ''
  const trigger = env.PULL_TRIGGER || ''
  const cron = env.PULL_SCHEDULE_CRON?.trim() || ''
  const force = env.PULL_FORCE_FINALIZE === 'true'

  if (start && end) {
    const triggeredBy: TriggeredBy =
      trigger === 'workflow_dispatch' ? 'manual' :
      trigger === 'repository_dispatch' ? 'admin' :
      'manual'
    return { start, end, triggeredBy, forceFinalize: force }
  }

  if (!cron) {
    throw new Error('Wiring error: PULL_WINDOW_* blank and PULL_SCHEDULE_CRON empty')
  }

  if (cron === MONTHLY_CRON) {
    const today = parseISO(format(now, 'yyyy-MM-dd', { in: tz(TZ) }))
    const prevMonthAny = subDays(startOfMonth(today, { in: tz(TZ) }), 1)
    const ws = format(startOfMonth(prevMonthAny, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
    const we = format(lastDayOfMonth(prevMonthAny, { in: tz(TZ) }),   'yyyy-MM-dd', { in: tz(TZ) })
    return { start: ws, end: we, triggeredBy: 'cron-month-rollover', forceFinalize: true }
  }

  if (cron === NIGHTLY_CRON) {
    const today = parseISO(format(now, 'yyyy-MM-dd', { in: tz(TZ) }))
    const ws = format(subDays(today, 7), 'yyyy-MM-dd')
    const we = format(subDays(today, 1), 'yyyy-MM-dd')
    return { start: ws, end: we, triggeredBy: 'cron', forceFinalize: false }
  }

  throw new Error(`Wiring error: unrecognized PULL_SCHEDULE_CRON value '${cron}'`)
}

async function main() {
  const window = resolveWindow(process.env)
  log.info('pull starting', window)

  const w = await openWarehouse({ mode: 'write' })
  const pullRunId = await openPullRun(w, {
    triggeredBy: window.triggeredBy,
    windowStart: window.start,
    windowEnd: window.end,
  })

  const queues = {
    en: process.env.QUEUE_EN_MAIN!,
    fr: process.env.QUEUE_FR_MAIN!,
    aiEn: process.env.QUEUE_AI_OVERFLOW_EN!,
    aiFr: process.env.QUEUE_AI_OVERFLOW_FR!,
  }
  for (const [k, v] of Object.entries(queues)) {
    if (!v) throw new Error(`Missing env: queue ${k}`)
  }
  const queueIds = [queues.en, queues.fr, queues.aiEn, queues.aiFr]
  const trackedDnisNormalized = normalizeDnisList(process.env.TRACKED_DNIS ?? '')
  if (trackedDnisNormalized.length === 0) throw new Error('TRACKED_DNIS produced no valid normalized values')

  const pulledAt = new Date().toISOString()
  const stages: Record<string, boolean> = {}
  let cdrCount = 0, statsCount = 0, splitsCount = 0, logicalCount = 0, snapsCount = 0
  let errorSummary: string | undefined

  try {
    cdrCount = await loadCdrs(w, { pullRunId, pulledAt, window })
    await updatePullRunCounts(w, pullRunId, 'cdr_segments_count', cdrCount)
    stages[1] = true
  } catch (e: any) { errorSummary = `Stage 1 (CDRs): ${e.message}`; log.error(errorSummary); stages[1] = false }

  try {
    statsCount = await loadQueueStats(w, { pullRunId, pulledAt, window, queueIds })
    await updatePullRunCounts(w, pullRunId, 'queue_stats_count', statsCount)
    stages[2] = true
  } catch (e: any) { errorSummary = (errorSummary ?? '') + ` | Stage 2 (queue stats): ${e.message}`; log.error('Stage 2 failed', { e: e.message }); stages[2] = false }

  try {
    splitsCount = await loadQueueSplits(w, { pullRunId, pulledAt, window, queueIds })
    await updatePullRunCounts(w, pullRunId, 'splits_count', splitsCount)
    stages[3] = true
  } catch (e: any) { errorSummary = (errorSummary ?? '') + ` | Stage 3 (splits): ${e.message}`; log.error('Stage 3 failed', { e: e.message }); stages[3] = false }

  if (!(stages[1] && stages[2] && stages[3])) {
    log.warn('skipping Stages 4-5 due to fetch failure')
    await closePullRun(w, {
      pullRunId, status: 'partial_fetch',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      errorSummary,
    })
    await w.close()
    process.exit(1)
  }

  try {
    logicalCount = await buildLogicalCalls(w, { pullRunId, window, queues, trackedDnisNormalized })
    await updatePullRunCounts(w, pullRunId, 'logical_calls_built', logicalCount)
    stages[4] = true
  } catch (e: any) { errorSummary = `Stage 4 (logical): ${e.message}`; log.error(errorSummary); stages[4] = false }

  if (!stages[4]) {
    await closePullRun(w, {
      pullRunId, status: 'partial_build',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      logicalCallsBuilt: logicalCount, errorSummary,
    })
    await w.close(); process.exit(1)
  }

  try {
    snapsCount = await buildSnapshots(w, { pullRunId, window, forceFinalize: window.forceFinalize })
    await updatePullRunCounts(w, pullRunId, 'snapshots_built', snapsCount)
    stages[5] = true
  } catch (e: any) { errorSummary = `Stage 5 (snapshots): ${e.message}`; log.error(errorSummary); stages[5] = false }

  if (!stages[5]) {
    await closePullRun(w, {
      pullRunId, status: 'partial_build',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      logicalCallsBuilt: logicalCount, snapshotsBuilt: snapsCount, errorSummary,
    })
    await w.close(); process.exit(1)
  }

  const finalizedMonth = window.triggeredBy === 'cron-month-rollover'
    ? window.start.slice(0, 7)
    : undefined

  await closePullRun(w, {
    pullRunId, status: 'success',
    cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
    logicalCallsBuilt: logicalCount, snapshotsBuilt: snapsCount,
    finalizedMonth,
  })
  log.info('pull complete', { pullRunId, cdrCount, statsCount, splitsCount, logicalCount, snapsCount })
  await w.close()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 2: Write the full-pipeline integration test**

Create `tests/integration/full-pipeline.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'
import { openPullRun, closePullRun } from '@/lib/warehouse/pull-runs'
import { loadCdrs, loadQueueStats, loadQueueSplits } from '@/lib/pipeline/fetch-and-load'
import { buildLogicalCalls } from '@/lib/pipeline/build-logical-calls'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'

const BASE = 'https://test.versature.com/api'
const server = setupServer()

beforeEach(() => {
  resetLimiter(); resetAuth()
  process.env.VERSATURE_BASE_URL = BASE
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'
  server.listen({ onUnhandledRequest: 'error' })
  server.use(http.post(`${BASE}/oauth/token/`, () => HttpResponse.json({ access_token: 'tok', expires_in: 3600 })))
})
afterEach(() => { server.resetHandlers(); server.close() })

it('runs the full pipeline and produces a snapshot; re-run is byte-identical', async () => {
  // Fixture: 3 logical calls — one EN, one FR, one EN→AI overflow
  const cdrs = [
    { duration: 60, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cEn', name: null, id: '+15551234567', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8020', domain: 'neolore.com' } },
    { duration: 60, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cFr', name: null, id: '+15551234568', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8021', domain: 'neolore.com' } },
    { duration: 30, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cAi', name: null, id: '+15551234569', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8020', domain: 'neolore.com' } },
    { duration: 30, answer_time: '2026-04-30T12:01:30', start_time: '2026-04-30T12:01:30', end_time: '2026-04-30T12:02:00', from: { call_id: 'cAi', name: null, id: '+15551234569', user: null, domain: null }, to: { call_id: null, id: null,             user: '8030', domain: 'neolore.com' } },
  ]
  server.use(
    http.get(`${BASE}/cdrs/`, ({ request }) => {
      const u = new URL(request.url)
      return HttpResponse.json(Number(u.searchParams.get('page')) === 1 ? cdrs : [])
    }),
    http.get(`${BASE}/call_queues/:qid/stats/`, () => HttpResponse.json({ calls_offered: 1, abandoned_calls: 0, abandoned_rate: 0, average_talk_time: 60, average_handle_time: 60 })),
    http.get(`${BASE}/call_queues/:qid/reports/splits/`, () => HttpResponse.json({})),
  )

  const db = await makeTestWarehouse()
  const w = wrap(db)
  const queues = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }
  const window = { start: '2026-04-30', end: '2026-04-30' }

  // --- run 1 ---
  const pullRunId1 = await openPullRun(w, { triggeredBy: 'manual', windowStart: window.start, windowEnd: window.end })
  await loadCdrs(w, { pullRunId: pullRunId1, pulledAt: '2026-05-01T08:00:00Z', window })
  await loadQueueStats(w, { pullRunId: pullRunId1, pulledAt: '2026-05-01T08:00:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await loadQueueSplits(w, { pullRunId: pullRunId1, pulledAt: '2026-05-01T08:00:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await buildLogicalCalls(w, { pullRunId: pullRunId1, window, queues, trackedDnisNormalized: ['6135949199'] })
  await buildSnapshots(w, { pullRunId: pullRunId1, window, forceFinalize: false })
  await closePullRun(w, { pullRunId: pullRunId1, status: 'success' })

  const snap1 = await w.one<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
  expect(Number(snap1.total_incoming)).toBe(3)
  expect(Number(snap1.english_calls)).toBe(2) // cEn and cAi (first queue is 8020 for both)
  expect(Number(snap1.french_calls)).toBe(1)
  expect(Number(snap1.ai_calls)).toBe(1)
  expect(Number(snap1.ai_overflow_calls)).toBe(1)

  // --- run 2 (no Versature changes) ---
  const pullRunId2 = await openPullRun(w, { triggeredBy: 'manual', windowStart: window.start, windowEnd: window.end })
  await loadCdrs(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window })
  await loadQueueStats(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await loadQueueSplits(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await buildLogicalCalls(w, { pullRunId: pullRunId2, window, queues, trackedDnisNormalized: ['6135949199'] })
  await buildSnapshots(w, { pullRunId: pullRunId2, window, forceFinalize: false })
  await closePullRun(w, { pullRunId: pullRunId2, status: 'success' })

  const snap2 = await w.one<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
  // Update-only-on-change: byte-identical
  expect(snap2.computed_at).toBe(snap1.computed_at)
  expect(snap2.pull_run_id).toBe(snap1.pull_run_id)

  await db.close()
})
```

- [ ] **Step 3: Write the partial-failure integration test**

Create `tests/integration/partial-failure.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'
import { loadCdrs, loadQueueStats } from '@/lib/pipeline/fetch-and-load'

const BASE = 'https://test.versature.com/api'
const server = setupServer()

beforeEach(() => {
  resetLimiter(); resetAuth()
  process.env.VERSATURE_BASE_URL = BASE
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'
  server.listen({ onUnhandledRequest: 'error' })
  server.use(http.post(`${BASE}/oauth/token/`, () => HttpResponse.json({ access_token: 'tok', expires_in: 3600 })))
})
afterEach(() => { server.resetHandlers(); server.close() })

it('Stage 1 succeeds, Stage 2 fails persistently → CDRs are persisted, build stages are skipped (caller responsibility)', async () => {
  server.use(
    http.get(`${BASE}/cdrs/`, () => HttpResponse.json([{
      duration: 60, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00',
      from: { call_id: 'c1', name: null, id: '+15551234567', user: null, domain: null },
      to:   { call_id: null, id: '+16135949199', user: '8020', domain: 'neolore.com' },
    }])),
    http.get(`${BASE}/call_queues/:qid/stats/`, () => new HttpResponse(null, { status: 503 })),
  )
  const db = await makeTestWarehouse()
  const w = wrap(db)
  await loadCdrs(w, { pullRunId: 'r1', pulledAt: '2026-05-01T08:00:00Z', window: { start: '2026-04-30', end: '2026-04-30' } })
  // Confirm CDR row landed
  const cdrCount = await w.one<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments')
  expect(Number(cdrCount?.c)).toBe(1)
  // Stage 2 fails fatally after 5xx retries (~42s); we use a short-circuit by letting the test catch it
  await expect(
    loadQueueStats(w, { pullRunId: 'r1', pulledAt: '2026-05-01T08:00:00Z', window: { start: '2026-04-30', end: '2026-04-30' }, queueIds: ['8020'] })
  ).rejects.toThrow()
  // Critical: snapshot was never written because the orchestrator never called Stage 5
  const snap = await w.one<any>(`SELECT * FROM kpi_snapshots`)
  expect(snap).toBeNull()
  await db.close()
}, 60_000)
```

- [ ] **Step 4: Write the finalized-immutability integration test**

Create `tests/integration/finalized-immutability.test.ts`:

```typescript
import { it, expect } from 'vitest'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'

it('finalized monthly snapshot resists update without forceFinalize; forceFinalize overrides', async () => {
  const db = await makeTestWarehouse()
  // Seed an old logical call + a finalized monthly snapshot that disagrees
  await db.run(`INSERT INTO logical_calls (
    from_call_id, call_date, caller_id, start_time, end_time, total_duration_seconds,
    segment_count, touched_dnis, touched_queues, first_tracked_queue,
    touched_ai, is_english, is_french, is_ai, is_ai_overflow, rebuilt_at, pull_run_id
  ) VALUES ('a','2026-03-15','+15551234567','2026-03-15T12:00:00','2026-03-15T12:01:00',60,1,true,['8020'],'8020',false,true,false,false,false,now(),'seed')`)
  await db.run(`INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
    total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
    total_queue_activity, is_finalized, computed_at, pull_run_id)
    VALUES ('monthly','2026-03-01','2026-03-31',true,
            999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`)
  const w = wrap(db)
  await buildSnapshots(w, { pullRunId: 'rNew', window: { start: '2026-03-15', end: '2026-03-15' }, forceFinalize: false })
  const blocked = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='monthly' AND period_start='2026-03-01' AND include_weekends=true`)
  expect(Number(blocked?.ti)).toBe(999)
  await buildSnapshots(w, { pullRunId: 'rForce', window: { start: '2026-03-15', end: '2026-03-15' }, forceFinalize: true })
  const overridden = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='monthly' AND period_start='2026-03-01' AND include_weekends=true`)
  expect(Number(overridden?.ti)).toBe(1)
  expect(overridden?.pid).toBe('rForce')
  await db.close()
})
```

- [ ] **Step 5: Run all integration tests**

Run: `npm run test:integration`
Expected: all tests pass.

- [ ] **Step 6: End-to-end smoke against your dev MotherDuck (manual)**

Set `PULL_WINDOW_START=2026-04-30 PULL_WINDOW_END=2026-04-30` in `.env.local` (or pass on the CLI).

Run: `npm run pull`
Expected: log lines for each stage; finishes with `pull complete`. Verify in the MotherDuck UI that `kpi_snapshots` has a row for `(daily, 2026-04-30, true)`.

- [ ] **Step 7: Commit**

```
git add jobs/run-pull.ts tests/integration/full-pipeline.test.ts tests/integration/partial-failure.test.ts tests/integration/finalized-immutability.test.ts
git commit -m "task-16: orchestrator + full-pipeline / partial-failure / finalized-immutability tests"
```

---

## Task 17: Failure notifier (`jobs/notify-failure.ts`)

Posts to `ALERT_WEBHOOK_URL` with the latest pull_runs row's error summary and the GH Actions log URL.

**Files:**
- Create: `jobs/notify-failure.ts`

- [ ] **Step 1: Implement notify-failure**

Create `jobs/notify-failure.ts`:

```typescript
import { openWarehouse } from '@/lib/warehouse/client'
import { log } from '@/lib/utils/logger'

async function main() {
  const webhook = process.env.ALERT_WEBHOOK_URL
  const runUrl = process.env.PULL_RUN_LOG_URL ?? '(not provided)'
  if (!webhook) {
    log.warn('ALERT_WEBHOOK_URL not set; skipping notify')
    return
  }

  let summary = '(no recent pull_runs row)'
  try {
    const w = await openWarehouse({ mode: 'write' })
    const recent = await w.one<{ status: string; error_summary: string | null; window_start: string; window_end: string }>(
      `SELECT status, error_summary, window_start, window_end
       FROM pull_runs ORDER BY triggered_at DESC LIMIT 1`,
    )
    if (recent) {
      summary = `status=${recent.status} window=${recent.window_start}..${recent.window_end} error=${recent.error_summary ?? '(none)'}`
    }
    await w.close()
  } catch (e: any) {
    summary = `(could not read pull_runs: ${e.message})`
  }

  const text = `🔴 Versature pull failed\n${summary}\nLog: ${runUrl}`
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch((e) => log.error('notify webhook failed', { e: e.message }))
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Commit**

```
git add jobs/notify-failure.ts
git commit -m "task-17: failure notifier (Slack/Teams webhook)"
```

---

## Task 18: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/pull.yml`
- Create: `.github/workflows/smoke.yml`
- Create: `.github/workflows/missing-run.yml`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: pull.yml**

Create `.github/workflows/pull.yml`:

```yaml
name: pull-versature
on:
  schedule:
    # GH Actions cron is UTC. 08:00 UTC ≈ 04:00 EDT (summer) / 03:00 EST (winter).
    - cron: '0 8 * * *'
    - cron: '30 8 2 * *'
  workflow_dispatch:
    inputs:
      windowStart:    { required: true,  type: string }
      windowEnd:      { required: true,  type: string }
      reason:         { required: false, type: string, default: 'manual' }
      forceFinalize:  { required: false, type: boolean, default: false }
  repository_dispatch:
    types: [admin-pull]
concurrency:
  group: pull-versature
  cancel-in-progress: false
jobs:
  pull:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Run pull
        run: npx tsx jobs/run-pull.ts
        env:
          PULL_WINDOW_START: ${{ github.event.inputs.windowStart || github.event.client_payload.windowStart || '' }}
          PULL_WINDOW_END:   ${{ github.event.inputs.windowEnd   || github.event.client_payload.windowEnd   || '' }}
          PULL_REASON:       ${{ github.event.inputs.reason      || github.event.client_payload.reason      || github.event_name }}
          PULL_FORCE_FINALIZE: ${{ github.event.inputs.forceFinalize || github.event.client_payload.forceFinalize || 'false' }}
          PULL_TRIGGER:      ${{ github.event_name }}
          PULL_SCHEDULE_CRON: ${{ github.event.schedule }}
          VERSATURE_BASE_URL:      ${{ secrets.VERSATURE_BASE_URL }}
          VERSATURE_CLIENT_ID:     ${{ secrets.VERSATURE_CLIENT_ID }}
          VERSATURE_CLIENT_SECRET: ${{ secrets.VERSATURE_CLIENT_SECRET }}
          VERSATURE_API_VERSION:   ${{ vars.VERSATURE_API_VERSION }}
          MOTHERDUCK_TOKEN_RW:     ${{ secrets.MOTHERDUCK_TOKEN_RW }}
          MOTHERDUCK_DATABASE:     ${{ vars.MOTHERDUCK_DATABASE }}
          QUEUE_EN_MAIN:           ${{ vars.QUEUE_EN_MAIN }}
          QUEUE_FR_MAIN:           ${{ vars.QUEUE_FR_MAIN }}
          QUEUE_AI_OVERFLOW_EN:    ${{ vars.QUEUE_AI_OVERFLOW_EN }}
          QUEUE_AI_OVERFLOW_FR:    ${{ vars.QUEUE_AI_OVERFLOW_FR }}
          TRACKED_DNIS:            ${{ vars.TRACKED_DNIS }}
          ALERT_WEBHOOK_URL:       ${{ secrets.ALERT_WEBHOOK_URL }}
      - if: failure()
        name: Notify failure
        run: npx tsx jobs/notify-failure.ts
        env:
          ALERT_WEBHOOK_URL:       ${{ secrets.ALERT_WEBHOOK_URL }}
          PULL_RUN_LOG_URL:        ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          MOTHERDUCK_TOKEN_RW:     ${{ secrets.MOTHERDUCK_TOKEN_RW }}
          MOTHERDUCK_DATABASE:     ${{ vars.MOTHERDUCK_DATABASE }}
```

- [ ] **Step 2: smoke.yml**

Create `.github/workflows/smoke.yml`:

```yaml
name: smoke
on:
  schedule:
    - cron: '0 9 * * *'  # 09:00 UTC daily, 1h after pull.yml's nightly slot
  pull_request:
    paths: ['lib/**', 'jobs/**', 'scripts/**', 'package.json']
jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Reset smoke schema
        run: |
          npx tsx -e "import('duckdb-async').then(async ({Database}) => {
            const db = await Database.create('md:csh_analytics_smoke?motherduck_token=${{ secrets.MOTHERDUCK_TOKEN_SMOKE }}')
            await db.exec('DROP SCHEMA IF EXISTS main CASCADE')
            await db.exec('CREATE SCHEMA main')
            await db.close()
          })"
      - run: npm run db:migrate
        env:
          MOTHERDUCK_TOKEN_RW: ${{ secrets.MOTHERDUCK_TOKEN_SMOKE }}
          MOTHERDUCK_DATABASE: csh_analytics_smoke
      - name: Smoke pull (yesterday)
        run: |
          export PULL_WINDOW_START=$(date -u -d 'yesterday' +%Y-%m-%d)
          export PULL_WINDOW_END=$PULL_WINDOW_START
          npx tsx jobs/run-pull.ts
        env:
          VERSATURE_BASE_URL:      ${{ secrets.VERSATURE_BASE_URL }}
          VERSATURE_CLIENT_ID:     ${{ secrets.VERSATURE_CLIENT_ID }}
          VERSATURE_CLIENT_SECRET: ${{ secrets.VERSATURE_CLIENT_SECRET }}
          VERSATURE_API_VERSION:   ${{ vars.VERSATURE_API_VERSION }}
          MOTHERDUCK_TOKEN_RW:     ${{ secrets.MOTHERDUCK_TOKEN_SMOKE }}
          MOTHERDUCK_DATABASE:     csh_analytics_smoke
          QUEUE_EN_MAIN:           ${{ vars.QUEUE_EN_MAIN }}
          QUEUE_FR_MAIN:           ${{ vars.QUEUE_FR_MAIN }}
          QUEUE_AI_OVERFLOW_EN:    ${{ vars.QUEUE_AI_OVERFLOW_EN }}
          QUEUE_AI_OVERFLOW_FR:    ${{ vars.QUEUE_AI_OVERFLOW_FR }}
          TRACKED_DNIS:            ${{ vars.TRACKED_DNIS }}
      - name: Assert success
        run: |
          npx tsx -e "import('duckdb-async').then(async ({Database}) => {
            const db = await Database.create('md:csh_analytics_smoke?motherduck_token=${{ secrets.MOTHERDUCK_TOKEN_SMOKE }}')
            const rows = await db.all('SELECT * FROM kpi_snapshots LIMIT 1')
            if (rows.length === 0) throw new Error('No snapshot row produced')
            const runs = await db.all(\"SELECT * FROM pull_runs WHERE status='success' ORDER BY finished_at DESC LIMIT 1\")
            if (runs.length === 0) throw new Error('No successful pull_runs row')
            await db.close()
          })"
```

- [ ] **Step 3: missing-run.yml**

Create `.github/workflows/missing-run.yml`:

```yaml
name: missing-nightly-run-check
on:
  schedule:
    - cron: '0 10 * * *'  # 10:00 UTC daily, ~2h after pull.yml's nightly slot
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - name: Check for recent successful nightly pull
        run: |
          npx tsx -e "
          import('duckdb-async').then(async ({Database}) => {
            const db = await Database.create('md:${{ vars.MOTHERDUCK_DATABASE }}?motherduck_token=${{ secrets.MOTHERDUCK_TOKEN_RW }}')
            const rows = await db.all(\"SELECT count(*) as c FROM pull_runs WHERE triggered_by='cron' AND status='success' AND triggered_at > now() - INTERVAL 24 HOUR\")
            await db.close()
            if (Number(rows[0].c) === 0) {
              const r = await fetch('${{ secrets.ALERT_WEBHOOK_URL }}', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ text: '⚠️ No successful nightly Versature pull in the last 24h. Check GitHub Actions.' })
              })
              process.exit(1)
            }
          })"
```

- [ ] **Step 4: ci.yml**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - name: Architectural lint (no Versature in dashboard)
        run: |
          if grep -r -E "(versature|pipeline)" app/ components/ --include='*.ts' --include='*.tsx'; then
            echo "ERROR: dashboard code references versature or pipeline modules"
            exit 1
          fi
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run build
```

- [ ] **Step 5: Commit workflows**

```
git add .github/workflows/
git commit -m "task-18: GitHub Actions workflows (pull, smoke, missing-run, ci)"
```

---

## Task 19: Snapshot read API (`lib/warehouse/snapshots.ts`)

Thin wrapper around `WarehouseReader.getSnapshot` for the dashboard. Caches a connection per request.

**Files:**
- Create: `lib/warehouse/snapshots.ts`
- Create: `tests/unit/snapshots.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/snapshots.test.ts`:

```typescript
import { it, expect } from 'vitest'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

it('getSnapshot returns null for missing rows', async () => {
  const db = await makeTestWarehouse()
  const w = wrap(db)
  const got = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: true })
  expect(got).toBeNull()
  await db.close()
})

it('getSnapshot disambiguates the weekend toggle', async () => {
  const db = await makeTestWarehouse()
  await db.run(`INSERT INTO kpi_snapshots VALUES ('daily','2026-04-30','2026-04-30',true, 10,5,5,0,0,'[]'::JSON,false,now(),'r1')`)
  await db.run(`INSERT INTO kpi_snapshots VALUES ('daily','2026-04-30','2026-04-30',false, 8,4,4,0,0,'[]'::JSON,false,now(),'r1')`)
  const w = wrap(db)
  const inc = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: true })
  const exc = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: false })
  expect(Number(inc?.total_incoming)).toBe(10)
  expect(Number(exc?.total_incoming)).toBe(8)
  await db.close()
})
```

- [ ] **Step 2: Run, confirm pass**

Run: `npm run test:unit -- snapshots`
Expected: 2 tests pass (the methods are already on `WarehouseReader` from Task 11).

- [ ] **Step 3: Implement the dashboard-side wrapper**

Create `lib/warehouse/snapshots.ts`:

```typescript
import { openWarehouse, type SnapshotRow, type PullRunRow } from './client'

let cached: ReturnType<typeof openWarehouse> | null = null

function reader() {
  if (!cached) cached = openWarehouse({ mode: 'read' })
  return cached
}

export async function getSnapshot(args: { period: SnapshotRow['period']; periodStart: string; includeWeekends: boolean }): Promise<SnapshotRow | null> {
  const w = await reader()
  return w.getSnapshot(args)
}

export async function getMostRecentFinalizedDay(): Promise<string | null> {
  const w = await reader()
  return w.getMostRecentFinalizedDay()
}

export async function getLatestSuccessfulPull(): Promise<PullRunRow | null> {
  const w = await reader()
  return w.getLatestSuccessfulPull()
}

export async function getRecentPullRuns(limit: number = 20): Promise<PullRunRow[]> {
  const w = await reader()
  return w.getRecentPullRuns(limit)
}
```

- [ ] **Step 4: Commit**

```
git add lib/warehouse/snapshots.ts tests/unit/snapshots.test.ts
git commit -m "task-19: snapshot read API for dashboard"
```

---

## Task 20: Dashboard root + components

Server-component dashboard. Renders `kpi_snapshots` directly via `getSnapshot`.

**Files:**
- Modify: `app/layout.tsx`
- Replace: `app/page.tsx`
- Create: `components/DashboardView.tsx`
- Create: `components/NotDownloadedYet.tsx`
- Create: `components/KpiCard.tsx`
- Create: `components/PeriodToggle.tsx`
- Create: `components/WeekendToggle.tsx`

- [ ] **Step 1: Update the layout (only change is the title)**

Replace `app/layout.tsx`:

```tsx
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CSH Call Analytics',
  description: 'Versature batch pipeline dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Implement the dashboard root**

Replace `app/page.tsx`:

```tsx
import { getSnapshot, getLatestSuccessfulPull, getMostRecentFinalizedDay } from '@/lib/warehouse/snapshots'
import { resolvePeriodStart, type Period } from '@/lib/utils/dates'
import { DashboardView } from '@/components/DashboardView'
import { NotDownloadedYet } from '@/components/NotDownloadedYet'

interface PageProps {
  searchParams: Promise<{ period?: string; includeWeekends?: string }>
}

export default async function Page({ searchParams }: PageProps) {
  const { period: periodParam, includeWeekends: incParam } = await searchParams
  const period: Period = (periodParam as Period) ?? 'daily'
  const includeWeekends = incParam === 'true'

  const periodStart = resolvePeriodStart(period, new Date())
  const [snapshot, latestPull, finalizedDay] = await Promise.all([
    getSnapshot({ period, periodStart, includeWeekends }),
    getLatestSuccessfulPull(),
    getMostRecentFinalizedDay(),
  ])

  if (!snapshot) {
    return (
      <NotDownloadedYet
        period={period}
        periodStart={periodStart}
        latestPullAt={latestPull?.finished_at ?? null}
        finalizedDay={finalizedDay}
      />
    )
  }

  return (
    <DashboardView
      snapshot={snapshot}
      period={period}
      includeWeekends={includeWeekends}
      latestPullAt={latestPull?.finished_at ?? null}
    />
  )
}
```

- [ ] **Step 3: Implement DashboardView**

Create `components/DashboardView.tsx`:

```tsx
import type { SnapshotRow } from '@/lib/warehouse/client'
import type { Period } from '@/lib/utils/dates'
import { KpiCard } from './KpiCard'
import { PeriodToggle } from './PeriodToggle'
import { WeekendToggle } from './WeekendToggle'

export function DashboardView({
  snapshot, period, includeWeekends, latestPullAt,
}: {
  snapshot: SnapshotRow
  period: Period
  includeWeekends: boolean
  latestPullAt: string | null
}) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CSH Call Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">
            Showing snapshot for {snapshot.period_start} ({snapshot.is_finalized ? 'finalized' : 'provisional'})
            {' · '} pulled {latestPullAt ?? '(unknown)'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PeriodToggle current={period} />
          <WeekendToggle current={includeWeekends} />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard label="Total Incoming"   value={snapshot.total_incoming} />
        <KpiCard label="English"          value={snapshot.english_calls} />
        <KpiCard label="French"           value={snapshot.french_calls} />
        <KpiCard label="AI"               value={snapshot.ai_calls} />
        <KpiCard label="AI Overflow"      value={snapshot.ai_overflow_calls} />
      </section>
    </main>
  )
}
```

- [ ] **Step 4: Implement NotDownloadedYet**

Create `components/NotDownloadedYet.tsx`:

```tsx
import type { Period } from '@/lib/utils/dates'

export function NotDownloadedYet({
  period, periodStart, latestPullAt, finalizedDay,
}: {
  period: Period
  periodStart: string
  latestPullAt: string | null
  finalizedDay: string | null
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-xl font-semibold">Data not downloaded yet</h1>
        <p className="mt-2 text-slate-600">
          We don&apos;t have a snapshot for <strong>{period}</strong> {periodStart} yet.
          The next nightly pull runs at 08:00 UTC (≈03:00–04:00 ET, depending on DST).
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">Last successful pull</dt>
          <dd>{latestPullAt ?? '(none yet)'}</dd>
          <dt className="text-slate-500">Most recent finalized day</dt>
          <dd>{finalizedDay ?? '(none yet)'}</dd>
        </dl>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Implement KpiCard**

Create `components/KpiCard.tsx`:

```tsx
export function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
```

- [ ] **Step 6: Implement PeriodToggle**

Create `components/PeriodToggle.tsx`:

```tsx
import Link from 'next/link'
import type { Period } from '@/lib/utils/dates'

const PERIODS: Period[] = ['daily', 'weekly', 'monthly']

export function PeriodToggle({ current }: { current: Period }) {
  return (
    <div className="flex gap-2 text-sm">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`/?period=${p}`}
          className={p === current ? 'font-semibold underline' : 'text-slate-500'}
        >
          {p[0].toUpperCase() + p.slice(1)}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Implement WeekendToggle**

Create `components/WeekendToggle.tsx`:

```tsx
import Link from 'next/link'

export function WeekendToggle({ current }: { current: boolean }) {
  return (
    <Link
      href={current ? '/?includeWeekends=false' : '/?includeWeekends=true'}
      className="text-xs text-slate-500"
    >
      Include weekends: {current ? 'on' : 'off'}
    </Link>
  )
}
```

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`
Expected: opening `http://localhost:3000` shows either the dashboard (if a snapshot exists) or the "Data not downloaded yet" pane. Toggle Daily/Weekly/Monthly via the period links and verify the URL updates.

- [ ] **Step 9: Commit**

```
git add app/layout.tsx app/page.tsx components/
git commit -m "task-20: dashboard root + components (snapshot reader UI)"
```

---

## Task 21: Admin page + admin pull route

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/api/admin/pull/route.ts`

- [ ] **Step 1: Implement the admin pull API route**

Create `app/api/admin/pull/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { parseISO, isAfter, differenceInDays } from 'date-fns'

const MAX_WINDOW_DAYS = 90

export async function POST(req: Request) {
  const adminToken = process.env.ADMIN_PULL_TOKEN
  const ghToken = process.env.GH_DISPATCH_TOKEN
  const ghRepo = process.env.GH_REPO
  if (!adminToken || !ghToken || !ghRepo) {
    return NextResponse.json({ error: 'admin pull route not configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${adminToken}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { windowStart, windowEnd, reason, forceFinalize } = body as {
    windowStart?: string
    windowEnd?: string
    reason?: string
    forceFinalize?: boolean
  }
  if (!windowStart || !windowEnd) {
    return NextResponse.json({ error: 'windowStart and windowEnd are required' }, { status: 400 })
  }
  const start = parseISO(windowStart)
  const end = parseISO(windowEnd)
  if (isAfter(start, end)) {
    return NextResponse.json({ error: 'windowStart must be <= windowEnd' }, { status: 400 })
  }
  if (isAfter(end, new Date())) {
    return NextResponse.json({ error: 'window cannot include future dates' }, { status: 400 })
  }
  if (differenceInDays(end, start) + 1 > MAX_WINDOW_DAYS) {
    return NextResponse.json({ error: `window exceeds ${MAX_WINDOW_DAYS} days` }, { status: 400 })
  }

  const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'admin-pull',
      client_payload: { windowStart, windowEnd, reason: reason ?? 'admin', forceFinalize: Boolean(forceFinalize) },
    }),
  })

  if (!dispatchRes.ok) {
    const txt = await dispatchRes.text()
    return NextResponse.json({ error: 'GitHub dispatch failed', detail: txt }, { status: 502 })
  }

  return NextResponse.json({ status: 'queued', windowStart, windowEnd, forceFinalize: Boolean(forceFinalize) })
}
```

- [ ] **Step 2: Implement the admin page**

Create `app/admin/page.tsx`:

```tsx
import { getRecentPullRuns } from '@/lib/warehouse/snapshots'
import { redirect } from 'next/navigation'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function AdminPage({ searchParams }: Props) {
  const { token } = await searchParams
  if (!token || token !== process.env.ADMIN_PULL_TOKEN) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-4 text-sm text-slate-600">Append <code>?token=YOUR_ADMIN_PULL_TOKEN</code> to access.</p>
      </main>
    )
  }

  const runs = await getRecentPullRuns(20)

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Admin · Pull Operations</h1>

      <h2 className="mt-8 text-lg font-semibold">Recent pull runs</h2>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="border-b text-left text-slate-500">
          <th className="py-2">Run ID</th><th>Status</th><th>Window</th><th>Trigger</th><th>Counts</th>
        </tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.pull_run_id} className="border-b">
              <td className="py-2 font-mono text-xs">{r.pull_run_id.slice(-8)}</td>
              <td>{r.status}</td>
              <td>{r.window_start} → {r.window_end}</td>
              <td>{r.triggered_by}</td>
              <td className="text-xs">cdr={r.cdr_segments_count} / lc={r.logical_calls_built} / snap={r.snapshots_built}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 text-lg font-semibold">Rebuild a period</h2>
      <p className="mt-2 text-sm text-slate-600">
        Submit via the admin pull route. Use the <code>/api/admin/pull</code> endpoint with a Bearer token (90-day cap).
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-slate-100 p-3 text-xs">{`curl -X POST https://YOUR_DASHBOARD_HOST/api/admin/pull \\
  -H "Authorization: Bearer $ADMIN_PULL_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"windowStart":"2026-04-01","windowEnd":"2026-04-30","reason":"backfill","forceFinalize":false}'`}</pre>
    </main>
  )
}

function redirectIfMissing() { redirect('/admin') }
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, then open `http://localhost:3000/admin?token=YOUR_TOKEN`. Expected: pull-runs table renders.

POST a fake admin pull (using a bad token to confirm 401, then a real token):

```
curl -X POST http://localhost:3000/api/admin/pull -H "Authorization: Bearer wrong" -H "Content-Type: application/json" -d '{"windowStart":"2026-04-01","windowEnd":"2026-04-01"}'
```
Expected: 401.

- [ ] **Step 4: Commit**

```
git add app/admin app/api/admin
git commit -m "task-21: admin page + admin pull route (dispatches GH workflow)"
```

---

## Task 22: Health endpoint (`app/api/health/freshness/route.ts`)

**Files:**
- Create: `app/api/health/freshness/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextResponse } from 'next/server'
import { getMostRecentFinalizedDay } from '@/lib/warehouse/snapshots'
import { differenceInHours, parseISO } from 'date-fns'

export async function GET() {
  const finalized = await getMostRecentFinalizedDay()
  if (!finalized) {
    return NextResponse.json({ mostRecentFinalizedDay: null, age_hours: null })
  }
  const age = differenceInHours(new Date(), parseISO(`${finalized}T00:00:00Z`))
  return NextResponse.json({ mostRecentFinalizedDay: finalized, age_hours: age })
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`, then `curl http://localhost:3000/api/health/freshness`
Expected: a JSON object with `mostRecentFinalizedDay` and `age_hours`.

- [ ] **Step 3: Commit**

```
git add app/api/health
git commit -m "task-22: health/freshness endpoint for external uptime checks"
```

---

## Task 23: ESLint architectural lint

**Files:**
- Create: `eslint.config.mjs`

- [ ] **Step 1: Create the config**

Create `eslint.config.mjs`:

```javascript
import next from 'eslint-config-next'

export default [
  ...next(),
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/lib/versature/*', '@/lib/pipeline/*'],
            message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).' },
          { group: ['**/lib/versature/*', '**/lib/pipeline/*'],
            message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).' },
          { group: ['../**/lib/versature/*', '../**/lib/pipeline/*'],
            message: 'Dashboard code must not import lib/versature or lib/pipeline (architectural rule).' },
        ],
      }],
    },
  },
  {
    files: ['lib/versature/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/lib/warehouse/*', '**/lib/warehouse/*', '../**/lib/warehouse/*'],
            message: 'Versature client must not know about MotherDuck.' },
        ],
      }],
    },
  },
  // Forbid index.ts in lib/versature and lib/pipeline (no barrels)
  {
    files: ['lib/versature/index.ts', 'lib/pipeline/index.ts'],
    rules: {
      'no-restricted-syntax': ['error', { selector: 'ExportAllDeclaration', message: 'No barrel re-exports.' }],
    },
  },
]
```

- [ ] **Step 2: Install eslint-config-next if missing**

Run: `npm install --save-dev eslint eslint-config-next`

- [ ] **Step 3: Verify the lint catches violations**

Add a temporary forbidden import to `app/page.tsx`:

```typescript
import { fetchCdrs } from '@/lib/versature/endpoints'  // should ERROR
```

Run: `npm run lint`
Expected: ERROR — "Dashboard code must not import lib/versature or lib/pipeline".

Remove the forbidden import and re-run; expected: clean.

- [ ] **Step 4: Verify the CI grep gate also catches it**

Add the same forbidden line back, then run: `grep -r -E "(versature|pipeline)" app/ components/ --include='*.ts' --include='*.tsx'`
Expected: matches the line. Remove again.

- [ ] **Step 5: Commit**

```
git add eslint.config.mjs package.json package-lock.json
git commit -m "task-23: architectural ESLint rules + grep-gate enforcement"
```

---

## Task 24: Audit script (`scripts/audit-day.ts`)

**Files:**
- Create: `scripts/audit-day.ts`

- [ ] **Step 1: Implement audit-day**

```typescript
import { openWarehouse } from '@/lib/warehouse/client'

const date = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1]
if (!date) {
  console.error('Usage: npm run audit -- --date=2026-04-30')
  process.exit(1)
}

const w = await openWarehouse({ mode: 'write' })

const counts = await w.one<any>(`
  SELECT count(*) as logical_calls,
         count(*) FILTER (WHERE is_english) as english,
         count(*) FILTER (WHERE is_french) as french,
         count(*) FILTER (WHERE is_ai) as ai,
         count(*) FILTER (WHERE is_ai_overflow) as ai_overflow
  FROM logical_calls WHERE call_date = ?`, [date])

const offered = await w.one<{ total_offered: number }>(`
  SELECT sum(calls_offered) as total_offered
  FROM raw_queue_stats WHERE business_date = ?`, [date])

const samples = await w.all<any>(`
  SELECT from_call_id, caller_id, total_duration_seconds, segment_count,
         first_tracked_queue, is_english, is_french, is_ai, is_ai_overflow
  FROM logical_calls WHERE call_date = ?
  ORDER BY start_time
  LIMIT 5`, [date])

const drift = counts && offered ? ((Number(counts.logical_calls) - Number(offered.total_offered)) / Number(offered.total_offered) * 100) : 0

console.log(`\n=== Audit for ${date} ===\n`)
console.log(`Logical calls:           ${counts?.logical_calls ?? 0}`)
console.log(`  English:               ${counts?.english ?? 0}`)
console.log(`  French:                ${counts?.french ?? 0}`)
console.log(`  AI:                    ${counts?.ai ?? 0}`)
console.log(`  AI Overflow:           ${counts?.ai_overflow ?? 0}`)
console.log(`Sum of calls_offered:    ${offered?.total_offered ?? 0}`)
console.log(`Drift:                   ${drift.toFixed(2)}%\n`)
console.log(`Samples (5 logical calls):`)
for (const s of samples) console.log(`  ${s.from_call_id} caller=${s.caller_id} dur=${s.total_duration_seconds}s segs=${s.segment_count} firstQ=${s.first_tracked_queue} en=${s.is_english} fr=${s.is_french} ai=${s.is_ai} aiov=${s.is_ai_overflow}`)

await w.close()
```

- [ ] **Step 2: Run against a known day**

Run: `npm run audit -- --date=2026-04-30`
Expected: a clean tabular output. Spot-check counts against the Versature web portal — drift should be within ±2%.

- [ ] **Step 3: Commit**

```
git add scripts/audit-day.ts
git commit -m "task-24: audit-day diagnostic script"
```

---

## Task 25: README

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Write the README**

The README is the operator's entry point. It must include: overview, architecture diagram (text), setup, env vars, local dev workflow, scheduled job behavior, common operator tasks, disaster recovery summary. Use the spec's Operational Runbook section as the source — copy the salient parts.

Structure:

```markdown
# CSH Call Analytics

Versature batch pipeline + dashboard. Pulls CDRs and queue stats from Versature nightly into MotherDuck; serves a Next.js dashboard that reads only snapshot rows.

## Architecture
[ASCII diagram from spec architecture overview]

## Setup
[Steps for cloning, env vars, MotherDuck setup, GH secrets]

## Local development
[npm install, db:migrate, dev, pull, audit commands]

## Scheduled jobs
[Nightly + 2nd-of-month + admin/manual triggers; UTC times + DST note]

## Common operator tasks
[From spec Operational Runbook: "Data not downloaded yet", numbers changed, backfill, Versature field change]

## Disaster recovery
[Versature-retention bound; weekly cold-storage export recommendation]

## Tests
[Unit, integration, smoke; CI gates]
```

- [ ] **Step 2: Commit**

```
git add README.md
git commit -m "task-25: operator-facing README"
```

---

## Task 26: End-to-end staging validation (HARD GATE BEFORE CUTOVER)

**Files:** none — this is a validation pass, not code.

- [ ] **Step 1: Configure staging**

Set `MOTHERDUCK_DATABASE=csh_analytics_smoke` in `.env.local`. Apply schema: `npm run db:migrate`.

- [ ] **Step 2: Run a 7-day pull against staging**

Manually set the env vars: `PULL_WINDOW_START=2026-04-23 PULL_WINDOW_END=2026-04-30`, then:

Run: `npm run pull`
Expected: completes in under ~10 minutes; `pull_runs` row has `status='success'`; `kpi_snapshots` has rows for each day, the week, and the month.

- [ ] **Step 3: Run the audit script for one day**

Run: `npm run audit -- --date=2026-04-30`
Expected: drift within ±2% of the Versature web portal's count for the same day.

- [ ] **Step 4: Boot the dashboard against staging**

Set `MOTHERDUCK_TOKEN_RO` to your staging RO token, run `npm run dev`, open `http://localhost:3000`.
Expected: the dashboard renders the snapshot. Toggle Daily/Weekly/Monthly and weekend toggles.

- [ ] **Step 5: Verify "Data not downloaded yet" by querying a fresh date**

Open `http://localhost:3000/?period=daily` for today (which has no snapshot yet).
Expected: the empty-state pane renders with the "Last successful pull" + "Most recent finalized day" lines populated.

- [ ] **Step 6: Trigger an admin pull via curl (locally)**

Confirm `ADMIN_PULL_TOKEN` and `GH_DISPATCH_TOKEN` are set in `.env.local`.

```
curl -X POST http://localhost:3000/api/admin/pull \
  -H "Authorization: Bearer $ADMIN_PULL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"windowStart":"2026-04-30","windowEnd":"2026-04-30","reason":"smoke"}'
```

Expected: response `{"status":"queued","windowStart":"2026-04-30","windowEnd":"2026-04-30","forceFinalize":false}`. Check the GitHub Actions tab and confirm the workflow ran.

- [ ] **Step 7: Re-run the same pull window — verify byte-identity**

Run the same `npm run pull` again with the same window.
Expected: `kpi_snapshots` row's `computed_at` and `pull_run_id` are unchanged (update-only-on-change held).

- [ ] **Step 8: Walk through the operational runbook**

Pretend it's 8 a.m. and you're the on-call operator. Open the README, follow each "Common operator tasks" entry, and verify the steps work as written. Fix any inaccuracies before the cutover decision.

- [ ] **Step 9: Stop. Get explicit stakeholder sign-off**

Production cutover is a separate, explicit decision. Do not promote to production until:
- Audit script output for one historical day matches manual counting from the Versature web portal within ±2%.
- The dashboard renders correctly for snapshot and not-yet-downloaded states.
- ESLint and CI grep gate are green.
- The operator (or stakeholder) confirms via written approval.

```
git commit --allow-empty -m "task-26: staging validation complete; awaiting cutover approval"
```

---
