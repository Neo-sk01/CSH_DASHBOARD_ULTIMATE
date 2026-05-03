# Versature Batch Pipeline Design

Date: 2026-05-02
Project root: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`
Status: Revision 1 — pending implementation planning
Author: Neo Sekaleli

Supersedes:
- `docs/superpowers/specs/2026-04-09-csh-dashboard-part-1-design.md`
- `docs/superpowers/specs/2026-04-12-csh-dashboard-part-1-data-trust-design.md`

The application described here is a **brand-new build**. Earlier specs are archived for context only. Where this spec conflicts with anything in the prior specs, this spec wins.

## Revision history

### Revision 1 — 2026-05-02

Code-review pass against Revision 0 surfaced a set of holes; the following changes harden the design around four invariants:

- **Finalized rows are immutable unless explicitly force-rebuilt.** Monthly finalization moved to a single point (the 2nd of the month, not the 1st *and* the 2nd). Snapshot writes are update-only-on-change with a content-comparison guard. `forceFinalize` is a first-class workflow input that audits the override.
- **Failed pulls never produce valid snapshots.** Stage gating is explicit: Stages 4–5 only run when all of Stages 1–3 succeeded for the same window in the same run. New `partial_fetch` and `partial_build` statuses distinguish what's salvageable.
- **Workflow inputs are mapped and tested end-to-end.** The YAML now wires `inputs.*` and `client_payload.*` into `PULL_WINDOW_*` env vars explicitly, with a CI test asserting the round-trip.
- **All phone/queue/call identity logic is normalization- and fixture-backed.** DNIS comparison is via a `normalize_dnis(s)` UDF and matching TS implementation, not a string-variant list. Logical-call tests use both hand-crafted and sanitized real CDR fixtures from `scripts/inspect-cdr-shape.mjs`.

Other changes in Revision 1:
- Cron schedule and DST behavior documented explicitly (UTC scheduling with documented local-time drift).
- Smoke test runs against an isolated `csh_analytics_smoke` MotherDuck database with a full schema reset between runs.
- `MOTHERDUCK_TOKEN` split into `MOTHERDUCK_TOKEN_RW` (job), `MOTHERDUCK_TOKEN_RO` (dashboard), and `MOTHERDUCK_TOKEN_SMOKE` (smoke job) to prevent cross-deployment of write privileges.
- Architectural lint hardened with barrel-file ban, alias coverage, and a CI grep gate.
- Disaster recovery rewritten to honor Versature's retention window as the hard upper bound on raw replay; weekly cold-storage snapshot export added as a recommended mitigation.
- Task 0 verification list extended with hard pass/fail criteria for `from_call_id` uniqueness, DNIS normalization coverage, and segment timestamp tie-breaking.
- `total_queue_activity` JSON construction switched to `LIST(struct_pack(...) ORDER BY queue_id)` for deterministic key order.
- Tie-break for `first_tracked_queue` documented and added to the SQL: `ORDER BY start_time, source_hash`.



## Goal

Replace the current Versature integration model — where the dashboard pulls live data from Versature on page load — with a reliable scheduled batch pipeline that:

1. Pulls Versature CDRs, queue stats, and split reports nightly under documented rate limits.
2. Stores raw data, builds logical calls grouped by `from.call_id`, and writes dashboard KPI snapshots into MotherDuck.
3. Lets the dashboard read only `kpi_snapshots` — no live Versature calls anywhere in the dashboard request path.

The output is a dashboard whose normal page renders are a single keyed lookup against a snapshot row, plus a job runner that owns every byte of communication with Versature.

## Non-Negotiables

These rules are load-bearing for the whole system. They are tested in code, enforced in CI, and documented in the operational runbook.

1. **Raw CDR count is not call count.** A real-world call can produce 3–5+ CDR segments across auto attendants, queues, and extensions. KPI counts come from `logical_calls`, never from raw CDR row counts.
2. **The dashboard never calls Versature.** No `fetch` to Versature anywhere under `app/` or `components/`. Enforced by ESLint `no-restricted-imports` and verified in CI.
3. **All writes to the warehouse are idempotent.** Re-running the same pull window produces the same warehouse state.
4. **Snapshot finalization is explicit.** The dashboard knows whether a number is still subject to change (`is_finalized = false`) or is permanent (`is_finalized = true`).
5. **One source of truth for queues.** Queue ID → role mapping is configured via env vars, not hardcoded.

## Tenant-Specific Facts (Verified)

These were established by `scripts/inspect-cdr-shape.mjs` on 2026-04-12 and recorded in `docs/versature-cdr-shape.md`. Repeated here because the design depends on them.

- **CDR endpoint:** `GET /cdrs/` (the `/cdrs/users/` endpoint returns 0 rows on this tenant).
- **CDR pagination:** offset pagination via `limit` and `page` query parameters. Response is a flat JSON array. There is no `cursor` or `more` field.
- **CDR shape:** six top-level fields per row — `duration`, `answer_time`, `start_time`, `end_time`, `from { call_id, name, id, user, domain }`, `to { call_id, id, user, domain }`. No top-level `id`, no `call_type`.
- **Shared call identifier:** `from.call_id` reliably groups segments belonging to the same originating call.
- **Versature API version:** `application/vnd.integrate.v1.10.0+json`.
- **Queue-touch inference:** a CDR segment "touches queue X" when `to.user = 'X'`. (Queues are SIP extensions in Net2Phone.) This assumption must be re-verified against a real day before pipeline build-out begins; see Open Questions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions                                              │
│  - schedule:           08:00 UTC nightly (≈03–04 ET, DST drift) │
│  - schedule:           08:30 UTC on the 2nd of each month       │
│  - workflow_dispatch:  manual via UI                         │
│  - repository_dispatch: from /api/admin/pull (admin action)  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  jobs/run-pull.ts  (single Node script, all triggers)       │
│                                                              │
│   lib/versature/   — auth, rate-limited client, retry        │
│   lib/pipeline/    — fetch → load → build logical → snapshot │
│   lib/warehouse/   — MotherDuck client, bulk loaders         │
└──────────────────────────┬──────────────────────────────────┘
                           │  (HTTPS + bearer auth)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  MotherDuck  (`csh_analytics`)                               │
│   raw_cdr_segments    raw_queue_stats    raw_queue_splits    │
│   logical_calls       kpi_snapshots      pull_runs           │
└──────────────────────────▲──────────────────────────────────┘
                           │  (read-only token)
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  Next.js dashboard  (Vercel)                                 │
│   /                — reads kpi_snapshots only                │
│   /admin           — reads pull_runs, queues admin pulls     │
│   /api/admin/pull  — admin-only: dispatches GH workflow      │
└─────────────────────────────────────────────────────────────┘
```

### Component boundaries

- **`jobs/run-pull.ts`** — entry point invoked by GitHub Actions. Accepts a date window via env vars. Orchestrates the seven pipeline stages (open + 5 work + close). Always exits with a `pull_runs` row written, even on failure.
- **`lib/versature/auth.ts`** — OAuth client-credentials token cache. Refreshes 60s before the 1-hour expiry.
- **`lib/versature/rate-limiter.ts`** — endpoint-aware sliding window: 12/min for CDRs, 24/min for queue stats, 12/min for splits, plus per-endpoint sub-second floors (200ms for CDRs, 100ms for queue stats).
- **`lib/versature/client.ts`** — wraps `fetch`. Handles 401 (refresh + retry once), 429 (`Retry-After`-aware, 30s default, 3 retries), 5xx (exponential backoff 2s/8s/32s, 3 retries).
- **`lib/versature/endpoints.ts`** — typed wrappers for `/cdrs/`, `/call_queues/{id}/stats/`, `/call_queues/{id}/reports/splits/`. CDRs is an `AsyncIterable` for streaming pagination.
- **`lib/pipeline/fetch-and-load.ts`** — buffers pages, bulk-loads to MotherDuck via `read_json` or `read_parquet`. No row-by-row inserts.
- **`lib/pipeline/build-logical-calls.ts`** — pure DuckDB SQL. Idempotent `DELETE` + `INSERT` for the affected `call_date` window.
- **`lib/pipeline/build-snapshots.ts`** — pure DuckDB SQL. Recomputes daily, weekly, and monthly snapshots for affected dates.
- **`lib/warehouse/client.ts`** — thin MotherDuck wrapper. Two surfaces: `WarehouseReader` (read-only methods, used by `app/`) and `WarehouseWriter` (write methods, used by `lib/pipeline/`).
- **`app/`** — Next.js server components query MotherDuck directly via `WarehouseReader`. The only API route that touches anything operational is `/api/admin/pull`, which fires a GitHub `repository_dispatch` and never touches Versature.

### Why this shape

- **One process, one log, one `pull_runs` row** — the script either finishes or it doesn't.
- **Strict layer boundaries** — Versature lives in `lib/versature/`; nothing else imports `fetch` against Versature. The dashboard never imports anything under `lib/versature/` or `lib/pipeline/`.
- **MotherDuck does the heavy joining** — logical-call building and snapshot rollups are SQL, not TypeScript. Cheap, fast, re-runnable.
- **Admin "Rebuild period" never runs inline** — it enqueues a workflow run and returns immediately.

## Data Model (MotherDuck schemas)

All tables live in a single MotherDuck database (`csh_analytics`).

### `raw_cdr_segments`

One row per CDR segment from `/cdrs/`. Append-or-replace, idempotent on `source_hash`.

```sql
CREATE TABLE IF NOT EXISTS raw_cdr_segments (
  source_hash       VARCHAR PRIMARY KEY,   -- sha256(from_call_id || coalesce(to_call_id,'') || start_time)
  from_call_id      VARCHAR NOT NULL,
  to_call_id        VARCHAR,
  from_id           VARCHAR,               -- caller E.164 / extension
  from_name         VARCHAR,
  from_user         VARCHAR,
  from_domain       VARCHAR,
  to_id             VARCHAR,               -- destination E.164 / extension / null
  to_user           VARCHAR,               -- the SIP extension; matches queue IDs (e.g. "8020")
  to_domain         VARCHAR,
  duration_seconds  INTEGER NOT NULL,
  start_time        TIMESTAMP NOT NULL,    -- as returned, treated as Toronto-local
  end_time          TIMESTAMP NOT NULL,
  answer_time       TIMESTAMP,             -- nullable
  call_date         DATE NOT NULL,         -- DATE(start_time AT TIME ZONE 'America/Toronto')
  pulled_at         TIMESTAMP NOT NULL,
  pull_run_id       VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_segments_call_date ON raw_cdr_segments(call_date);
CREATE INDEX IF NOT EXISTS idx_raw_cdr_segments_from_call_id ON raw_cdr_segments(from_call_id);
```

A schema comment warns that `source_hash` is sensitive to payload-shape changes.

### `raw_queue_stats`

One row per `(queue_id, business_date)`.

```sql
CREATE TABLE IF NOT EXISTS raw_queue_stats (
  queue_id           VARCHAR NOT NULL,
  business_date      DATE NOT NULL,
  calls_offered      INTEGER,
  abandoned_calls    INTEGER,
  abandoned_rate     DOUBLE,
  avg_talk_seconds   DOUBLE,
  avg_handle_seconds DOUBLE,
  raw_payload        JSON,
  pulled_at          TIMESTAMP NOT NULL,
  pull_run_id        VARCHAR NOT NULL,
  PRIMARY KEY (queue_id, business_date)
);
```

### `raw_queue_splits`

One row per `(queue_id, period, bucket_start)`. `period` is `'day'`, `'hour'`, or `'month'`.

```sql
CREATE TABLE IF NOT EXISTS raw_queue_splits (
  queue_id       VARCHAR NOT NULL,
  period         VARCHAR NOT NULL,
  bucket_start   TIMESTAMP NOT NULL,
  raw_payload    JSON NOT NULL,
  pulled_at      TIMESTAMP NOT NULL,
  pull_run_id    VARCHAR NOT NULL,
  PRIMARY KEY (queue_id, period, bucket_start)
);
```

### `logical_calls`

Derived from `raw_cdr_segments`. One row per `from_call_id`. Rebuilt for affected `call_date` ranges on every pull.

```sql
CREATE TABLE IF NOT EXISTS logical_calls (
  from_call_id            VARCHAR PRIMARY KEY,
  call_date               DATE NOT NULL,
  caller_id               VARCHAR,                 -- from_id of the earliest segment
  start_time              TIMESTAMP NOT NULL,      -- min(start_time)
  end_time                TIMESTAMP NOT NULL,      -- max(end_time)
  total_duration_seconds  INTEGER NOT NULL,        -- sum(duration_seconds) across segments
  segment_count           INTEGER NOT NULL,
  touched_dnis            BOOLEAN NOT NULL,
  touched_queues          VARCHAR[],               -- ordered tracked-queue IDs touched
  first_tracked_queue     VARCHAR,                 -- earliest tracked queue, by start_time
  touched_ai              BOOLEAN NOT NULL,
  is_english              BOOLEAN NOT NULL,
  is_french               BOOLEAN NOT NULL,
  is_ai                   BOOLEAN NOT NULL,
  is_ai_overflow          BOOLEAN NOT NULL,
  rebuilt_at              TIMESTAMP NOT NULL,
  pull_run_id             VARCHAR NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logical_calls_call_date ON logical_calls(call_date);
```

**Inclusion rule** (logical, not literal SQL — the actual SQL form is in Stage 4). A `from_call_id` becomes a `logical_calls` row only if any of its segments satisfies:

- `normalize_dnis(to_id)` matches any value in the pre-normalized tracked-DNIS list, OR
- `to_user IN ($QUEUE_EN_MAIN, $QUEUE_FR_MAIN, $QUEUE_AI_OVERFLOW_EN, $QUEUE_AI_OVERFLOW_FR)`

The tracked-DNIS list is normalized once at job startup (in TypeScript via `lib/utils/dnis.ts`) and passed to the SQL as a literal array bound parameter — so the SQL only sees pre-canonicalized 10-digit strings. Concretely the Stage 4 SQL is `normalize_dnis(to_id) IN ($TRACKED_DNIS_NORMALIZED)` where `$TRACKED_DNIS_NORMALIZED` is the bound array `['6135949199', ...]`.

**DNIS normalization.** Instead of enumerating string variants (`+16135949199`, `16135949199`, `6135949199`, `+1 (613) 594-9199`, ...), we normalize to a canonical 10-digit form before comparison. The `normalize_dnis(s)` function:

1. Strips all non-digit characters (`+`, spaces, parentheses, dashes, etc.).
2. Drops a leading `1` if the result has 11 digits (US/Canada country code).
3. Returns the resulting 10-digit string, or `NULL` if the input doesn't yield 10 digits.

So all of these inputs normalize to `6135949199`:
- `+16135949199`
- `16135949199`
- `6135949199`
- `+1 (613) 594-9199`
- `613-594-9199`
- `613.594.9199`

The function is implemented as a DuckDB scalar UDF (registered at connection time in `lib/warehouse/client.ts`) so it works in both pipeline SQL and ad-hoc queries. Equivalent TypeScript implementation is exported from `lib/utils/dnis.ts` for use in tests and any non-SQL code paths.

`TRACKED_DNIS` is the comma-separated env var of canonical-or-raw DNIS values; values are normalized at job startup. Adding a new tracked DNIS is an env var change with no code deploy.

**Test fixtures must include format variants.** `tests/unit/build-logical-calls.test.ts` includes a fixture row per format above and asserts inclusion. A new test asserts that a DNIS that normalizes to a different number (e.g. `6135949198`) is excluded.

**Bucket assignment.**

- `is_english` — `first_tracked_queue = $QUEUE_EN_MAIN`
- `is_french` — `first_tracked_queue = $QUEUE_FR_MAIN`
- `is_ai` — `touched_ai` (the call touched `$QUEUE_AI_OVERFLOW_EN` or `$QUEUE_AI_OVERFLOW_FR` at any point)
- `is_ai_overflow` — `touched_ai AND first_tracked_queue IN ($QUEUE_EN_MAIN, $QUEUE_FR_MAIN)`

`first_tracked_queue` is the queue from the segment with the **earliest `start_time`** whose `to_user` is in the tracked-queue set. When two such segments share the same `start_time`, the deterministic secondary sort key is `source_hash` (alphanumeric, ascending). This guarantees the same `first_tracked_queue` value across reruns regardless of how Versature pages happen to arrive.

### `kpi_snapshots`

One row per `(period, period_start, include_weekends)`. The dashboard reads this and only this.

```sql
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  period               VARCHAR NOT NULL,    -- 'daily' | 'weekly' | 'monthly'
  period_start         DATE NOT NULL,       -- daily=date; weekly=Monday; monthly=1st
  period_end           DATE NOT NULL,
  include_weekends     BOOLEAN NOT NULL,

  total_incoming       INTEGER NOT NULL,
  english_calls        INTEGER NOT NULL,
  french_calls         INTEGER NOT NULL,
  ai_calls             INTEGER NOT NULL,
  ai_overflow_calls    INTEGER NOT NULL,

  total_queue_activity JSON NOT NULL,       -- [{"k":"8020","v":offered},{"k":"8021","v":...},...] sorted by k; for reconciliation

  is_finalized         BOOLEAN NOT NULL,
  computed_at          TIMESTAMP NOT NULL,
  pull_run_id          VARCHAR NOT NULL,
  PRIMARY KEY (period, period_start, include_weekends)
);
```

Two snapshot rows are written for each period: one with `include_weekends = false` (default) and one with `true`.

### `pull_runs`

Append-only operational log. Written at run start (`status='running'`), updated at run end.

```sql
CREATE TABLE IF NOT EXISTS pull_runs (
  pull_run_id         VARCHAR PRIMARY KEY,    -- ULID
  triggered_by        VARCHAR NOT NULL,       -- 'cron' | 'cron-month-rollover' | 'admin' | 'manual'
  triggered_at        TIMESTAMP NOT NULL,
  finished_at         TIMESTAMP,
  status              VARCHAR NOT NULL,       -- 'running' | 'success' | 'partial_fetch' | 'partial_build' | 'failed'
  window_start        DATE NOT NULL,
  window_end          DATE NOT NULL,
  cdr_segments_count  INTEGER,
  queue_stats_count   INTEGER,
  splits_count        INTEGER,
  logical_calls_built INTEGER,
  snapshots_built     INTEGER,
  error_summary       VARCHAR,                -- one-line; full trace in GH Actions log
  finalized_month     VARCHAR                 -- e.g. '2026-04' if this run finalized a month
);
```

### Idempotency contract

The contract has two tiers: **raw and logical** are content-replaced (same input → same content, with metadata churn), and **snapshots** are content-compared (same input → strict byte identity, no churn).

| Stage | Re-pull behavior | Mechanism | Identity guarantee |
|---|---|---|---|
| 1: CDRs | Same window → same rows | `INSERT OR REPLACE` on `source_hash` | Data identical; `pulled_at`, `pull_run_id` updated |
| 2: queue stats | Same window → same rows | `INSERT OR REPLACE` on `(queue_id, business_date)` | Data identical; `pulled_at`, `pull_run_id` updated |
| 3: splits | Same window → same rows | `INSERT OR REPLACE` on `(queue_id, period, bucket_start)` | Data identical; `pulled_at`, `pull_run_id` updated |
| 4: logical | `DELETE` then `INSERT` for affected `call_date` range | Single transaction | Data identical; `rebuilt_at`, `pull_run_id` updated |
| 5: snapshots | Update-only-on-change (compare data columns, write only if differ) | See Stage 5 SQL | **Strict byte identity** when data unchanged — including `computed_at` and `pull_run_id` |
| 6: pull_runs | Append-only — every run gets a fresh `pull_run_id` | ULID | New row per run by design |

The dashboard reads only `kpi_snapshots`. Stage 5's strict byte identity guarantee means the dashboard sees zero-noise re-runs: the same period rendered before and after a redundant nightly run is bit-for-bit the same row.

The intermediate tables (raw, logical) churn metadata on every successful pull. That's intentional — it lets operators audit "when was this last pulled" without compromising the dashboard's stability guarantee.

## Versature Client

### Auth

```ts
type CachedToken = { accessToken: string; expiresAt: number };
let cached: CachedToken | null = null;

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  cached = await fetchNewToken();
  return cached.accessToken;
}
```

Tokens valid ~1h. Refresh 60s before expiry. The 401 path in the HTTP client clears the cache and retries once.

### Rate limiter

Per-endpoint sliding window over the last 60 seconds, plus a per-endpoint minimum interval enforcing the sub-second floor.

```ts
const BUDGETS = {
  cdrs:         { perMinute: 12, minIntervalMs: 200 },  // docs say 5/s, 15/min
  queue_stats:  { perMinute: 24, minIntervalMs: 100 },  // docs say 10/s, 30/min
  queue_splits: { perMinute: 12, minIntervalMs: 200 },  // conservative; docs unclear
};
```

One process, one in-memory limiter. No distributed coordination — there is only ever one job runner.

### HTTP client

Every Versature call goes through `request(endpoint, path, init)`:

- **401**: invalidate cached token, refresh, retry once. Further 401s are fatal.
- **429**: honor `Retry-After` (default 30s if absent), retry up to 3 times.
- **5xx and network errors**: exponential backoff `2s → 8s → 32s`, retry up to 3 times.
- **Other 4xx**: throw immediately. The caller decides whether to log-and-continue or abort.

### Endpoint wrappers

```ts
export async function* fetchCdrs(window: { start: string; end: string }) {
  let page = 1;
  while (true) {
    const rows = await request<VersatureCdr[]>(
      'cdrs',
      `/cdrs/?start_date=${window.start}&end_date=${window.end}&limit=500&page=${page}`,
    );
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    if (rows.length < 500) return;
    page += 1;
  }
}

export async function fetchQueueStats(queueId: string, window) { /* one request, one response */ }
export async function fetchQueueSplits(queueId, period, window) { /* one request, one response */ }
```

Pagination notes:
- **CDRs**: offset pagination via `limit`+`page`. Pull `limit=500`; stop when a page returns fewer than `limit` rows.
- **Queue stats** and **splits**: a single response covers the window per call. No pagination.

## Pipeline Stages

```
Stage 0: open pull_run
Stage 1: fetch CDRs        → raw_cdr_segments
Stage 2: fetch queue stats → raw_queue_stats
Stage 3: fetch splits      → raw_queue_splits
Stage 4: build logical_calls (SQL, idempotent)
Stage 5: build kpi_snapshots (SQL, idempotent)
Stage 6: close pull_run
```

State is committed to MotherDuck after each stage. A failure mid-run leaves the warehouse consistent for the stages that did finish.

### Stage 0 — open the run

```ts
const pullRunId = ulid();
await md.run(
  `INSERT INTO pull_runs (pull_run_id, triggered_by, triggered_at, status, window_start, window_end)
   VALUES (?, ?, now(), 'running', ?, ?)`,
  [pullRunId, triggeredBy, window.start, window.end],
);
```

### Stage 1 — CDRs → `raw_cdr_segments`

Stream pages from `fetchCdrs(window)` into a buffer, then bulk-load:

```sql
INSERT OR REPLACE INTO raw_cdr_segments
SELECT
  sha256(from_call_id || coalesce(to_call_id, '') || start_time::VARCHAR) AS source_hash,
  /* ...flattened columns... */
  ?::TIMESTAMP AS pulled_at,
  ?           AS pull_run_id
FROM read_json('/tmp/cdrs_<run>.json', auto_detect=true);
```

For very large windows (e.g. month re-pull), stream pages to a Parquet file via DuckDB Appender + `COPY ... TO ... (FORMAT PARQUET)`, then `INSERT OR REPLACE FROM read_parquet(...)`.

### Stage 2 — queue stats → `raw_queue_stats`

For each tracked queue × business date in the window:

```ts
for (const queueId of trackedQueueIds) {
  for (const date of eachBusinessDate(window)) {
    const stats = await fetchQueueStats(queueId, { start: date, end: date });
    rows.push({ queue_id: queueId, business_date: date, ...flatten(stats), raw_payload: stats });
  }
}
await loadQueueStats(rows, pullRunId);
```

Per-day fetches keep one row per `(queue, date)`. 4 queues × 7 days ≈ 28 requests at 24/min ≈ ~70s.

### Stage 3 — splits → `raw_queue_splits`

For each tracked queue × period in `{day, hour, month}`:

```ts
for (const queueId of trackedQueueIds) {
  for (const period of ['day', 'hour', 'month'] as const) {
    const splits = await fetchQueueSplits(queueId, period, window);
    rows.push(...flattenSplits(queueId, period, splits, pullRunId));
  }
}
await loadSplits(rows, pullRunId);
```

4 queues × 3 periods ≈ 12 requests at 12/min ≈ ~60s.

### Stage 4 — build `logical_calls`

```sql
DELETE FROM logical_calls WHERE call_date BETWEEN ? AND ?;

INSERT INTO logical_calls
WITH segments AS (
  SELECT * FROM raw_cdr_segments
  WHERE call_date BETWEEN ? AND ?
),
tracked_touch AS (
  SELECT
    from_call_id,
    list(to_user ORDER BY start_time)
      FILTER (WHERE to_user IN ($EN, $FR, $AI_EN, $AI_FR))            AS touched_queues,
    bool_or(to_user IN ($AI_EN, $AI_FR))                               AS touched_ai,
    bool_or(
      normalize_dnis(to_id) IN ($TRACKED_DNIS_NORMALIZED)
      OR to_user IN ($EN, $FR, $AI_EN, $AI_FR)
    )                                                                  AS touched_dnis
  FROM segments
  GROUP BY from_call_id
),
first_tracked AS (
  SELECT from_call_id, to_user AS first_tracked_queue
  FROM (
    SELECT from_call_id, to_user,
           row_number() OVER (
             PARTITION BY from_call_id
             ORDER BY start_time, source_hash             -- deterministic tie-break
           ) AS rn
    FROM segments
    WHERE to_user IN ($EN, $FR, $AI_EN, $AI_FR)
  )
  WHERE rn = 1
)
SELECT
  s.from_call_id,
  date_trunc('day', min(s.start_time))::DATE                            AS call_date,
  any_value(s.from_id ORDER BY s.start_time)                            AS caller_id,
  min(s.start_time)                                                     AS start_time,
  max(s.end_time)                                                       AS end_time,
  sum(s.duration_seconds)                                               AS total_duration_seconds,
  count(*)                                                              AS segment_count,
  any_value(t.touched_dnis)                                             AS touched_dnis,
  any_value(t.touched_queues)                                           AS touched_queues,
  any_value(f.first_tracked_queue)                                      AS first_tracked_queue,
  any_value(t.touched_ai)                                               AS touched_ai,
  any_value(f.first_tracked_queue) = $EN                                AS is_english,
  any_value(f.first_tracked_queue) = $FR                                AS is_french,
  any_value(t.touched_ai)                                               AS is_ai,
  any_value(t.touched_ai)
    AND any_value(f.first_tracked_queue) IN ($EN, $FR)                  AS is_ai_overflow,
  now()                                                                 AS rebuilt_at,
  ?                                                                     AS pull_run_id
FROM segments s
JOIN tracked_touch t USING (from_call_id)
LEFT JOIN first_tracked f USING (from_call_id)
WHERE t.touched_dnis = true
GROUP BY s.from_call_id;
```

`DELETE` + `INSERT` runs in a single transaction so a partial failure doesn't leave orphan rows.

### Stage 5 — build `kpi_snapshots`

For each affected date, Stage 5 computes daily snapshots (one row per `include_weekends` value), then the weekly rollup whose week contains the date, then the monthly rollup whose month contains the date. The shape is the same for all three; the only differences are the `period` value and the `period_start`/`period_end` window.

The compute uses **update-only-on-change**: a candidate row is constructed in a CTE, compared against the existing row by data columns, and only written when something differs. This is what makes re-runs of unchanged windows strict no-ops (full byte identity, including `computed_at` and `pull_run_id`).

The daily computation looks like this. (Weekly and monthly are structurally identical — only the `period`, `period_start`, `period_end`, and `WHERE call_date BETWEEN ...` differ.)

```sql
WITH agg AS (
  SELECT
    call_date,
    count(*)                                                 AS total_incoming,
    count(*) FILTER (WHERE is_english)                       AS english_calls,
    count(*) FILTER (WHERE is_french)                        AS french_calls,
    count(*) FILTER (WHERE is_ai)                            AS ai_calls,
    count(*) FILTER (WHERE is_ai_overflow)                   AS ai_overflow_calls
  FROM logical_calls
  WHERE call_date BETWEEN ? AND ?
  GROUP BY call_date
),
queue_activity AS (
  -- Deterministic JSON: build a sorted list of structs, then convert. json_group_object
  -- does NOT guarantee key order; this pattern does.
  SELECT
    business_date AS call_date,
    to_json(
      list(struct_pack(k := queue_id, v := calls_offered) ORDER BY queue_id)
    ) AS total_queue_activity
  FROM raw_queue_stats
  WHERE business_date BETWEEN ? AND ?
  GROUP BY business_date
),
candidate AS (
  SELECT
    'daily'                                                            AS period,
    a.call_date                                                        AS period_start,
    a.call_date                                                        AS period_end,
    ?                                                                  AS include_weekends,
    a.total_incoming, a.english_calls, a.french_calls,
    a.ai_calls, a.ai_overflow_calls,
    coalesce(q.total_queue_activity, '[]'::JSON)                       AS total_queue_activity,
    -- Daily finalization: aged out of the rolling window AND not blocked by forceFinalize override.
    -- Weekly/monthly substitute their own rules; see "Finalization rules" section.
    (a.call_date < current_date - INTERVAL 7 DAY) OR ?::BOOLEAN        AS is_finalized,
    now()                                                              AS computed_at,
    ?                                                                  AS pull_run_id
  FROM agg a
  LEFT JOIN queue_activity q USING (call_date)
)
INSERT OR REPLACE INTO kpi_snapshots
SELECT c.* FROM candidate c
WHERE NOT EXISTS (
  SELECT 1 FROM kpi_snapshots e
  WHERE e.period           = c.period
    AND e.period_start     = c.period_start
    AND e.include_weekends = c.include_weekends
    AND e.total_incoming    = c.total_incoming
    AND e.english_calls     = c.english_calls
    AND e.french_calls      = c.french_calls
    AND e.ai_calls          = c.ai_calls
    AND e.ai_overflow_calls = c.ai_overflow_calls
    AND e.total_queue_activity::VARCHAR = c.total_queue_activity::VARCHAR
    AND e.is_finalized      = c.is_finalized
);
```

The third parameter to `is_finalized` is `forceFinalize` from the workflow input — when `true`, the row is written as finalized regardless of whether the period has aged out.

Weekly snapshots use `period_start = monday(call_date)` and `period_end = friday(call_date)` (or Sunday when `include_weekends = true`); monthly snapshots use the calendar-month boundaries. Weekly `is_finalized` follows the rule in "Finalization rules" (every day in the week is finalized AND `week_end < today − 7`); monthly `is_finalized` is set only by the 2nd-of-month re-pull or by `forceFinalize`.

If the candidate row would change a row whose existing `is_finalized = true` and the run does NOT have `forceFinalize = true`, Stage 5 logs a warning, leaves the existing row unchanged, and continues. (Tested by `finalized-immutability.test.ts`.)

### Stage 6 — close the run

```ts
await md.run(
  `UPDATE pull_runs SET
     finished_at = now(),
     status = ?,
     logical_calls_built = ?,
     snapshots_built = ?,
     error_summary = ?,
     finalized_month = ?
   WHERE pull_run_id = ?`,
  [status, logicalBuilt, snapshotsBuilt, errorSummary, finalizedMonth, pullRunId],
);
```

`status`:
- `success` — all seven stages finished.
- `partial_fetch` — at least one of Stages 1–3 failed. Stages 4–5 are **skipped** (not run with partial data). `logical_calls` and `kpi_snapshots` for the affected window remain at their previous values.
- `partial_build` — Stages 1–3 succeeded but a build stage (Stage 4 or 5) failed. Raw is intact; the next nightly run rebuilds.
- `failed` — Stage 0 failed (couldn't even open a run row in MotherDuck); recorded only in GitHub Actions logs and the alerting webhook, since there's no MotherDuck row to write.

The orchestrator (`jobs/run-pull.ts`) maintains an in-memory per-stage success map. Stage 4 only begins when `stages[1] && stages[2] && stages[3]`. Stage 5 only begins when `stages[4]`. This is the structural defense against partial-fetch poisoning.

## Re-Pull Windows and Finalization

| Trigger | Window | Cadence |
|---|---|---|
| Nightly cron | `[today − 7, yesterday]` (7 days inclusive) | 08:00 UTC every day (≈03:00–04:00 ET) |
| Month-rollover | Full previous month | 08:30 UTC on the 2nd of each month — single finalization point |
| Admin "Rebuild period" | Operator-chosen, capped at 90 days | On demand |

**Why 7 days:** the spec said "yesterday plus the previous 3-7 days." We pick the conservative end so a Monday-morning miss doesn't leave a hole over the weekend. Seven nightly re-pulls of the same date over its first week give Versature time to backfill late-arriving CDR segments.

**Why only the 2nd of the month (not also the 1st):** the original design ran finalization on both the 1st and 2nd as a redundancy. That violates the "finalized rows are immutable" invariant — the 2nd's run could change a value the 1st already finalized. Instead, we run finalization once on the 2nd, which gives a full extra day for late CDR segments to settle. If the 2nd's run fails, the alert path (Section: Monitoring & alerts) fires and an operator triggers `workflow_dispatch` with `forceFinalize: true` for the previous-month window. The 1st no longer runs at all.

### Core finalization invariants

These are load-bearing for the whole system. Tests enforce them.

1. **Finalized snapshots are immutable.** Once `is_finalized = true`, the snapshot's data columns must never change. Any subsequent pull that would alter the data is either skipped (if not forced) or executed only with explicit `forceFinalize = true`, which writes a new `pull_runs` row noting the override and the data delta.
2. **Failed pulls never produce valid snapshots.** If any of Stages 1–3 (fetch) fails for the window, Stages 4–5 (build) are skipped. The next successful pull rebuilds them. (Detailed rules under "Stage gating after partial failure," below.)
3. **Manual overrides are auditable.** Every `forceFinalize` run writes `pull_runs.error_summary = 'forceFinalize override: <reason>'` and the resulting snapshots' `pull_run_id` points to that override run.

### Finalization rules

- **Daily:** `is_finalized = (period_start < today − 7 days)` — the date has aged out of the rolling re-pull window.
- **Weekly:** `is_finalized = (every day in the week is finalized AND week_end < today − 7 days)`.
- **Monthly:** `is_finalized = true` only when set by the 2nd-of-month re-pull, OR by a `forceFinalize = true` workflow run. The same run writes `finalized_month = 'YYYY-MM'` to `pull_runs`.

### Stage gating after partial failure

The pipeline tracks per-stage success. Stage 4 (logical) and Stage 5 (snapshots) only run when **all of Stages 1, 2, and 3 succeeded for the same window in the current pull run.** If any fetch stage failed:

- The `pull_runs` row is closed with `status = 'partial_fetch'` and `error_summary` carrying the failed stage(s).
- Raw rows from the successful fetch stages remain in the warehouse (they're idempotent — a re-pull will overwrite them with the same values).
- `logical_calls` and `kpi_snapshots` for the affected `call_date` range are NOT modified. The previous run's snapshots remain authoritative until the next successful pull rebuilds them.
- The dashboard continues to show the previous (older but valid) snapshots. The "Last successful pull" timestamp surfaces the staleness.

This means: **the dashboard never reflects partial fetch state.** A snapshot row in `kpi_snapshots` corresponds to a `pull_run_id` whose status was `success` at the time of writing.

### Update-only-on-change for snapshots

To make idempotency testable and avoid metadata churn, Stage 5 computes a content hash over the data columns and only writes a new row when the hash differs from the existing row:

```sql
WITH new_snapshot AS ( /* SELECT ... computed values ... */ ),
     existing AS ( SELECT * FROM kpi_snapshots WHERE period = ? AND period_start = ? AND include_weekends = ? )
INSERT OR REPLACE INTO kpi_snapshots
SELECT * FROM new_snapshot
WHERE NOT EXISTS (
  SELECT 1 FROM existing e
  WHERE e.total_incoming    = new_snapshot.total_incoming
    AND e.english_calls     = new_snapshot.english_calls
    AND e.french_calls      = new_snapshot.french_calls
    AND e.ai_calls          = new_snapshot.ai_calls
    AND e.ai_overflow_calls = new_snapshot.ai_overflow_calls
    AND e.total_queue_activity::VARCHAR = new_snapshot.total_queue_activity::VARCHAR
    AND e.is_finalized      = new_snapshot.is_finalized
);
```

This means re-running the same window with no data changes is a strict no-op — no `computed_at` update, no `pull_run_id` update, no row touched. Tests assert exact byte identity in `kpi_snapshots` after re-run.

### Late-arriving data

Versature occasionally backfills CDR segments hours or even a day after the call ended. The 7-day rolling window absorbs this. Segments that arrive >7 days late require an admin "Rebuild period" pull, which will refuse to overwrite finalized snapshots unless `forceFinalize = true` is set on the dispatch. The dashboard's `is_finalized` flag is the truth-in-advertising.

## Dashboard Read Path

### Read flow

```ts
// app/page.tsx (server component)
import { getSnapshot } from '@/lib/warehouse/snapshots';

export default async function DashboardPage({ searchParams }) {
  const period = searchParams.period ?? 'daily';
  const includeWeekends = searchParams.includeWeekends === 'true';
  const periodStart = resolvePeriodStart(period, new Date());

  const snapshot = await getSnapshot({ period, periodStart, includeWeekends });
  if (!snapshot) return <NotDownloadedYet period={period} periodStart={periodStart} />;

  return <DashboardView snapshot={snapshot} />;
}
```

`getSnapshot` is one query:

```sql
SELECT * FROM kpi_snapshots
WHERE period = ? AND period_start = ? AND include_weekends = ?
LIMIT 1;
```

### "Data not downloaded yet" state

When `getSnapshot` returns null, the dashboard shows:

```
Data not downloaded yet
We don't have a snapshot for {period} {periodStart} yet.
The next nightly pull runs at 08:00 UTC (≈03:00–04:00 ET, depending on DST).

Last successful pull:        2026-05-01 03:14 ET
Most recent finalized day:   2026-04-30

[Admin] Trigger a pull for this period →
```

The "Last successful pull" and "Most recent finalized day" come from a small `pull_runs` summary query.

### Page header

```
CSH Call Analytics                                    [Daily] Weekly Monthly
─────────────────────────────────────────────────  Include weekends [ ]
Showing snapshot for 2026-04-30 (finalized) · pulled 2026-05-01 03:14 ET
```

Snapshot age and finalization status are first-class.

### Admin "Rebuild period"

`POST /api/admin/pull` — authenticated by `ADMIN_PULL_TOKEN` bearer, validates the window (no future dates, ≤90 days), then fires a GitHub `repository_dispatch` with `event_type: 'admin-pull'`. The route returns `{status: 'queued'}` immediately. The route never touches Versature.

The `/admin` page (gated by the same token) shows recent `pull_runs` rows and a small form for queueing a rebuild.

### Hard separation

The dashboard's "no live Versature calls" property is enforced structurally by five mechanisms — see **Architectural lint** under Testing Strategy for the full list. Summary: `no-restricted-imports`, no barrel re-exports, a CI grep gate, and split `WarehouseReader`/`WarehouseWriter` type surfaces together make the wrong call uncompilable, unrenderable, and ungreppable.

## Project Structure

```
csh-dashboard/
├── .env.local.example
├── .github/
│   └── workflows/
│       ├── pull.yml             # nightly + admin + manual
│       ├── smoke.yml            # nightly + PR
│       └── ci.yml               # typecheck, lint, test, build
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # dashboard
│   ├── admin/page.tsx           # admin: pull history, rebuild form
│   └── api/
│       ├── admin/pull/route.ts  # dispatches GH workflow
│       └── health/freshness/route.ts
├── components/
│   ├── DashboardView.tsx
│   ├── NotDownloadedYet.tsx
│   ├── KpiCard.tsx
│   ├── PeriodToggle.tsx
│   └── WeekendToggle.tsx
├── jobs/
│   ├── run-pull.ts              # entry point for GH Actions
│   └── notify-failure.ts        # alert webhook
├── lib/
│   ├── versature/
│   │   ├── auth.ts
│   │   ├── client.ts
│   │   ├── endpoints.ts
│   │   ├── rate-limiter.ts
│   │   └── types.ts
│   ├── pipeline/
│   │   ├── fetch-and-load.ts
│   │   ├── build-logical-calls.ts
│   │   └── build-snapshots.ts
│   ├── warehouse/
│   │   ├── client.ts            # exports WarehouseReader + WarehouseWriter
│   │   ├── schema.sql           # CREATE TABLE statements
│   │   ├── snapshots.ts         # dashboard-side reads
│   │   └── pull-runs.ts         # both sides
│   └── utils/
│       ├── dates.ts             # period resolution, Toronto-local helpers
│       ├── dnis.ts              # normalize_dnis (TS impl + DuckDB UDF registration)
│       └── logger.ts
├── scripts/
│   ├── migrate.ts               # apply schema.sql
│   ├── audit-day.ts             # per-day diagnostic
│   ├── inspect-cdr-shape.mjs    # carried over for re-verification
│   └── inspect-queue-shape.mjs  # new — verifies queue-touch inference (Task 0)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│       ├── real-cdr-samples.ndjson         # sanitized real CDRs from inspect-cdr-shape
│       └── real-cdr-samples.expected.json  # known-good logical-call counts
└── README.md
```

## Testing Strategy

### Unit tests (Vitest, no I/O)

- **`rate-limiter.test.ts`** — sliding-window enforcement, sub-second floor, per-endpoint isolation.
- **`client.test.ts`** — 401 refresh-and-retry, 429 `Retry-After` honoring, 5xx backoff schedule, 4xx fast-fail. All sleeps via fake timers.
- **`build-logical-calls.test.ts`** (the most important file in the suite) — runs the SQL against an in-memory DuckDB. Fixtures come from **two sources**: hand-crafted edge-case fixtures, AND sanitized real CDR samples captured by `scripts/inspect-cdr-shape.mjs` and committed to `tests/fixtures/real-cdr-samples.ndjson`. Real samples catch interpretation bugs that hand-crafted data hides:
  - 100 raw segments / 25 distinct `from_call_id`s collapse to 25 logical calls.
  - English-then-AI call → `is_ai_overflow = true`.
  - AI-only call (no EN/FR) → `is_ai = true, is_ai_overflow = false`.
  - English → French → AI → `is_ai_overflow = true`, `first_tracked_queue = $EN`.
  - DNIS in every format the normalization function must accept (`+1...`, `1...`, bare 10-digit, `+1 (XXX) XXX-XXXX`, `XXX.XXX.XXXX`, `XXX-XXX-XXXX`) is included.
  - DNIS that normalizes to a different 10-digit number is excluded.
  - Call with no DNIS and no tracked queue is excluded.
  - `first_tracked_queue` is by `start_time`, not lexicographic queue ID.
  - `first_tracked_queue` with two same-`start_time` segments uses the documented secondary sort key (`source_hash`) deterministically across runs.
  - `total_duration_seconds` is the sum across segments.
  - **Real-sample assertion:** the count of `logical_calls` derived from `tests/fixtures/real-cdr-samples.ndjson` matches a known-good count recorded in `tests/fixtures/real-cdr-samples.expected.json`. Any drift in this count fails the test loudly — it's the canary for queue-touch inference regressions.
- **`build-snapshots.test.ts`** — daily/weekly/monthly counts, weekend toggle, finalization rules, idempotency. Specifically:
  - Run the build twice on identical input → assert `kpi_snapshots` is byte-identical (same `computed_at`, same `pull_run_id`) thanks to update-only-on-change.
  - Run the build with one new logical call added → assert exactly one snapshot row updates and its `computed_at`/`pull_run_id` reflect the new run.
  - Attempt to write a different value to a snapshot where `is_finalized = true` without `forceFinalize` → assert the row is unchanged and a warning is logged.
  - With `forceFinalize = true` → assert the row updates and a `pull_runs.error_summary = 'forceFinalize override: ...'` row is written.
  - `total_queue_activity` JSON: keys are sorted (asserted by string comparison against a fixed expected JSON string). DuckDB's `json_group_object` does not guarantee key order; the build SQL uses `LIST(struct_pack(k:=queue_id, v:=calls_offered) ORDER BY queue_id)` then converts to JSON to enforce determinism.
- **`snapshots.test.ts`** — `getSnapshot` returns null for missing rows; correctly disambiguates the weekend toggle.
- **`dates.test.ts`** — period resolution, Toronto-local DST boundary handling.

### Integration tests (Vitest, real DuckDB, mocked HTTP via `msw`)

- **`pull-cdrs.test.ts`** — three pages of fixture CDRs land correctly; re-running is a no-op; adding one new segment to a known `from_call_id` produces exactly one new row.
- **`mutable-segments.test.ts`** — a known segment's `duration_seconds` changes on re-pull (Versature mutated the row server-side). Assert: the existing `raw_cdr_segments` row updates in place (because `source_hash` excludes `duration_seconds`); a downstream Stage-4 rebuild picks up the new duration; the resulting snapshot's `total_duration_seconds`-derived metric reflects the change; the `kpi_snapshots` row is updated only because the data actually changed.
- **`pull-queue-stats.test.ts`** — 4 × N rows for an N-day window; updates in place on re-pull.
- **`full-pipeline.test.ts`** — fixture day → expected logical calls → expected snapshot. Re-run with no Versature changes produces a byte-identical `kpi_snapshots` row (same `computed_at`, same `pull_run_id`) — proving update-only-on-change.
- **`partial-failure.test.ts`** — Versature 500 on Stage 2 (queue stats) after Stage 1 succeeded. Assert: Stages 4–5 are SKIPPED; `pull_runs.status = 'partial_fetch'`; the previous run's `kpi_snapshots` rows for the window are unchanged; `raw_cdr_segments` for the window IS populated (idempotent); a re-run with Versature healthy completes successfully and rebuilds Stages 4–5.
- **`workflow-input-mapping.test.ts`** — uses `act` (or a CI workflow that dispatches itself) to verify that `workflow_dispatch.inputs.windowStart = '2026-04-15'` and `repository_dispatch.client_payload.windowStart = '2026-04-15'` both produce a `pull_runs.window_start = '2026-04-15'` row, not the nightly default.
- **`finalized-immutability.test.ts`** — write a finalized monthly snapshot. Re-run a pull whose data would change the values. Assert: without `forceFinalize`, the snapshot is unchanged. With `forceFinalize = true`, the snapshot updates and a `pull_runs.error_summary` records the override.

### Smoke test (CI)

Nightly workflow against an **isolated MotherDuck database** named `csh_analytics_smoke` (separate from production `csh_analytics`). The smoke job uses a dedicated `MOTHERDUCK_TOKEN_SMOKE` token whose only privilege is on the smoke database.

Each smoke run:
1. `DROP SCHEMA IF EXISTS main CASCADE; CREATE SCHEMA main;` against `csh_analytics_smoke` — full reset, not a per-row cleanup. This catches issues like a forgotten cleanup leaking state across runs.
2. Re-applies `lib/warehouse/schema.sql`.
3. Pulls a 1-day window for yesterday against the staging Versature tenant (or production-read-only if no staging tenant exists).
4. Asserts a non-empty `kpi_snapshots` row exists for yesterday.
5. Asserts wall-clock time is under 5 minutes.
6. Asserts `pull_runs` row has `status = 'success'`.
7. No teardown step — the next run starts with the schema-drop in step 1.

Production `csh_analytics` is never written by the smoke job. The two databases are separated at the token level so a misconfiguration cannot corrupt production data.

### Architectural lint

The "dashboard never calls Versature" rule is structural and is enforced five ways. A single rule is bypassable; five together are not.

1. **`no-restricted-imports`** in `app/**` and `components/**` forbids `lib/versature/*` AND `lib/pipeline/*`. The pattern list explicitly covers all of:
   - Path-alias imports: `@/lib/versature/*`, `@/lib/pipeline/*`
   - Relative imports: `**/lib/versature/*`, `**/lib/pipeline/*`, `../lib/versature/*`, `../../lib/versature/*`, etc.
   - Bare module imports (defense — should never resolve, but listed anyway)
2. **No barrel re-exports.** `lib/versature/index.ts` and `lib/pipeline/index.ts` do not exist. Each file is imported by its full module path. A separate ESLint rule forbids creating `index.ts` in those folders. This prevents a barrel from being added later in `lib/utils/` that re-exports a Versature symbol and lets the dashboard import it transitively.
3. **`no-restricted-imports`** in `lib/versature/**` forbids `lib/warehouse/*` (Versature client must not know about MotherDuck).
4. **CI grep gate.** A CI step runs `! grep -r -E "(versature|pipeline)" app/ components/ --include='*.ts' --include='*.tsx'`. Pure string-level defense in depth; catches anything ESLint missed (e.g. a dynamic `import()` whose module path is computed).
5. **Two type-only export surfaces** from `lib/warehouse/client.ts`: `WarehouseReader` (used by `app/`, exposes only `SELECT`-shaped methods) and `WarehouseWriter` (used by `lib/pipeline/`, exposes write methods). Same implementation; the type system makes the wrong call uncompilable in the wrong context.

CI fails the build on any of these violations.

### CI matrix

```
typecheck      → tsc --noEmit
lint           → eslint .
unit           → vitest run tests/unit
integration    → vitest run tests/integration
build          → next build
```

All five must pass before merge. Smoke runs separately and only blocks if it fails twice in a row.

## Operational Runbook

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `VERSATURE_BASE_URL` | job | e.g. `https://integrate.versature.com/api` |
| `VERSATURE_CLIENT_ID` | job | OAuth client credentials |
| `VERSATURE_CLIENT_SECRET` | job | OAuth client credentials |
| `VERSATURE_API_VERSION` | job | `application/vnd.integrate.v1.10.0+json` |
| `MOTHERDUCK_TOKEN_RW` | job | Read-write token, scoped to `csh_analytics` only |
| `MOTHERDUCK_TOKEN_RO` | dashboard | Read-only token, scoped to `csh_analytics` only |
| `MOTHERDUCK_TOKEN_SMOKE` | smoke job | Read-write token, scoped to `csh_analytics_smoke` only |
| `MOTHERDUCK_DATABASE` | job + dashboard | `csh_analytics` (production) or `csh_analytics_smoke` (smoke) |
| `QUEUE_EN_MAIN` | job | `8020` |
| `QUEUE_FR_MAIN` | job | `8021` |
| `QUEUE_AI_OVERFLOW_EN` | job | `8030` |
| `QUEUE_AI_OVERFLOW_FR` | job | `8031` |
| `TRACKED_DNIS` | job | Comma-separated, e.g. `+16135949199,6135949199` |
| `ADMIN_PULL_TOKEN` | dashboard | Bearer token for `/api/admin/pull` and `/admin` |
| `GH_DISPATCH_TOKEN` | dashboard | Fine-scoped GitHub PAT with `repo:dispatch` |
| `GH_REPO` | dashboard | `owner/repo` for the dispatch URL |
| `ALERT_WEBHOOK_URL` | job | Slack/Teams webhook for failure notifications |
| `TIMEZONE` | both | `America/Toronto` |

`.env.local.example` ships with placeholders only.

### Workflow

`.github/workflows/pull.yml` — one file, three triggers, one job:

```yaml
name: pull-versature
on:
  schedule:
    # GitHub Actions cron is UTC. 08:00 UTC is 04:00 EDT (summer) / 03:00 EST (winter).
    # We accept the 1-hour DST drift; both times are deep-night for Toronto operations.
    - cron: '0 8 * * *'              # nightly
    - cron: '30 8 2 * *'             # 2nd of each month — finalizes previous month
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
      - run: npx tsx jobs/run-pull.ts
        env:
          # ---- inputs from all three trigger types, mapped explicitly ----
          PULL_WINDOW_START: ${{ github.event.inputs.windowStart || github.event.client_payload.windowStart || '' }}
          PULL_WINDOW_END:   ${{ github.event.inputs.windowEnd   || github.event.client_payload.windowEnd   || '' }}
          PULL_REASON:       ${{ github.event.inputs.reason      || github.event.client_payload.reason      || github.event_name }}
          PULL_FORCE_FINALIZE: ${{ github.event.inputs.forceFinalize || github.event.client_payload.forceFinalize || 'false' }}
          PULL_TRIGGER:      ${{ github.event_name }}
          PULL_SCHEDULE_CRON: ${{ github.event.schedule }}
          # ---- secrets ----
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
        run: npx tsx jobs/notify-failure.ts
        env:
          ALERT_WEBHOOK_URL: ${{ secrets.ALERT_WEBHOOK_URL }}
          PULL_RUN_LOG_URL:  ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

`jobs/run-pull.ts` derives the effective window from `PULL_WINDOW_*` and `PULL_SCHEDULE_CRON`:
- Both `PULL_WINDOW_*` set → use them verbatim. Mode is `manual` (via `workflow_dispatch`) or `admin` (via `repository_dispatch`).
- `PULL_WINDOW_*` blank, `PULL_SCHEDULE_CRON = '0 8 * * *'` → nightly window `[today − 7, yesterday]`. Mode is `cron`.
- `PULL_WINDOW_*` blank, `PULL_SCHEDULE_CRON = '30 8 2 * *'` → previous-month window. Mode is `cron-month-rollover`. Sets `finalized_month` and writes `is_finalized = true` on the resulting monthly snapshot.
- `PULL_WINDOW_*` blank and `PULL_SCHEDULE_CRON` empty → fail loudly. Never silently default; this means the wiring is broken.
- `PULL_FORCE_FINALIZE = 'true'` → also writes `is_finalized = true` on snapshots whose period is fully past, regardless of trigger. Used for ad-hoc late-data finalization via `workflow_dispatch`.

This explicit mapping is covered by an end-to-end CI test: a workflow that dispatches itself with a known window and asserts `pull_runs.window_start = inputs.windowStart`.

### Monitoring & alerts

1. **Job failure** — `if: failure()` step posts the GH Actions run URL plus the latest `pull_runs.error_summary` to the alert webhook.
2. **Missing nightly run** — separate workflow at 10:00 UTC (≈05:00–06:00 ET, ~2h after the nightly run's expected completion) checks `pull_runs` for any successful cron-triggered row in the last 24h. If none, alert. Catches GH Actions outages.
3. **Snapshot freshness** — `/api/health/freshness` returns `{ mostRecentFinalizedDay, age_hours }`. External uptime check pings daily; alerts if `age_hours > 36`.

### Local development

```bash
cp .env.local.example .env.local
npm install
npm run db:migrate                                          # apply schema.sql
npm run dev                                                 # dashboard
npm run pull -- --start 2026-04-30 --end 2026-04-30         # one-off pull
npm run audit -- --date 2026-04-30                          # diagnostic
```

`scripts/audit-day.ts` prints: logical-call count, per-bucket breakdown, sum of `calls_offered`, drift between methods, five sample logical calls with segment trails.

### Common operator tasks

- **Dashboard says "Data not downloaded yet" for last week** — check the latest `pull_runs` row; if failed, check the GH Actions log; trigger an admin "Rebuild period."
- **Numbers for last Tuesday changed today** — expected during the 7-day rolling window. If `kpi_snapshots.is_finalized = true` and the number changed, that's a bug.
- **Backfill three months** — `/admin` → Rebuild period (90-day cap). Or fire `workflow_dispatch` from the GitHub UI three times. Concurrency group serializes runs.
- **Versature changed an API field** — smoke test catches it within 24h. Update `lib/versature/types.ts` and the build SQL. Re-run a known-good day. After merge, an admin "Rebuild period" heals the warehouse.

### Disaster recovery

The recoverability of the warehouse is bounded by **two retention windows**: MotherDuck's time-travel window for the database, and Versature's CDR/queue-stats retention on their side. We do not control Versature's window; tenant configuration determines it (commonly 90 days for CDRs but verify with the account).

| Scenario | Recovery |
|---|---|
| MotherDuck database dropped, within MotherDuck time-travel window | Restore via MotherDuck time-travel. No Versature traffic needed. |
| MotherDuck database dropped, past MotherDuck time-travel window, raw tables intact in backup | Restore the backup; rebuild logical + snapshots via Stages 4–5. |
| Raw tables corrupted/dropped, **within Versature retention** | Re-pull the affected window. Versature is the source of truth for raw within its retention. |
| Raw tables corrupted/dropped, **past Versature retention** | **Unrecoverable from Versature.** If an external snapshot backup exists (see below), restore from it. Otherwise, the affected period is lost. |
| Both raw and snapshots lost, within Versature retention | Re-pull last N days (where N = min(Versature retention, 90)) via monthly admin pulls. Periods past Versature retention are unrecoverable. |
| Versature credentials rotated | Update GH Actions secrets. Next nightly run picks them up. No code change. |
| GitHub Actions deprecates Node | Job is plain TypeScript; portable to any Node-capable runner via a YAML edit. |

**Mitigation for past-retention loss:** the implementation plan should evaluate whether to add a weekly export of `kpi_snapshots` (and optionally `logical_calls`) to a separate cold storage location (S3, GCS, or another MotherDuck database). Historical KPIs are tiny (~2,400 rows/year) — backing them up is essentially free. This is the only protection against losing pre-Versature-retention data, and is recommended for v1 if the operator considers historical KPIs irreplaceable.

**Verify Versature retention before launch.** Confirm with the Versature account team what the actual CDR retention window is on this tenant. If it's <90 days, lower the admin "Rebuild period" cap accordingly so operators don't get a misleading "this should have worked" experience.

## Out of Scope (v1)

- Per-queue dashboards (data is in the warehouse; surfacing it is a dashboard-only PR later).
- Year-over-year deltas (need a full year of data first).
- Multi-tenant.
- CSV export.
- Per-agent breakdown (Versature endpoints we use don't expose this).
- Live AI / Voice Assist data (handled by a separate ConnectWise + AI integration).
- Multi-user authentication beyond the single admin token.

## Risks and Open Questions

### Open questions for Task 0 (re-verification)

These must be confirmed before pipeline build-out begins. The existing `scripts/inspect-cdr-shape.mjs` and a new `scripts/inspect-queue-shape.mjs` cover them. Each gate has a defined pass/fail criterion AND an explicit "if-fail-then" decision. Gate execution always emits TWO artifacts:

- **Human-readable report:** `docs/versature-task-0-verification.md`. Includes audit metadata: command run, executor, timestamp (UTC + Toronto-local), tenant label, queue IDs tested, exact API parameters used, total CDR rows inspected, pagination page count, observed rate-limit response headers if any, pass/fail per gate, and the decision taken on any failure.
- **Machine-readable results:** `tests/fixtures/versature-task-0-results.json`. Same data in structured form so future CI can ingest it.

Both artifacts must be committed before Task 1 starts.

#### 1. CDR shape unchanged

Run `scripts/inspect-cdr-shape.mjs` against **two sample dates**: one recent **high-volume business date** AND one **low-volume / boundary date** (a Sunday, a holiday, or a date near a DST change). Cost-bound — 2 API calls plus pagination — so always feasible.

**Pass criterion:** both responses show `rowArrayKey: '<array-root>'`, `firstRowKeys` matching `["duration","answer_time","start_time","end_time","from","to"]`, and `from.call_id` is non-null on every sampled row.

**If fail:** stop. Update the spec's "Tenant-Specific Facts" section and the parser before any downstream logic ships.

#### 2. Queue-touch inference (most load-bearing)

The design assumes `to.user == queue_id` means a segment touched that queue. Some segments have `to.user = '40'` (an internal extension) so the assumption is not trivially true.

The verification compares two counts for **the exact same date range, timezone, and tracked-queue set** that the production pipeline will use:

- **A:** count of distinct `from.call_id`s in the CDR feed where at least one segment has `to.user == queueId`, derived from `GET /cdrs/?start_date=DATE&end_date=DATE&limit=2000`.
- **B:** the queue's own `calls_offered` from `GET /call_queues/{queue}/stats/?start_date=DATE&end_date=DATE`.

**Pass criterion:** for **every** tracked queue, `abs(A - B) <= max(0.05 * B, 3)`. The absolute floor of 3 prevents a low-volume queue (12 calls) from failing on a 1-call discrepancy.

Report **per-queue accuracy** AND **aggregate accuracy across all four queues** in the verification artifacts.

**If fail:** **pause implementation and redesign queue attribution.** Do not proceed to pipeline build-out. The queue-touch inference is the load-bearing identification mechanism; if it's wrong, every KPI is wrong. Likely remediations: try a different `to.*` field, look for queue identifiers in `from.*`, or use a separate routing endpoint.

#### 3. Splits endpoint rate limit (calibration, not pass/fail)

Treat as a **calibration gate**, not a pass/fail gate. The design ships with `queue_splits.perMinute = 12` (conservative). The goal is to confirm the API supports at least that, and document the actual ceiling if higher.

**Procedure:** issue 30 requests to `GET /call_queues/8020/reports/splits/?start_date=DATE&end_date=DATE&period=day` in a 60-second window from a clean limiter. Capture response codes and any `Retry-After` headers.

**Pass criterion:** the API safely supports the design's minimum of **12/min**.

**Calibration outcome:**
- If 0 of 30 returned 429 → safe to raise `queue_splits.perMinute` to 24 (matching `queue_stats`). Document the new ceiling.
- If some returned 429 with the first ones at request N (N ≤ 12) → **fail**: lower the budget below N and revisit.
- If some returned 429 between requests 13 and 30 → keep the conservative 12/min budget; document the observed limit.

**If fail (i.e. < 12/min ceiling):** reduce concurrency / per-minute budget, OR redesign the split-fetch schedule to spread requests across multiple runs.

#### 4. `from_call_id` uniqueness over time

The `logical_calls` PK is `from_call_id`. Verification: pull 30 days of CDRs (one date per request, then aggregate), build a `Map<from_call_id, Set<call_date>>`, and count any entry whose Set size > 1.

**Pass criterion:** zero entries with Set size > 1.

**If duplicates appear, do not jump to a PK change immediately. Diagnose first.** Categorize each duplicate into one of:

- **Timezone spillover** (a call near midnight Toronto-local appears on two adjacent dates because UTC vs. Toronto bin differently) — fixable by ensuring `call_date` is consistently Toronto-local in both writers and readers; no PK change needed.
- **Pagination duplication** (the same row appears on two pages of `/cdrs/?page=N` due to API instability) — fixable by deduping on `source_hash` at load time, which we already do; no PK change needed.
- **Multi-segment artifact** (a single call has multiple `from.call_id` references that overlap with a different call's IDs) — should be impossible given the SBC ID format; investigate if seen.
- **True ID reuse across days** (Versature legitimately reuses an ID later) — this is the only case requiring a PK change to `(from_call_id, call_date)` and downstream SQL updates.

The verification report records the count and category breakdown of any duplicates found.

**If fail (true ID reuse):** change the PK strategy in `lib/warehouse/schema.sql` to `(from_call_id, call_date)`, update `build-logical-calls.ts` SQL, and re-run from Task 2.

#### 5. DNIS normalization coverage

Sample one month of distinct `to.id` values from CDRs, run each through `normalizeDnis()`, and check for failures.

**Pass criterion:** zero **unexpected** failures. Some `to.id` values legitimately don't normalize to a 10-digit form (e.g. internal extensions like `40`, queue IDs like `8020`, SIP addresses like `sip:...`, anonymous markers, or malformed-by-design markers from auto-attendant routing). The verification builds an **explicit allowed-exception list** and counts only failures outside that list.

The current allowed-exception categories are:
- Pure-digit values shorter than 10 (likely internal extensions or queue IDs)
- Values starting with `sip:` (SIP addresses)
- Empty strings, anonymous markers (`anonymous`, `restricted`, `private`)

**Allowed-exception list lives in `tests/fixtures/dnis-allowed-exceptions.json`** and is committed alongside the verification artifacts.

**If fail (unexpected NULL):** extend `normalizeDnis()` to handle the new pattern OR add the new pattern to the allowed-exception list (with a comment explaining why it's a non-customer DNIS) and re-run.

#### 6. Segment timestamp tie-breaking

The `first_tracked_queue` rule depends on a stable ordering when two tracked-queue segments share the same `start_time`. Verification: count `from_call_id` groups where 2+ tracked-queue segments have an exact-equal `start_time`.

**Pass criterion:** none — this is informational. The SQL already includes `ORDER BY start_time, source_hash` as the deterministic secondary sort. The gate confirms whether the tie path is exercised in real data so the test in Task 14 actually covers it.

**If 0 ties found:** flag in the report; the tie-break path is untested against real data. Add a hand-crafted test case to cover it (already covered by `tests/unit/build-logical-calls.test.ts`).

### Fixture privacy

Both fixture files (`real-cdr-samples.ndjson` and `real-cdr-samples.expected.json`) are committed to the public-repo `tests/fixtures/` directory. Apply this redaction policy:

- **Queue IDs (`to.user` matching tracked queues):** preserve exactly. They are operational identifiers, not customer data.
- **Internal extension `to.user` values (e.g. `40`, `211`):** preserve as-is. They are not customer data.
- **Timestamps (`start_time`, `end_time`, `answer_time`):** preserve the **shape** (date, time, duration relationships). Optionally, all timestamps in the fixture set may be shifted by a single fixed offset (e.g. all moved 6 months earlier) so the fixture date doesn't reveal a real operational date. Document the offset, if used, in `real-cdr-samples.expected.json`.
- **Public phone numbers (`from.id` and any `to.id` that's an external customer DID):** **redact deterministically** while preserving normalization behavior. For any real number `+16135551234`, replace digits with safe equivalents that still normalize to a 10-digit form (e.g. `+15555550100`, `+15555550101`, ...). Keep the same `+1`, dashes, parens, or other formatting variants the original used so the DNIS normalization tests still cover the format diversity.
- **Tracked DNIS (`+16135949199` and variants):** acceptable to preserve as-is since this is the documented public DNIS the entire pipeline tracks. Confirm with the operator before committing.
- **`from.call_id` and `to.call_id`:** SBC-style call IDs leak SBC IP addresses and timestamps. Replace each with a synthetic ID that preserves shape (`sbcsipuac.2_RED_RED_RED_RED_<seq>_01` or similar). Map original → synthetic deterministically so multi-segment grouping behavior is preserved.

The redaction script (`scripts/sanitize-cdr-samples.mjs`) is part of the Task 0 deliverables.

### Expected results metadata

`tests/fixtures/real-cdr-samples.expected.json` includes metadata so future readers can audit how the expected counts were derived:

```json
{
  "sourceDate": "2026-04-30",
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
  "computedBy": "manual classification by <operator name>",
  "scriptAssistedBreakdown": "scripts/breakdown-cdr-samples.mjs (v1)"
}
```

The expected counts are computed in two ways and reconciled before commit:

1. **Manual classification** — a human reads the segments and assigns each `from_call_id` to a bucket.
2. **Script-assisted breakdown** — a small `scripts/breakdown-cdr-samples.mjs` runs the same SQL the pipeline will run, against an in-memory DuckDB loaded with the sanitized fixtures, and emits the per-bucket counts.

The two must agree before the expected file is committed. Any disagreement is itself a finding — investigate before declaring Task 0 complete.

### Summary of failure decisions

| Gate | If fail, then |
|---|---|
| 1 — Shape | Update parser before any downstream logic ships. |
| 2 — Queue-touch | **Pause implementation. Redesign queue attribution.** |
| 3 — Splits rate | Reduce concurrency / per-minute budget, or redesign split-fetch schedule. |
| 4 — `from_call_id` uniqueness | Diagnose category first. Only true ID reuse triggers a PK change to `(from_call_id, call_date)`. |
| 5 — DNIS coverage | Update `normalizeDnis()` OR extend allowed-exception list. |
| 6 — Tie-break (informational) | Confirm hand-crafted test covers the path. |

### Risks to watch

- **Late CDR backfill exceeds 7 days.** Mitigation: smoke test compares same-day re-pulls over time; we can extend the window if drift is observed.
- **`source_hash` collision after a Versature shape change.** Mitigation: schema comment, smoke test row-count drift detection (>10% day-over-day on a stable date triggers a warning).
- **GitHub Actions cron drift / outages.** Mitigation: missing-run alert at 10:00 UTC; freshness uptime check independent of the GH workflow.
- **MotherDuck regional outage.** Mitigation: dashboard surfaces "Data not downloaded yet"; admin can trigger a rebuild later. Raw replay from Versature is the disaster path.
- **Admin token leak.** Mitigation: token rotates manually; admin actions are write-bounded to "queue a workflow" and cannot directly mutate the warehouse.

## Acceptance Gate

The pipeline is complete when all of the following are true:

1. Schema migrations run cleanly against a fresh MotherDuck database.
2. Nightly workflow succeeds end-to-end on a 1-day window, writing a non-empty `kpi_snapshots` row and a `pull_runs` row with `status='success'`.
3. Re-running the same window with no underlying data changes is a strict no-op in `kpi_snapshots` — every column, including `computed_at` and `pull_run_id`, is byte-identical. (Re-running with changed underlying data updates exactly the rows whose data actually changed.)
4. The dashboard renders `kpi_snapshots` rows correctly and shows the "Data not downloaded yet" state when no row matches.
5. ESLint blocks any attempt to import `lib/versature/*` from `app/**` or `components/**`.
6. The full test suite (typecheck, lint, unit, integration, build) passes in CI.
7. The smoke test passes against the staging tenant.
8. The audit script output for one historical day matches manual counting from the Versature web portal within ±2%.

## Implementation Direction

The next step after user review of this spec is to invoke the `superpowers:writing-plans` skill to produce a detailed implementation plan. Suggested execution order:

1. Task 0: re-verify queue-touch inference, splits rate limit, DNIS variants. Halt if any assumption fails.
2. Scaffold project structure, MotherDuck schema, ESLint enforcement.
3. `lib/versature/` — auth, rate limiter, client, endpoints. Unit tests.
4. `lib/warehouse/` — client, reader/writer surfaces.
5. `lib/pipeline/fetch-and-load.ts` — Stages 1, 2, 3. Integration tests.
6. `lib/pipeline/build-logical-calls.ts` — Stage 4. Heaviest test coverage.
7. `lib/pipeline/build-snapshots.ts` — Stage 5.
8. `jobs/run-pull.ts` — orchestrator. Stage 0 + 6.
9. `.github/workflows/pull.yml` + `smoke.yml`.
10. Dashboard `app/page.tsx` + `app/admin/page.tsx` + `app/api/admin/pull/route.ts`.
11. Operational runbook (README), env templates, alerting webhook.
12. End-to-end staging validation against a real day.

Stop after step 12. Production cutover is a separate, explicit decision after stakeholder sign-off on the audit-day output.
