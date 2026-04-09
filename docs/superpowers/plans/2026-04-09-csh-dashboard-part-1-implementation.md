# Analytics Dashboard Codex Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Part 1 CSH dashboard as a local-first Next.js application that persists Versature data in PostgreSQL, computes the 10 approved KPIs plus the Short Calls metric, and makes the KPI #1 audit trail easy to verify against a human manual count.

**Architecture:** The app is a greenfield Next.js App Router project. Versature data is pulled through a server-side OAuth client, stored raw in PostgreSQL, normalized into logical calls to avoid CDR overcounting, and then queried by one-file-per-KPI modules. The logical-call layer now also owns single-call routing attribution for KPI #2-#5 so queue fanout does not reintroduce double counting. The dashboard page reads from Postgres-backed daily data and never derives dropped calls from raw CDR `answer_time`.

**Tech Stack:** Next.js App Router · TypeScript · React Server Components · Tailwind CSS · Recharts · PostgreSQL via `pg` · native `fetch` · `date-fns` · `date-fns-tz` · Vitest · `tsx`

---

## File Map

```text
/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/
├── package.json                              # Scripts + dependency manifest
├── tsconfig.json                             # TS config
├── next.config.ts                            # Next config
├── postcss.config.mjs                        # Tailwind PostCSS bridge
├── .gitignore                                # Ignore node_modules, .next, .env.local
├── .env.local.example                        # Part 1 env template
├── README.md                                 # Setup, run, audit, troubleshooting
├── docs/
│   └── versature-cdr-shape.md                # Verified CDR response shape + dedupe decision
├── app/
│   ├── globals.css                           # Tailwind entry + global styles
│   ├── layout.tsx                            # Root layout shell
│   ├── page.tsx                              # Dashboard page
│   ├── api/
│   │   └── refresh/route.ts                  # Manual sync endpoint
│   └── components/
│       ├── KpiCard.tsx                       # KPI display card
│       ├── LanguageSplitChart.tsx            # KPI #7 donut
│       ├── DayOfWeekChart.tsx                # KPI #9 chart
│       ├── HourlyDurationChart.tsx           # KPI #10 chart
│       └── PeriodToggle.tsx                  # Today / This Week / This Month
├── db/
│   └── migrations/
│       └── 001_initial.sql                   # Part 1 schema
├── lib/
│   ├── db/
│   │   ├── client.ts                         # Pool singleton
│   │   ├── schema.ts                         # Row types and SQL helpers
│   │   └── queries.ts                        # Upserts and read queries
│   ├── versature/
│   │   ├── auth.ts                           # OAuth token manager
│   │   ├── client.ts                         # Authenticated fetch + pagination
│   │   ├── endpoints.ts                      # Typed endpoint wrappers
│   │   ├── logical-calls.ts                  # CDR -> logical call derivation
│   │   ├── sync.ts                           # Per-day ingest orchestration
│   │   ├── types.ts                          # API response types
│   │   └── queues.ts                         # Queue IDs + DNIS constants
│   ├── connectwise/
│   │   └── .gitkeep                          # Part 2 stub
│   ├── kpis/
│   │   ├── assertions.ts                     # Daily invariant gate for deduped KPIs
│   │   ├── get-dashboard-data.ts             # Dashboard aggregator
│   │   ├── kpi-1-total-incoming.ts
│   │   ├── kpi-2-dropped.ts
│   │   ├── kpi-3-english.ts
│   │   ├── kpi-4-french.ts
│   │   ├── kpi-5-ai.ts
│   │   ├── kpi-6-pct-dropped.ts
│   │   ├── kpi-7-language-split.ts
│   │   ├── kpi-8-avg-length.ts
│   │   ├── kpi-9-day-of-week.ts
│   │   ├── kpi-10-hourly-length.ts
│   │   └── short-calls.ts                    # Separate operational metric
│   ├── filters/
│   │   ├── weekends.ts                       # Weekend exclusion
│   │   └── dnis.ts                           # DNIS filter helpers
│   └── utils/
│       ├── dates.ts                          # ET date boundaries + comparisons
│       └── format.ts                         # Duration and percent formatting
├── scripts/
│   ├── inspect-cdr-shape.mjs                 # Real-data preflight verifier
│   ├── migrate.ts                            # Run SQL migrations
│   ├── discover-queues.ts                    # Queue discovery helper
│   └── audit-day.ts                          # Human validation helper
└── tests/
    ├── fixtures/
    │   ├── kpi-fixtures.ts                   # Shared test data
    ├── filters/
    │   ├── dnis.test.ts
    │   └── weekends.test.ts
    ├── utils/
    │   ├── dates.test.ts
    │   └── format.test.ts
    ├── versature/
    │   ├── auth.test.ts
    │   ├── client.test.ts
    │   ├── endpoints.test.ts
    │   └── logical-calls.test.ts
    ├── db/
    │   └── queries.test.ts
    ├── kpis/
    │   ├── assertions.test.ts
    │   ├── kpi-1-total-incoming.test.ts
    │   ├── kpi-2-dropped.test.ts
    │   ├── kpi-3-english.test.ts
    │   ├── kpi-4-french.test.ts
    │   ├── kpi-5-ai.test.ts
    │   ├── kpi-6-pct-dropped.test.ts
    │   ├── kpi-7-language-split.test.ts
    │   ├── kpi-8-avg-length.test.ts
    │   ├── kpi-9-day-of-week.test.ts
    │   ├── kpi-10-hourly-length.test.ts
    │   ├── short-calls.test.ts
    │   └── get-dashboard-data.test.ts
    └── app/
        └── page.test.tsx                     # Server-render smoke test
```

## Review Patch: C1-C4, S1-S6, and Remaining Doc Polish

### C1. Verify the real CDR wrapper and shared call identifier before scaffolding

The plan no longer assumes `start_time + caller_number` is enough to dedupe segments, and it no longer assumes the pagination wrapper uses `results`. Before Task 1 starts, run a one-day inspection against the real Versature API and record:

- the top-level page wrapper keys
- whether a shared call identifier exists across segments
- which field path carries it
- whether that identifier is stable across AA, queue, and answered legs

The implementation plan now adds `Task 0` for this preflight and writes the result to `docs/versature-cdr-shape.md`. No KPI or logical-call code should be implemented until this artifact exists.

### C2. Compute `answered` and `durationSeconds` from the whole segment group, not the DNIS leg

`logical_calls.answered` must be derived from the full group:

```ts
const answered = rows.some((row) => row.answer_time !== null)
const durationSeconds = answered
  ? Math.max(...rows.filter((row) => row.answer_time !== null).map((row) => row.duration))
  : Math.max(...rows.map((row) => row.duration))
```

The representative DNIS-touching segment still determines the tracked DNIS for KPI #1, but it does not determine the answered flag or conversation duration.

### C3. Expand the OAuth tests to cover expiry refresh and double-401 failure

The auth/client test plan now includes three required paths:

1. cached token reuse before expiry
2. refresh after expiry
3. API request gets 401, invalidates, retries once, then throws loudly if the retry also gets 401

### C4. Default `VERSATURE_API_VERSION` to `application/vnd.integrate.v1.6.0+json`

The plan no longer assumes `v1.10.0`. The env template and default header now use `v1.6.0`, matching the approved spec. A comment in `.env.local.example` points operators to override it only if their tenant is on a documented newer version.

### S1. Remove the `null` sentinel from `versatureFetch`

The retry path now uses a typed `UnauthorizedOnceError` instead of overloading `null`:

```ts
class UnauthorizedOnceError extends Error {}
```

This prevents a legitimate `null` API payload from being misread as an auth failure.

### S2. Extract paginated rows through a verified helper

The page-wrapping logic is no longer hardcoded to `payload.results`. The plan now uses:

```ts
function extractPagedItems<T>(payload: unknown): { items: T[]; more: boolean; cursor?: string }
```

This helper is populated only after Task 0 verifies the real response shape.

### S3. Replace logical calls by explicit business date, even when the replacement set is empty

The old `rows[0]?.callDate` delete path is removed. The query helper now takes the date as an explicit argument:

```ts
replaceLogicalCallsForDate(client, dateKey, rows)
```

This guarantees a legitimate zero-call day clears stale rows instead of leaving old data behind.

### S4. Count calls by `start_time`, not `end_time`

KPI #1 period filters now use:

```sql
where start_time >= $1 and start_time <= $2
```

This keeps a call in the day it started and prevents midnight straddle calls from disappearing from both days.

### S5. Treat `queue_stats_daily.stats_date` as a Toronto-local business date, not a UTC-derived date

The sync step now derives `dateKey` with `formatInTimeZone(..., 'America/Toronto', 'yyyy-MM-dd')`, and `queue_stats_daily.stats_date` is documented as the Toronto business date requested from Versature. Weekend exclusion for queue stats therefore operates on the same calendar basis as logical calls.

### S6. Verify whether the raw CDR `id` is reliable before locking in `source_hash` as the long-term key

Task 0 must also record whether the top-level CDR `id` field is populated on every sampled row. If it is reliable, switch the raw CDR upsert to use `external_id` as the conflict target and keep the derived hash only as a fallback/debug field. If it is not reliable, keep `source_hash` as the primary key and add a schema comment explaining that it is a derived fallback sensitive to payload-shape changes.

## Patch Amendments

When this section conflicts with older task snippets later in the document, this section wins.

### Order of application

Apply the patches in this order so each one can land as a small reviewable PR:

1. Patch 1: expand schema in Task 2
2. Patch 5: dedup KPI #2 in Task 7
3. Patch 2: dedup KPI #3, KPI #4, and KPI #5 in Task 7
4. Patch 3: assertion gate in Task 9

### Patch 1: Expand `logical_calls`

Task 2 and Task 5 must persist the fields below on every logical call:

- `routing_bucket`: `'english' | 'french' | 'ai' | 'unrouted'`
- `touched_english_queue`, `touched_french_queue`, `touched_ai_queue`
- `is_dropped`
- `is_business_hours`
- `is_voice_assist`

Implementation notes:

- `routing_bucket` is exclusive and must be derived from the last tracked queue leg in the grouped segment trail.
- `is_dropped` must be derived from the grouped trail, not from raw `answer_time`.
- `is_business_hours` is computed in Part 1 but BH-only KPI variants remain out of scope.
- `is_voice_assist` is a Part 1 placeholder and must default to `false` until Part 2 adds MSP Process truth.

### Patch 5: Dedup KPI #2

Task 7 must stop using `queue_stats_daily.abandoned_calls` as the final KPI #2 source.

- KPI #2 now counts deduped `logical_calls` where `is_dropped = true`.
- Queue stats abandoned totals remain available only for assertion and audit output.

### Patch 2: Dedup KPI #3, KPI #4, and KPI #5

Task 7 must stop using queue-stats offered counts as the final source for KPI #3, KPI #4, and KPI #5.

- KPI #3 counts `logical_calls` where `routing_bucket = 'english'`
- KPI #4 counts `logical_calls` where `routing_bucket = 'french'`
- KPI #5 counts `logical_calls` where `routing_bucket = 'ai'`

The bucket is exclusive, so `KPI3 + KPI4 + KPI5` must never exceed `KPI1`.

### Patch 3: Assertion gate

Task 9 must add a daily assertion gate after snapshot computation and before the ingest run is treated as clean.

Required invariants:

- `kpi3.totalEnglish + kpi4.totalFrench + kpi5.totalAi <= kpi1.primaryCount`
- `kpi2.totalDropped <= kpi1.primaryCount`
- KPI #1 queue-stat reconciliation still warns when drift exceeds 2%

The gate may log warnings or fail the ingest, but it must surface the exact invariant that broke.

## Deferred to Part 2

- MSP Process integration. KPI #5 is still a Versature queue-trail metric in Part 1.
- Voice Assist vs AI Overflow distinction. `is_voice_assist` remains a placeholder until MSP Process is integrated.
- ConnectWise ticket match rate.
- AI quality score from `EvaluationScore`.
- Business-hours-only KPI variants.

## Task 0: Verify Real Versature CDR Shape Before Scaffolding

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/scripts/inspect-cdr-shape.mjs`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/docs/versature-cdr-shape.md`

- [ ] **Step 1: Write the inspection script**

Create `scripts/inspect-cdr-shape.mjs`:

```js
const baseUrl = process.env.VERSATURE_BASE_URL
const clientId = process.env.VERSATURE_CLIENT_ID
const clientSecret = process.env.VERSATURE_CLIENT_SECRET
const apiVersion =
  process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.6.0+json'
const date = process.argv[2]

if (!date) {
  throw new Error('Usage: node --env-file=.env.local scripts/inspect-cdr-shape.mjs 2026-04-01')
}

function getValueAtPath(value, path) {
  return path.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return null
    }

    return current[key] ?? null
  }, value)
}

function findPrimaryRowArray(payload) {
  if (Array.isArray(payload)) {
    return { rowArrayKey: '<array-root>', rows: payload }
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Expected the CDR payload to be an object or array')
  }

  const arrayEntries = Object.entries(payload).filter(([, value]) => Array.isArray(value))
  const objectArrayEntries = arrayEntries.filter(([, value]) =>
    value.every((item) => item && typeof item === 'object' && !Array.isArray(item)),
  )

  if (objectArrayEntries.length === 1) {
    return {
      rowArrayKey: objectArrayEntries[0][0],
      rows: objectArrayEntries[0][1],
    }
  }

  if (arrayEntries.length === 1) {
    return {
      rowArrayKey: arrayEntries[0][0],
      rows: arrayEntries[0][1],
    }
  }

  throw new Error(
    `Unable to identify the primary row array. Top-level keys: ${Object.keys(payload).join(', ')}`,
  )
}

function inspectSharedIdCandidates(rows) {
  const candidatePaths = [
    'call_id',
    'from.call_id',
    'callId',
    'from.callId',
    'session_id',
    'conversation_id',
  ]

  return candidatePaths
    .map((path) => {
      const groups = new Map()

      for (const row of rows) {
        const value = getValueAtPath(row, path)
        if (typeof value !== 'string' || value.length === 0) {
          continue
        }

        const bucket = groups.get(value) ?? {
          count: 0,
          toIds: new Set(),
          answeredRows: 0,
        }

        bucket.count += 1
        bucket.toIds.add(getValueAtPath(row, 'to.id') ?? '<missing>')
        if (getValueAtPath(row, 'answer_time')) {
          bucket.answeredRows += 1
        }

        groups.set(value, bucket)
      }

      const multiSegmentGroups = [...groups.entries()]
        .filter(([, group]) => group.count > 1)
        .slice(0, 5)
        .map(([value, group]) => ({
          value,
          count: group.count,
          uniqueToIds: [...group.toIds],
          answeredRows: group.answeredRows,
        }))

      return {
        path,
        populatedRows: [...groups.values()].reduce((sum, group) => sum + group.count, 0),
        multiSegmentGroups: multiSegmentGroups.length,
        sampleGroups: multiSegmentGroups,
      }
    })
    .filter((candidate) => candidate.populatedRows > 0)
}

const tokenResponse = await fetch(`${baseUrl}/oauth/token/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }),
})

const tokenPayload = await tokenResponse.json()
const accessToken = tokenPayload.access_token

const cdrResponse = await fetch(
  `${baseUrl}/cdrs/users/?start_date=${date}&end_date=${date}`,
  {
    headers: {
      Accept: apiVersion,
      Authorization: `Bearer ${accessToken}`,
    },
  },
)

const payload = await cdrResponse.json()
const pageKeys = Array.isArray(payload) ? ['<array-root>'] : Object.keys(payload)
const { rowArrayKey, rows } = findPrimaryRowArray(payload)
const firstRow = rows[0] ?? null
const sampleRows = rows.slice(0, 50)

console.log(JSON.stringify({
  pageKeys,
  rowArrayKey,
  rowCount: rows.length,
  firstRowKeys: firstRow ? Object.keys(firstRow) : [],
  firstRow,
  sharedIdCandidates: inspectSharedIdCandidates(sampleRows),
}, null, 2))
```

- [ ] **Step 2: Run the inspection script against a real historical day**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
node --env-file=.env.local scripts/inspect-cdr-shape.mjs 2026-04-01
```

Expected: a JSON blob showing the top-level page keys and the first real CDR row.
The output must also include `rowArrayKey` and a `sharedIdCandidates` array so the next worker can choose a primary dedupe field based on real data instead of assumptions.

- [ ] **Step 3: Write the verified findings**

Create `docs/versature-cdr-shape.md` with this exact structure, replacing the quoted values with the real script output from Step 2:

```md
# Versature CDR Shape Verification

- Inspection date: 2026-04-09
- Sample day checked: 2026-04-01
- Page wrapper keys: copy the exact JSON array from `pageKeys`
- Primary row array key: copy `rowArrayKey` exactly; use `<array-root>` if the payload itself is the row array
- Shared call identifier field: choose the first `sharedIdCandidates` entry that shows repeated multi-segment groups across queue legs; otherwise write `none found`
- Shared call identifier evidence: record the chosen candidate's `sampleGroups` summary so later workers can see whether it spans AA, queue, and answered legs
- Raw CDR row identifier field: record whether top-level `id` is present on every sampled row; otherwise write `not reliably present`
- Dedupe decision:
  - If a shared call identifier field was confirmed, use that exact field path in `getSharedCallId(...)` and keep caller number + Toronto-local minute bucket as the fallback.
  - If no shared identifier was confirmed, use caller number + Toronto-local minute bucket as the primary dedupe key.
- Raw CDR identity decision:
  - If top-level `id` is reliable on every sampled row, use `external_id` as the raw upsert conflict target and keep `source_hash` only as a derived fallback/debug field.
  - If top-level `id` is not reliable, keep `source_hash` as the primary key and add a schema comment warning that it is a derived fallback sensitive to payload changes.
- Follow-up edits required before Task 4 and Task 5 are implemented:
  - Update the `extractPagedItems(...)` test and implementation to match the verified wrapper shape from this document.
  - Update `VersatureCdr`, the logical-call fixtures, and `getSharedCallId(...)` to use the verified shared-id field path from this document.
  - Update the `cdr_segments` migration and raw CDR upsert conflict target to match the raw identity decision from this document.
```

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/inspect-cdr-shape.mjs docs/versature-cdr-shape.md
git commit -m "docs: verify versature cdr wrapper and dedupe field"
```

## Task 1: Manually Scaffold the Greenfield Next.js App

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/package.json`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tsconfig.json`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/next-env.d.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/next.config.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/postcss.config.mjs`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/.gitignore`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/layout.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/globals.css`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/page.tsx`

- [ ] **Step 1: Write the root manifest and scripts**

Create `package.json`:

```json
{
  "name": "csh-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "node --env-file=.env.local --import tsx scripts/migrate.ts",
    "discover:queues": "node --env-file=.env.local --import tsx scripts/discover-queues.ts",
    "audit:day": "node --env-file=.env.local --import tsx scripts/audit-day.ts"
  },
  "dependencies": {
    "date-fns": "^4.1.0",
    "date-fns-tz": "^3.2.0",
    "next": "16.1.1",
    "pg": "^8.13.1",
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "recharts": "2.15.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.9",
    "@types/node": "^22.10.1",
    "@types/pg": "^8.11.10",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "postcss": "^8.5.1",
    "tailwindcss": "^4.1.9",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
npm install
```

Expected: `added ... packages` and a generated `package-lock.json`.

- [ ] **Step 3: Add the base config files**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

Create `next-env.d.ts`:

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// This file is automatically maintained by Next.js.
```

Create `next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
}

export default nextConfig
```

Create `postcss.config.mjs`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

Create `.gitignore`:

```gitignore
node_modules
.next
.env.local
coverage
*.log
```

- [ ] **Step 4: Add the first app shell**

Create `app/layout.tsx`:

```tsx
import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'CSH Dashboard',
  description: 'CSH call analytics dashboard',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
```

Create `app/globals.css`:

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --muted: #64748b;
  --border: #e2e8f0;
  --panel: #f8fafc;
}

body {
  background: var(--background);
  color: var(--foreground);
}
```

Create `app/page.tsx`:

```tsx
export default function Page() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">CSH Dashboard</h1>
      <p className="mt-3 text-sm text-slate-600">
        Part 1 scaffold complete. KPI implementation starts next.
      </p>
    </main>
  )
}
```

- [ ] **Step 5: Verify the app boots**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
npm run dev
```

Expected: Next starts and `http://localhost:3000` renders the scaffold heading.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json next-env.d.ts next.config.ts postcss.config.mjs .gitignore app/layout.tsx app/globals.css app/page.tsx
git commit -m "chore: scaffold Next.js dashboard app"
```

## Task 2: Create the PostgreSQL Foundation and Env Template

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/.env.local.example`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/db/migrations/001_initial.sql`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/db/client.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/db/schema.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/scripts/migrate.ts`

- [ ] **Step 1: Write the env template**

Create `.env.local.example`:

```env
# Versature
VERSATURE_BASE_URL=https://integrate.versature.com/api
VERSATURE_CLIENT_ID=
VERSATURE_CLIENT_SECRET=
# Override only if your tenant is on a newer documented media type.
VERSATURE_API_VERSION=application/vnd.integrate.v1.6.0+json

# PostgreSQL
DATABASE_URL=postgres://username:password@127.0.0.1:5432/csh_dashboard

# Queue IDs
QUEUE_ENGLISH=
QUEUE_FRENCH=
QUEUE_AI_OVERFLOW_EN=
QUEUE_AI_OVERFLOW_FR=

# DNIS
DNIS_PRIMARY=16135949199
DNIS_SECONDARY=6135949199
```

- [ ] **Step 2: Add the migration SQL**

Before transcribing the migration below, read `docs/versature-cdr-shape.md` and adjust the `cdr_segments` conflict key if Task 0 confirmed that `external_id` is reliable on every row.

Create `db/migrations/001_initial.sql`:

```sql
create table if not exists ingest_runs (
  id bigserial primary key,
  run_type text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'running',
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists cdr_segments (
  source_hash text primary key,
  external_id text,
  call_type text,
  start_time timestamptz not null,
  answer_time timestamptz,
  end_time timestamptz not null,
  duration_seconds integer not null,
  from_number text,
  from_name text,
  from_user text,
  to_id text,
  payload jsonb not null,
  imported_at timestamptz not null default now()
);

comment on column cdr_segments.source_hash is
  'Derived fallback key. If Task 0 confirms external_id is reliable on every row, use external_id as the long-term conflict target instead.';

create index if not exists idx_cdr_segments_start_time on cdr_segments (start_time);
create index if not exists idx_cdr_segments_to_id on cdr_segments (to_id);

create table if not exists queue_stats_daily (
  queue_id text not null,
  stats_date date not null,
  calls_offered integer not null,
  abandoned_calls integer not null,
  abandoned_rate numeric(8,4) not null,
  average_talk_time integer not null,
  average_handle_time integer not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (queue_id, stats_date)
);

comment on column queue_stats_daily.stats_date is
  'America/Toronto business date requested from Versature; do not treat as UTC-derived';

create table if not exists queue_splits (
  queue_id text not null,
  split_period text not null,
  interval_start timestamptz not null,
  volume integer not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (queue_id, split_period, interval_start)
);

create table if not exists logical_calls (
  call_date date not null,
  dedupe_key text not null,
  caller_number text,
  dnis text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  routing_bucket text not null check (routing_bucket in ('english', 'french', 'ai', 'unrouted')),
  touched_english_queue boolean not null default false,
  touched_french_queue boolean not null default false,
  touched_ai_queue boolean not null default false,
  answered boolean not null,
  is_dropped boolean not null default false,
  is_business_hours boolean not null default false,
  is_voice_assist boolean not null default false,
  duration_seconds integer not null,
  representative_hash text not null references cdr_segments (source_hash),
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (call_date, dedupe_key)
);

create index if not exists idx_logical_calls_dnis on logical_calls (dnis);
create index if not exists idx_logical_calls_routing_bucket on logical_calls (routing_bucket);
create index if not exists idx_logical_calls_is_dropped on logical_calls (is_dropped);

create table if not exists kpi_daily_snapshots (
  snapshot_date date primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 3: Add the database client and schema types**

Create `lib/db/client.ts`:

```ts
import { Pool } from 'pg'

declare global {
  var __cshPool: Pool | undefined
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  global.__cshPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  return global.__cshPool
}
```

Create `lib/db/schema.ts`:

```ts
export type QueueId = 'english' | 'french' | 'ai-overflow-en' | 'ai-overflow-fr'

export type CdrSegmentRow = {
  sourceHash: string
  externalId: string | null
  callType: string | null
  startTime: string
  answerTime: string | null
  endTime: string
  durationSeconds: number
  fromNumber: string | null
  fromName: string | null
  fromUser: string | null
  toId: string | null
  payload: Record<string, unknown>
}

export type LogicalCallRow = {
  callDate: string
  dedupeKey: string
  callerNumber: string | null
  dnis: string
  startTime: string
  endTime: string
  routingBucket: 'english' | 'french' | 'ai' | 'unrouted'
  touchedEnglishQueue: boolean
  touchedFrenchQueue: boolean
  touchedAiQueue: boolean
  answered: boolean
  isDropped: boolean
  isBusinessHours: boolean
  isVoiceAssist: boolean
  durationSeconds: number
  representativeHash: string
  payload: Record<string, unknown>
}
```

Patch 1 requirement: Task 5 must populate every one of these logical-call fields before Task 7 or Task 9 begins. Do not defer the new columns to a later cleanup pass.

- [ ] **Step 4: Add the migration runner**

Create `scripts/migrate.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPool } from '../lib/db/client'

async function main() {
  const pool = getPool()
  const sql = await readFile(
    join(process.cwd(), 'db/migrations/001_initial.sql'),
    'utf8',
  )

  await pool.query(sql)
  console.log('Applied migration 001_initial.sql')
  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 5: Run the migration**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
npm run db:migrate
```

Expected: `Applied migration 001_initial.sql`.

- [ ] **Step 6: Commit**

Run:

```bash
git add .env.local.example db/migrations/001_initial.sql lib/db/client.ts lib/db/schema.ts scripts/migrate.ts
git commit -m "feat: add postgres schema and migration runner"
```

## Task 3: Build the Shared Utility Layer with Tests First

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/utils/dates.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/utils/format.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/filters/weekends.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/filters/dnis.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/utils/dates.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/utils/format.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/filters/weekends.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/filters/dnis.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `tests/utils/dates.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { getPeriodRange } from '@/lib/utils/dates'

describe('getPeriodRange', () => {
  test('returns a Monday-to-Friday range for this week in America/Toronto', () => {
    const range = getPeriodRange('this-week', new Date('2026-04-09T12:00:00Z'))

    expect(range.label).toBe('This Week')
    expect(range.start.toISOString()).toBe('2026-04-06T04:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-04-10T03:59:59.999Z')
  })
})
```

Create `tests/filters/weekends.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { excludeWeekends } from '@/lib/filters/weekends'

describe('excludeWeekends', () => {
  test('removes Saturday and Sunday records by date field', () => {
    const result = excludeWeekends(
      [
        { stamp: '2026-04-10T14:00:00Z' },
        { stamp: '2026-04-11T14:00:00Z' },
        { stamp: '2026-04-12T14:00:00Z' },
      ],
      'stamp',
    )

    expect(result).toEqual([{ stamp: '2026-04-10T14:00:00Z' }])
  })
})
```

Create `tests/filters/dnis.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { filterToTargetDnis } from '@/lib/filters/dnis'

describe('filterToTargetDnis', () => {
  test('keeps only records whose toId is a tracked DNIS', () => {
    const rows = [
      { toId: '16135949199' },
      { toId: '6135949199' },
      { toId: '18005551212' },
    ]

    expect(filterToTargetDnis(rows, 'toId')).toEqual([
      { toId: '16135949199' },
      { toId: '6135949199' },
    ])
  })
})
```

Create `tests/utils/format.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { formatDuration, formatPercent } from '@/lib/utils/format'

describe('format helpers', () => {
  test('formats seconds into Xm Ys', () => {
    expect(formatDuration(125)).toBe('2m 5s')
  })

  test('formats a decimal ratio as a percent string', () => {
    expect(formatPercent(0.125)).toBe('12.5%')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
npx vitest run tests/utils/dates.test.ts tests/utils/format.test.ts tests/filters/weekends.test.ts tests/filters/dnis.test.ts
```

Expected: FAIL with module-not-found errors for the missing utility files.

- [ ] **Step 3: Write the minimal implementations**

Create `lib/utils/dates.ts`:

```ts
import {
  addDays,
  endOfDay,
  endOfMonth,
  isBefore,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Toronto'

export type PeriodKey = 'today' | 'this-week' | 'this-month'

export function getPeriodRange(period: PeriodKey, now = new Date()) {
  const zonedNow = toZonedTime(now, TIMEZONE)

  if (period === 'today') {
    return {
      key: period,
      label: 'Today',
      start: fromZonedTime(startOfDay(zonedNow), TIMEZONE),
      end: fromZonedTime(endOfDay(zonedNow), TIMEZONE),
    }
  }

  if (period === 'this-week') {
    const weekStart = startOfWeek(zonedNow, { weekStartsOn: 1 })
    const fridayEnd = endOfDay(addDays(weekStart, 4))
    const effectiveEnd = isBefore(zonedNow, fridayEnd) ? endOfDay(zonedNow) : fridayEnd

    return {
      key: period,
      label: 'This Week',
      start: fromZonedTime(weekStart, TIMEZONE),
      end: fromZonedTime(effectiveEnd, TIMEZONE),
    }
  }

  return {
    key: period,
    label: 'This Month',
    start: fromZonedTime(startOfMonth(zonedNow), TIMEZONE),
    end: fromZonedTime(endOfMonth(zonedNow), TIMEZONE),
  }
}
```

Create `lib/filters/weekends.ts`:

```ts
import { isSaturday, isSunday } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'America/Toronto'

export function excludeWeekends<T extends Record<string, unknown>>(
  rows: T[],
  dateField: keyof T,
) {
  return rows.filter((row) => {
    const value = row[dateField]
    if (typeof value !== 'string' && !(value instanceof Date)) {
      return true
    }

    const zoned = toZonedTime(new Date(value), TIMEZONE)
    return !isSaturday(zoned) && !isSunday(zoned)
  })
}
```

Create `lib/filters/dnis.ts`:

```ts
export const TARGET_DNIS = [
  process.env.DNIS_PRIMARY!,
  process.env.DNIS_SECONDARY!,
] as const

export function filterToTargetDnis<T extends Record<string, unknown>>(
  rows: T[],
  field: keyof T,
) {
  return rows.filter((row) => TARGET_DNIS.includes(String(row[field]) as never))
}
```

Create `lib/utils/format.ts`:

```ts
export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60
  return `${minutes}m ${remainder}s`
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}
```

- [ ] **Step 4: Run the tests again**

Run:

```bash
npx vitest run tests/utils/dates.test.ts tests/utils/format.test.ts tests/filters/weekends.test.ts tests/filters/dnis.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/utils/dates.test.ts tests/utils/format.test.ts tests/filters/weekends.test.ts tests/filters/dnis.test.ts lib/utils/dates.ts lib/utils/format.ts lib/filters/weekends.ts lib/filters/dnis.ts
git commit -m "feat: add shared date, format, and filter utilities"
```

## Task 4: Implement the Versature Auth and Endpoint Layer with Tests First

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/versature/auth.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/versature/client.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/versature/endpoints.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/types.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/auth.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/client.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/endpoints.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/queues.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/scripts/discover-queues.ts`

- [ ] **Step 1: Write the failing auth and client tests**

Create `tests/versature/auth.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('getAccessToken', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00Z'))
    process.env.VERSATURE_CLIENT_ID = 'client'
    process.env.VERSATURE_CLIENT_SECRET = 'secret'
    process.env.VERSATURE_BASE_URL = 'https://integrate.versature.com/api'
    process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.6.0+json'
  })

  test('caches the token until the safety margin is reached', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'abc',
        token_type: 'Bearer',
        scope: 'Office Manager',
        expires_in: 3600,
      }),
    })

    const { getAccessToken } = await import('@/lib/versature/auth')
    const first = await getAccessToken()
    const second = await getAccessToken()

    expect(first).toBe('abc')
    expect(second).toBe('abc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('refreshes the token after the expiry safety margin is reached', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token-1',
          token_type: 'Bearer',
          scope: 'Office Manager',
          expires_in: 120,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'token-2',
          token_type: 'Bearer',
          scope: 'Office Manager',
          expires_in: 120,
        }),
      })

    const { getAccessToken } = await import('@/lib/versature/auth')

    expect(await getAccessToken()).toBe('token-1')
    vi.advanceTimersByTime(61_000)
    expect(await getAccessToken()).toBe('token-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
```

Create `tests/versature/client.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

const invalidateAccessToken = vi.fn()

vi.mock('@/lib/versature/auth', () => ({
  getAccessToken: vi.fn().mockResolvedValue('token-1'),
  invalidateAccessToken,
}))

describe('versatureFetch', () => {
  test('retries once on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'nope' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })

    vi.stubGlobal('fetch', fetchMock)

    const { versatureFetch } = await import('@/lib/versature/client')
    const result = await versatureFetch('/call_queues/')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(invalidateAccessToken).toHaveBeenCalledTimes(1)
  })

  test('throws loudly when the retry also returns 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'nope' })
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'still nope' })

    vi.stubGlobal('fetch', fetchMock)

    const { versatureFetch } = await import('@/lib/versature/client')

    await expect(versatureFetch('/call_queues/')).rejects.toThrow(
      'Versature request returned 401 twice for /call_queues/',
    )
    expect(invalidateAccessToken).toHaveBeenCalledTimes(1)
  })
})

describe('extractPagedItems', () => {
  test('normalizes a verified wrapper shape into rows and cursor metadata', async () => {
    const { extractPagedItems } = await import('@/lib/versature/client')

    expect(
      extractPagedItems<{ id: string }>({
        results: [{ id: 'cdr-1' }],
        more: false,
        cursor: null,
      }),
    ).toEqual({
      items: [{ id: 'cdr-1' }],
      more: false,
      cursor: null,
    })
  })
})
```

Create `tests/versature/endpoints.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/versature/client', () => ({
  fetchAllPages: vi.fn().mockResolvedValue([{ id: 'cdr-1' }]),
  versatureFetch: vi
    .fn()
    .mockResolvedValueOnce({ calls_offered: 10, abandoned_calls: 2 })
    .mockResolvedValueOnce([{ interval: '2026-04-01T00:00:00Z', volume: 3 }])
    .mockResolvedValueOnce([{ id: '8020', description: 'English queue' }]),
}))

describe('versature endpoints', () => {
  test('wrap expected endpoint calls', async () => {
    const { getDomainCdrs, getQueueStats, getQueueSplits, listQueues } = await import(
      '@/lib/versature/endpoints'
    )

    expect(await getDomainCdrs('2026-04-01', '2026-04-01')).toEqual([{ id: 'cdr-1' }])
    expect(await getQueueStats('8020', '2026-04-01', '2026-04-01')).toEqual({
      calls_offered: 10,
      abandoned_calls: 2,
    })
    expect(await getQueueSplits('8020', '2026-04-01', '2026-04-01', 'day')).toHaveLength(1)
    expect(await listQueues()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/versature/auth.test.ts tests/versature/client.test.ts tests/versature/endpoints.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the auth, client, and endpoint files**

Before transcribing the snippets below, read `docs/versature-cdr-shape.md` and replace any wrapper-key assumptions in the `extractPagedItems(...)` test and implementation if the verified tenant shape differs from the example here.

Create `lib/versature/types.ts`:

```ts
export type VersatureCdr = {
  id?: string
  call_id?: string | null
  call_type?: string
  start_time: string
  answer_time: string | null
  end_time: string
  duration: number
  from: {
    name?: string | null
    user?: string | null
    number?: string | null
    call_id?: string | null
  }
  to: {
    id?: string | null
  }
  [key: string]: unknown
}

export type QueueStats = {
  calls_offered: number
  abandoned_calls: number
  abandoned_rate: number
  average_talk_time: number
  average_handle_time: number
}

export type QueueSplit = {
  interval: string
  volume: number
}
```

Create `lib/versature/auth.ts`:

```ts
type TokenState = {
  token: string
  expiresAt: number
}

let state: TokenState | null = null

export function invalidateAccessToken() {
  state = null
}

export async function getAccessToken() {
  if (state && Date.now() < state.expiresAt) {
    return state.token
  }

  const response = await fetch(`${process.env.VERSATURE_BASE_URL}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.VERSATURE_CLIENT_ID!,
      client_secret: process.env.VERSATURE_CLIENT_SECRET!,
    }),
  })

  if (!response.ok) {
    throw new Error(`Versature token request failed: ${response.status}`)
  }

  const payload = await response.json()
  console.log(`Versature OAuth scope: ${payload.scope}`)

  state = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in - 60) * 1000,
  }

  return state.token
}
```

Create `lib/versature/client.ts`:

```ts
import { getAccessToken, invalidateAccessToken } from './auth'

class UnauthorizedOnceError extends Error {}

function buildHeaders(token: string) {
  return {
    Accept: process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.6.0+json',
    Authorization: `Bearer ${token}`,
  }
}

export function extractPagedItems<T>(payload: unknown): {
  items: T[]
  more: boolean
  cursor: string | null
} {
  if (Array.isArray(payload)) {
    return { items: payload as T[], more: false, cursor: null }
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Versature page payload was not an object or array')
  }

  const page = payload as {
    results?: T[]
    cdrs?: T[]
    more?: boolean
    cursor?: string | null
  }

  if (Array.isArray(page.results)) {
    return { items: page.results, more: Boolean(page.more), cursor: page.cursor ?? null }
  }

  if (Array.isArray(page.cdrs)) {
    return { items: page.cdrs, more: Boolean(page.more), cursor: page.cursor ?? null }
  }

  throw new Error('Unable to find a row array in the Versature page payload')
}

export async function versatureFetch(path: string) {
  const url = `${process.env.VERSATURE_BASE_URL}${path}`

  async function attempt() {
    const token = await getAccessToken()
    const response = await fetch(url, { headers: buildHeaders(token) })

    if (response.ok) {
      return response.json()
    }

    if (response.status === 401) {
      throw new UnauthorizedOnceError(`401 from ${path}`)
    }

    throw new Error(`Versature request failed (${response.status}) for ${path}`)
  }

  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof UnauthorizedOnceError)) {
      throw error
    }
  }

  invalidateAccessToken()

  try {
    return await attempt()
  } catch (error) {
    if (error instanceof UnauthorizedOnceError) {
      throw new Error(`Versature request returned 401 twice for ${path}`)
    }

    throw error
  }
}

export async function fetchAllPages<T>(path: string) {
  const rows: T[] = []
  let cursor: string | null = null

  while (true) {
    const query = cursor ? `${path}&cursor=${encodeURIComponent(cursor)}` : path
    const payload = await versatureFetch(query)
    const page = extractPagedItems<T>(payload)
    rows.push(...page.items)

    if (!page.more) {
      return rows
    }

    cursor = page.cursor
  }
}
```

Create `lib/versature/endpoints.ts`:

```ts
import { fetchAllPages, versatureFetch } from './client'
import type { QueueSplit, QueueStats, VersatureCdr } from './types'

export function getDomainCdrs(startDate: string, endDate: string) {
  return fetchAllPages<VersatureCdr>(
    `/cdrs/users/?start_date=${startDate}&end_date=${endDate}`,
  )
}

export function getQueueStats(queueId: string, startDate: string, endDate: string) {
  return versatureFetch(
    `/call_queues/${queueId}/stats/?start_date=${startDate}&end_date=${endDate}`,
  ) as Promise<QueueStats>
}

export function getQueueSplits(
  queueId: string,
  startDate: string,
  endDate: string,
  period: 'hour' | 'day' | 'month',
) {
  return versatureFetch(
    `/call_queues/${queueId}/reports/splits/?start_date=${startDate}&end_date=${endDate}&period=${period}`,
  ) as Promise<QueueSplit[]>
}

export function listQueues() {
  return versatureFetch('/call_queues/') as Promise<Array<{ id: string; description: string }>>
}
```

Create `lib/versature/queues.ts`:

```ts
export const TARGET_DNIS = [
  process.env.DNIS_PRIMARY!,
  process.env.DNIS_SECONDARY!,
] as const

export const ENGLISH_QUEUE_ID = process.env.QUEUE_ENGLISH!
export const FRENCH_QUEUE_ID = process.env.QUEUE_FRENCH!
export const AI_OVERFLOW_QUEUE_IDS = [
  process.env.QUEUE_AI_OVERFLOW_EN!,
  process.env.QUEUE_AI_OVERFLOW_FR!,
] as const
```

Create `scripts/discover-queues.ts`:

```ts
import { listQueues } from '../lib/versature/endpoints'

async function main() {
  const queues = await listQueues()
  console.table(queues.map((queue) => ({ id: queue.id, description: queue.description })))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 4: Run the tests again**

Run:

```bash
npx vitest run tests/versature/auth.test.ts tests/versature/client.test.ts tests/versature/endpoints.test.ts
```

Expected: PASS.

- [ ] **Step 5: Smoke-test queue discovery**

Run:

```bash
npm run discover:queues
```

Expected: a printed table of queue IDs and descriptions from the real Versature account.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/versature/auth.test.ts tests/versature/client.test.ts tests/versature/endpoints.test.ts lib/versature/types.ts lib/versature/auth.ts lib/versature/client.ts lib/versature/endpoints.ts lib/versature/queues.ts scripts/discover-queues.ts
git commit -m "feat: add versature auth client and endpoint wrappers"
```

## Task 5: Persist Raw Records and Derive Logical Calls with Tests First

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/fixtures/kpi-fixtures.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/versature/logical-calls.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/db/queries.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/logical-calls.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/db/queries.ts`

- [ ] **Step 1: Write the failing logical-call tests**

Create `tests/fixtures/kpi-fixtures.ts`:

```ts
export const cdrFixtures = [
  {
    id: 'cdr-1-a',
    call_id: 'call-1',
    start_time: '2026-04-01T13:00:00Z',
    answer_time: null,
    end_time: '2026-04-01T13:00:07Z',
    duration: 7,
    from: { number: '+16135550001', user: null, name: 'Caller 1', call_id: 'call-1' },
    to: { id: '16135949199' },
  },
  {
    id: 'cdr-1-b',
    call_id: 'call-1',
    start_time: '2026-04-01T13:00:04Z',
    answer_time: '2026-04-01T13:00:03Z',
    end_time: '2026-04-01T13:01:10Z',
    duration: 67,
    from: { number: '+16135550001', user: null, name: 'Caller 1', call_id: 'call-1' },
    to: { id: '8020' },
  },
  {
    id: 'cdr-2-a',
    call_id: 'call-2',
    start_time: '2026-04-01T14:00:00Z',
    answer_time: '2026-04-01T14:00:01Z',
    end_time: '2026-04-01T14:00:04Z',
    duration: 4,
    from: { number: '+16135550002', user: null, name: 'Caller 2', call_id: 'call-2' },
    to: { id: '6135949199' },
  },
]
```

Create `tests/versature/logical-calls.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildLogicalCalls } from '@/lib/versature/logical-calls'
import { cdrFixtures } from '@/tests/fixtures/kpi-fixtures'

describe('buildLogicalCalls', () => {
  test('deduplicates multiple CDR segments into one logical call using the shared call id when present', () => {
    const logicalCalls = buildLogicalCalls(cdrFixtures)

    expect(logicalCalls).toHaveLength(2)
    expect(logicalCalls[0].dedupeKey).toBe('call-1')
    expect(logicalCalls[0].dnis).toBe('16135949199')
    expect(logicalCalls[0].answered).toBe(true)
    expect(logicalCalls[0].durationSeconds).toBe(67)
  })

  test('falls back to caller number plus Toronto-local minute bucket when no shared call id exists', () => {
    const logicalCalls = buildLogicalCalls([
      {
        id: 'cdr-fallback-a',
        start_time: '2026-04-01T13:00:02Z',
        answer_time: null,
        end_time: '2026-04-01T13:00:08Z',
        duration: 8,
        from: { number: '+16135550009', user: null, name: 'Caller 9' },
        to: { id: '16135949199' },
      },
      {
        id: 'cdr-fallback-b',
        start_time: '2026-04-01T13:00:41Z',
        answer_time: '2026-04-01T13:00:45Z',
        end_time: '2026-04-01T13:01:20Z',
        duration: 35,
        from: { number: '+16135550009', user: null, name: 'Caller 9' },
        to: { id: '8020' },
      },
    ])

    expect(logicalCalls).toHaveLength(1)
    expect(logicalCalls[0].dedupeKey).toContain('|+16135550009')
  })
})
```

Create `tests/db/queries.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildUpsertQueueStatsStatement } from '@/lib/db/queries'

describe('buildUpsertQueueStatsStatement', () => {
  test('targets queue_stats_daily by queue_id and stats_date', () => {
    const sql = buildUpsertQueueStatsStatement()
    expect(sql).toContain('insert into queue_stats_daily')
    expect(sql).toContain('on conflict (queue_id, stats_date)')
  })
})
```

Patch 1 test amendment: extend the logical-call tests above so they also assert the new attribution fields on at least one grouped call, including `routingBucket`, one or more `touched*Queue` flags, and `isVoiceAssist === false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/versature/logical-calls.test.ts tests/db/queries.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the logical-call builder and query helpers**

Before transcribing the snippets below, read `docs/versature-cdr-shape.md` and replace the `getSharedCallId(...)` field lookup and any logical-call fixture fields anywhere the verified shared identifier path differs from the example here.

Patch 1 amendment for this step:

- extend `LogicalCall` with `routingBucket`, `touchedEnglishQueue`, `touchedFrenchQueue`, `touchedAiQueue`, `isDropped`, `isBusinessHours`, and `isVoiceAssist`
- derive `routingBucket` from the last tracked queue leg in the grouped trail, not from the first leg
- set `isVoiceAssist: false` for all Part 1 rows
- derive `isDropped` from the grouped trail and terminal tracked state, never from raw `answer_time`
- populate the new columns in `replaceLogicalCallsForDate(...)` so the DB row shape matches Task 2 exactly

Create `lib/versature/logical-calls.ts`:

```ts
import { createHash } from 'node:crypto'
import { formatInTimeZone } from 'date-fns-tz'
import type { VersatureCdr } from './types'
import { TARGET_DNIS } from './queues'

export type LogicalCall = {
  callDate: string
  dedupeKey: string
  callerNumber: string | null
  dnis: string
  startTime: string
  endTime: string
  answered: boolean
  durationSeconds: number
  representativeHash: string
  payload: Record<string, unknown>
}

function hashPayload(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function getSharedCallId(cdr: VersatureCdr) {
  return cdr.call_id ?? cdr.from.call_id ?? null
}

function buildFallbackGroupKey(cdr: VersatureCdr) {
  const callerNumber = cdr.from.number ?? 'unknown'
  const localMinuteBucket = formatInTimeZone(
    new Date(cdr.start_time),
    'America/Toronto',
    "yyyy-MM-dd'T'HH:mm",
  )
  return `${localMinuteBucket}|${callerNumber}`
}

export function buildLogicalCalls(cdrs: VersatureCdr[]): LogicalCall[] {
  const grouped = new Map<string, VersatureCdr[]>()

  for (const cdr of cdrs) {
    const key = getSharedCallId(cdr) ?? buildFallbackGroupKey(cdr)
    const rows = grouped.get(key) ?? []
    rows.push(cdr)
    grouped.set(key, rows)
  }

  return [...grouped.entries()]
    .map(([dedupeKey, rows]) => {
      const dnisRepresentative = rows.find((row) =>
        TARGET_DNIS.includes(String(row.to.id) as never),
      )

      if (!dnisRepresentative || !dnisRepresentative.to.id) {
        return null
      }

      const answeredRows = rows.filter((row) => row.answer_time !== null)
      const durationSeconds =
        answeredRows.length > 0
          ? Math.max(...answeredRows.map((row) => row.duration))
          : Math.max(...rows.map((row) => row.duration))
      const latestEndTime = rows
        .map((row) => row.end_time)
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())
        .at(-1)!

      return {
        callDate: formatInTimeZone(
          new Date(dnisRepresentative.start_time),
          'America/Toronto',
          'yyyy-MM-dd',
        ),
        dedupeKey,
        callerNumber: dnisRepresentative.from.number ?? null,
        dnis: dnisRepresentative.to.id,
        startTime: dnisRepresentative.start_time,
        endTime: latestEndTime,
        answered: rows.some((row) => row.answer_time !== null),
        durationSeconds,
        representativeHash: hashPayload(dnisRepresentative),
        payload: {
          representative: dnisRepresentative,
          groupedSegmentCount: rows.length,
        } as Record<string, unknown>,
      }
    })
    .filter((value): value is LogicalCall => value !== null)
}
```

Create `lib/db/queries.ts`:

```ts
import type { PoolClient } from 'pg'
import { getPool } from './client'
import type { CdrSegmentRow, LogicalCallRow } from './schema'

export function buildUpsertQueueStatsStatement() {
  return `
    insert into queue_stats_daily (
      queue_id,
      stats_date,
      calls_offered,
      abandoned_calls,
      abandoned_rate,
      average_talk_time,
      average_handle_time,
      payload
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (queue_id, stats_date) do update set
      calls_offered = excluded.calls_offered,
      abandoned_calls = excluded.abandoned_calls,
      abandoned_rate = excluded.abandoned_rate,
      average_talk_time = excluded.average_talk_time,
      average_handle_time = excluded.average_handle_time,
      payload = excluded.payload,
      imported_at = now()
  `
}

export async function replaceLogicalCallsForDate(
  client: PoolClient,
  callDate: string,
  rows: LogicalCallRow[],
) {
  await client.query('delete from logical_calls where call_date = $1', [callDate])

  for (const row of rows) {
    await client.query(
      `
        insert into logical_calls (
          call_date, dedupe_key, caller_number, dnis, start_time, end_time,
          answered, duration_seconds, representative_hash, payload
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (call_date, dedupe_key) do update set
          caller_number = excluded.caller_number,
          dnis = excluded.dnis,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          answered = excluded.answered,
          duration_seconds = excluded.duration_seconds,
          representative_hash = excluded.representative_hash,
          payload = excluded.payload,
          imported_at = now()
      `,
      [
        row.callDate,
        row.dedupeKey,
        row.callerNumber,
        row.dnis,
        row.startTime,
        row.endTime,
        row.answered,
        row.durationSeconds,
        row.representativeHash,
        row.payload,
      ],
    )
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
```

Patch 1 override for the SQL helper above:

- the `insert into logical_calls (...)` column list must now include `routing_bucket`, `touched_english_queue`, `touched_french_queue`, `touched_ai_queue`, `is_dropped`, `is_business_hours`, and `is_voice_assist`
- the update clause must refresh those same fields on conflict
- the bound values list must match the expanded `LogicalCallRow` type from Task 2

- [ ] **Step 4: Run the tests again**

Run:

```bash
npx vitest run tests/versature/logical-calls.test.ts tests/db/queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add tests/fixtures/kpi-fixtures.ts tests/versature/logical-calls.test.ts tests/db/queries.test.ts lib/versature/logical-calls.ts lib/db/queries.ts
git commit -m "feat: add logical call derivation and db query helpers"
```

## Task 6: Implement KPI #1 with the Dual-Method Audit Check

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-1-total-incoming.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-1-total-incoming.ts`

- [ ] **Step 1: Write the failing KPI #1 test**

Create `tests/kpis/kpi-1-total-incoming.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getLogicalCallCountForPeriod: vi.fn().mockResolvedValue(25),
  getCallsOfferedForQueues: vi.fn().mockResolvedValue(24),
}))

describe('computeKpi1', () => {
  test('returns both methods and the delta percentage', async () => {
    const { computeKpi1 } = await import('@/lib/kpis/kpi-1-total-incoming')

    const result = await computeKpi1({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-01T23:59:59Z'),
    })

    expect(result.primaryCount).toBe(25)
    expect(result.queueCount).toBe(24)
    expect(result.deltaPct).toBeCloseTo(4, 0)
    expect(result.warning).toMatch(/more than 2%/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/kpis/kpi-1-total-incoming.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement KPI #1**

Create `lib/kpis/kpi-1-total-incoming.ts`:

```ts
import { AI_OVERFLOW_QUEUE_IDS, ENGLISH_QUEUE_ID, FRENCH_QUEUE_ID } from '@/lib/versature/queues'
import { getCallsOfferedForQueues, getLogicalCallCountForPeriod } from '@/lib/db/queries'

export type Kpi1Result = {
  primaryCount: number
  queueCount: number
  deltaPct: number
  warning: string | null
}

export async function computeKpi1(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
): Promise<Kpi1Result> {
  const primaryCount = await getLogicalCallCountForPeriod(period, options)
  const queueCount = await getCallsOfferedForQueues(period, [
    ENGLISH_QUEUE_ID,
    FRENCH_QUEUE_ID,
    ...AI_OVERFLOW_QUEUE_IDS,
  ], options)

  const deltaPct = queueCount === 0 ? 0 : Math.abs(primaryCount - queueCount) / queueCount * 100
  const warning =
    deltaPct > 2
      ? `KPI #1 methods differ by more than 2% (${deltaPct.toFixed(1)}%)`
      : null

  if (warning) {
    console.warn(warning)
  }

  return {
    primaryCount,
    queueCount,
    deltaPct,
    warning,
  }
}
```

- [ ] **Step 4: Add the supporting query functions**

Append to `lib/db/queries.ts`:

```ts
export async function getLogicalCallCountForPeriod(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from logical_calls
      where start_time >= $1 and start_time <= $2
        and ($3::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [period.start.toISOString(), period.end.toISOString(), options.includeWeekends ?? false],
  )

  return result.rows[0]?.count ?? 0
}

export async function getCallsOfferedForQueues(
  period: { start: Date; end: Date },
  queueIds: string[],
  options: { includeWeekends?: boolean } = {},
) {
  // stats_date is stored as the Toronto business date requested from Versature.
  const result = await getPool().query(
    `
      select coalesce(sum(calls_offered), 0)::int as count
      from queue_stats_daily
      where stats_date between $1::date and $2::date
        and queue_id = any($3::text[])
        and ($4::boolean or extract(isodow from stats_date) between 1 and 5)
    `,
    [
      period.start.toISOString().slice(0, 10),
      period.end.toISOString().slice(0, 10),
      queueIds,
      options.includeWeekends ?? false,
    ],
  )

  return result.rows[0]?.count ?? 0
}
```

- [ ] **Step 5: Run the test again**

Run:

```bash
npx vitest run tests/kpis/kpi-1-total-incoming.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/kpis/kpi-1-total-incoming.test.ts lib/kpis/kpi-1-total-incoming.ts lib/db/queries.ts
git commit -m "feat: add audited total incoming KPI"
```

## Task 7: Implement KPIs #2 Through #6 and Short Calls

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-2-dropped.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-3-english.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-4-french.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-5-ai.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-6-pct-dropped.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/short-calls.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-2-dropped.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-3-english.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-4-french.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-5-ai.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-6-pct-dropped.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/short-calls.ts`

Patch 5 plus Patch 2 override the original Task 7 source rules:

- rewrite `tests/kpis/kpi-2-dropped.test.ts` to mock `getDroppedLogicalCallCount`, not `getAbandonedCallsForQueues`
- rewrite `tests/kpis/kpi-3-english.test.ts`, `tests/kpis/kpi-4-french.test.ts`, and `tests/kpis/kpi-5-ai.test.ts` to mock `getLogicalCallCountByRoutingBucket`
- `lib/kpis/kpi-2-dropped.ts` must read from `logical_calls.is_dropped`
- `lib/kpis/kpi-3-english.ts`, `lib/kpis/kpi-4-french.ts`, and `lib/kpis/kpi-5-ai.ts` must read from the exclusive `routing_bucket` values `english`, `french`, and `ai`
- queue stats `calls_offered` and `abandoned_calls` remain available for KPI #1 reconciliation, KPI #8, and the Task 9 assertion gate, but they are no longer the final KPI #2-#5 source of truth

Use these helper signatures in `lib/db/queries.ts`:

```ts
getDroppedLogicalCallCount(period, options)
getLogicalCallCountByRoutingBucket(period, routingBucket, options)
```

- [ ] **Step 1: Write the failing tests**

Create `tests/kpis/kpi-2-dropped.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getDroppedLogicalCallCount: vi.fn().mockResolvedValue(5),
}))

describe('computeKpi2', () => {
  test('counts deduped dropped logical calls', async () => {
    const { computeKpi2 } = await import('@/lib/kpis/kpi-2-dropped')
    expect(
      await computeKpi2({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-01T23:59:59Z') }),
    ).toEqual({ totalDropped: 5 })
  })
})
```

Create `tests/kpis/short-calls.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getShortAnsweredCallCount: vi.fn().mockResolvedValue(1),
}))

describe('computeShortCalls', () => {
  test('counts only answered calls shorter than ten seconds', async () => {
    const { computeShortCalls } = await import('@/lib/kpis/short-calls')
    expect(
      await computeShortCalls({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-01T23:59:59Z') }),
    ).toEqual({ totalShortCalls: 1, thresholdSeconds: 10 })
  })
})
```

Create `tests/kpis/kpi-6-pct-dropped.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/kpis/kpi-1-total-incoming', () => ({
  computeKpi1: vi.fn().mockResolvedValue({ primaryCount: 50 }),
}))

vi.mock('@/lib/kpis/kpi-2-dropped', () => ({
  computeKpi2: vi.fn().mockResolvedValue({ totalDropped: 5 }),
}))

describe('computeKpi6', () => {
  test('derives percent dropped from KPI1 and KPI2', async () => {
    const { computeKpi6 } = await import('@/lib/kpis/kpi-6-pct-dropped')
    const result = await computeKpi6({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-01T23:59:59Z'),
    })

    expect(result.rate).toBe(0.1)
  })
})
```

Create `tests/kpis/kpi-3-english.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getLogicalCallCountByRoutingBucket: vi.fn().mockResolvedValue(50),
}))

describe('computeKpi3', () => {
  test('returns the deduped English routing bucket volume', async () => {
    const { computeKpi3 } = await import('@/lib/kpis/kpi-3-english')
    expect(
      await computeKpi3({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-01T23:59:59Z') }),
    ).toEqual({ totalEnglish: 50 })
  })
})
```

Create `tests/kpis/kpi-4-french.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getLogicalCallCountByRoutingBucket: vi.fn().mockResolvedValue(12),
}))

describe('computeKpi4', () => {
  test('returns the deduped French routing bucket volume', async () => {
    const { computeKpi4 } = await import('@/lib/kpis/kpi-4-french')
    expect(
      await computeKpi4({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-01T23:59:59Z') }),
    ).toEqual({ totalFrench: 12 })
  })
})
```

Create `tests/kpis/kpi-5-ai.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getLogicalCallCountByRoutingBucket: vi.fn().mockResolvedValue(18),
}))

describe('computeKpi5', () => {
  test('returns the deduped AI routing bucket volume', async () => {
    const { computeKpi5 } = await import('@/lib/kpis/kpi-5-ai')
    expect(
      await computeKpi5({ start: new Date('2026-04-01T00:00:00Z'), end: new Date('2026-04-01T23:59:59Z') }),
    ).toEqual({ totalAi: 18 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/kpis/kpi-2-dropped.test.ts tests/kpis/kpi-3-english.test.ts tests/kpis/kpi-4-french.test.ts tests/kpis/kpi-5-ai.test.ts tests/kpis/kpi-6-pct-dropped.test.ts tests/kpis/short-calls.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the KPI files**

Create `lib/kpis/kpi-2-dropped.ts`:

```ts
import { getDroppedLogicalCallCount } from '@/lib/db/queries'

export async function computeKpi2(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    totalDropped: await getDroppedLogicalCallCount(period, options),
  }
}
```

Create `lib/kpis/kpi-3-english.ts`:

```ts
import { getLogicalCallCountByRoutingBucket } from '@/lib/db/queries'

export async function computeKpi3(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    totalEnglish: await getLogicalCallCountByRoutingBucket(period, 'english', options),
  }
}
```

Create `lib/kpis/kpi-4-french.ts`:

```ts
import { getLogicalCallCountByRoutingBucket } from '@/lib/db/queries'

export async function computeKpi4(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    totalFrench: await getLogicalCallCountByRoutingBucket(period, 'french', options),
  }
}
```

Create `lib/kpis/kpi-5-ai.ts`:

```ts
import { getLogicalCallCountByRoutingBucket } from '@/lib/db/queries'

export async function computeKpi5(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    totalAi: await getLogicalCallCountByRoutingBucket(period, 'ai', options),
  }
}
```

Create `lib/kpis/kpi-6-pct-dropped.ts`:

```ts
import { computeKpi1 } from './kpi-1-total-incoming'
import { computeKpi2 } from './kpi-2-dropped'

export async function computeKpi6(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const incoming = await computeKpi1(period, options)
  const dropped = await computeKpi2(period, options)

  return {
    rate: incoming.primaryCount === 0 ? 0 : dropped.totalDropped / incoming.primaryCount,
    dropped: dropped.totalDropped,
    total: incoming.primaryCount,
  }
}
```

Create `lib/kpis/short-calls.ts`:

```ts
import { getShortAnsweredCallCount } from '@/lib/db/queries'

export async function computeShortCalls(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    totalShortCalls: await getShortAnsweredCallCount(period, 10, options),
    thresholdSeconds: 10,
  }
}
```

- [ ] **Step 4: Add the supporting queries**

Append to `lib/db/queries.ts`:

```ts
export async function getDroppedLogicalCallCount(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from logical_calls
      where start_time >= $1
        and start_time <= $2
        and is_dropped = true
        and ($3::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [period.start.toISOString(), period.end.toISOString(), options.includeWeekends ?? false],
  )

  return result.rows[0]?.count ?? 0
}

export async function getLogicalCallCountByRoutingBucket(
  period: { start: Date; end: Date },
  routingBucket: 'english' | 'french' | 'ai' | 'unrouted',
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from logical_calls
      where start_time >= $1
        and start_time <= $2
        and routing_bucket = $3
        and ($4::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [
      period.start.toISOString(),
      period.end.toISOString(),
      routingBucket,
      options.includeWeekends ?? false,
    ],
  )

  return result.rows[0]?.count ?? 0
}

export async function getShortAnsweredCallCount(
  period: { start: Date; end: Date },
  thresholdSeconds: number,
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from cdr_segments
      where start_time >= $1
        and start_time <= $2
        and answer_time is not null
        and duration_seconds < $3
        and to_id = any($4::text[])
        and ($5::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [
      period.start.toISOString(),
      period.end.toISOString(),
      thresholdSeconds,
      [process.env.DNIS_PRIMARY!, process.env.DNIS_SECONDARY!],
      options.includeWeekends ?? false,
    ],
  )

  return result.rows[0]?.count ?? 0
}
```

- [ ] **Step 5: Run the tests again**

Run:

```bash
npx vitest run tests/kpis/kpi-2-dropped.test.ts tests/kpis/kpi-3-english.test.ts tests/kpis/kpi-4-french.test.ts tests/kpis/kpi-5-ai.test.ts tests/kpis/kpi-6-pct-dropped.test.ts tests/kpis/short-calls.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/kpis/kpi-2-dropped.test.ts tests/kpis/short-calls.test.ts tests/kpis/kpi-6-pct-dropped.test.ts lib/kpis/kpi-2-dropped.ts lib/kpis/kpi-3-english.ts lib/kpis/kpi-4-french.ts lib/kpis/kpi-5-ai.ts lib/kpis/kpi-6-pct-dropped.ts lib/kpis/short-calls.ts lib/db/queries.ts
git commit -m "feat: add dropped volume and queue KPI modules"
```

## Task 8: Implement KPIs #7 Through #10 with Tests First

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-7-language-split.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-8-avg-length.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-9-day-of-week.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/kpi-10-hourly-length.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-7-language-split.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-8-avg-length.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-9-day-of-week.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/kpi-10-hourly-length.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/kpis/kpi-7-language-split.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/kpis/kpi-1-total-incoming', () => ({
  computeKpi1: vi.fn().mockResolvedValue({ primaryCount: 100 }),
}))
vi.mock('@/lib/kpis/kpi-3-english', () => ({
  computeKpi3: vi.fn().mockResolvedValue({ totalEnglish: 50 }),
}))
vi.mock('@/lib/kpis/kpi-4-french', () => ({
  computeKpi4: vi.fn().mockResolvedValue({ totalFrench: 20 }),
}))
vi.mock('@/lib/kpis/kpi-5-ai', () => ({
  computeKpi5: vi.fn().mockResolvedValue({ totalAi: 10 }),
}))

describe('computeKpi7', () => {
  test('returns split percentages plus unrouted residual', async () => {
    const { computeKpi7 } = await import('@/lib/kpis/kpi-7-language-split')
    const result = await computeKpi7({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-01T23:59:59Z'),
    })

    expect(result.unroutedPct).toBeCloseTo(0.2)
  })
})
```

Create `tests/kpis/kpi-9-day-of-week.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getWeekdaySplitRowsForPeriod: vi.fn().mockResolvedValue([
    { weekday: 'Mon', volume: 60 },
    { weekday: 'Mon', volume: 80 },
    { weekday: 'Tue', volume: 50 },
    { weekday: 'Tue', volume: 70 },
  ]),
}))

describe('computeKpi9', () => {
  test('averages each weekday across its occurrences in the month', async () => {
    const { computeKpi9 } = await import('@/lib/kpis/kpi-9-day-of-week')
    const result = await computeKpi9({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-30T23:59:59Z'),
    })

    expect(result.series).toEqual([
      { day: 'Mon', average: 70 },
      { day: 'Tue', average: 60 },
    ])
  })
})
```

Create `tests/kpis/kpi-8-avg-length.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getAverageTalkTimes: vi.fn().mockResolvedValue([
    { queue_id: '8020', average_seconds: 180 },
    { queue_id: '8021', average_seconds: 210 },
  ]),
}))

describe('computeKpi8', () => {
  test('returns average talk time rows by queue', async () => {
    const { computeKpi8 } = await import('@/lib/kpis/kpi-8-avg-length')
    const result = await computeKpi8({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-30T23:59:59Z'),
    })

    expect(result.rows).toHaveLength(2)
  })
})
```

Create `tests/kpis/kpi-10-hourly-length.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/db/queries', () => ({
  getAverageAnsweredDurationByHour: vi.fn().mockResolvedValue([
    { hour: 8, average_seconds: 120 },
    { hour: 9, average_seconds: 180 },
  ]),
}))

describe('computeKpi10', () => {
  test('returns average answered duration grouped by hour', async () => {
    const { computeKpi10 } = await import('@/lib/kpis/kpi-10-hourly-length')
    const result = await computeKpi10({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-30T23:59:59Z'),
    })

    expect(result.series[0]).toEqual({ hour: 8, average_seconds: 120 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/kpis/kpi-7-language-split.test.ts tests/kpis/kpi-8-avg-length.test.ts tests/kpis/kpi-9-day-of-week.test.ts tests/kpis/kpi-10-hourly-length.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the KPI files**

Create `lib/kpis/kpi-7-language-split.ts`:

```ts
import { computeKpi1 } from './kpi-1-total-incoming'
import { computeKpi3 } from './kpi-3-english'
import { computeKpi4 } from './kpi-4-french'
import { computeKpi5 } from './kpi-5-ai'

export async function computeKpi7(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const [incoming, english, french, ai] = await Promise.all([
    computeKpi1(period, options),
    computeKpi3(period, options),
    computeKpi4(period, options),
    computeKpi5(period, options),
  ])

  const total = incoming.primaryCount || 1
  const englishPct = english.totalEnglish / total
  const frenchPct = french.totalFrench / total
  const aiPct = ai.totalAi / total

  return {
    englishPct,
    frenchPct,
    aiPct,
    unroutedPct: Math.max(0, 1 - (englishPct + frenchPct + aiPct)),
  }
}
```

Create `lib/kpis/kpi-8-avg-length.ts`:

```ts
import { getAverageTalkTimes } from '@/lib/db/queries'

export async function computeKpi8(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    rows: await getAverageTalkTimes(period, options),
  }
}
```

Create `lib/kpis/kpi-9-day-of-week.ts`:

```ts
import { getWeekdaySplitRowsForPeriod } from '@/lib/db/queries'

export async function computeKpi9(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const rows = await getWeekdaySplitRowsForPeriod(period, options)
  const totals = new Map<string, { sum: number; count: number }>()

  for (const row of rows) {
    const current = totals.get(row.weekday) ?? { sum: 0, count: 0 }
    current.sum += row.volume
    current.count += 1
    totals.set(row.weekday, current)
  }

  return {
    series: [...totals.entries()].map(([day, value]) => ({
      day,
      average: value.sum / value.count,
    })),
  }
}
```

Create `lib/kpis/kpi-10-hourly-length.ts`:

```ts
import { getAverageAnsweredDurationByHour } from '@/lib/db/queries'

export async function computeKpi10(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  return {
    series: await getAverageAnsweredDurationByHour(period, options),
  }
}
```

- [ ] **Step 4: Add the supporting query helpers**

Append to `lib/db/queries.ts`:

```ts
export async function getAverageTalkTimes(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  // stats_date is stored as the Toronto business date requested from Versature.
  const result = await getPool().query(
    `
      select queue_id, round(avg(average_talk_time))::int as average_seconds
      from queue_stats_daily
      where stats_date between $1::date and $2::date
        and ($3::boolean or extract(isodow from stats_date) between 1 and 5)
      group by queue_id
      order by queue_id
    `,
    [
      period.start.toISOString().slice(0, 10),
      period.end.toISOString().slice(0, 10),
      options.includeWeekends ?? false,
    ],
  )

  return result.rows
}

export async function getWeekdaySplitRowsForPeriod(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select to_char(interval_start at time zone 'America/Toronto', 'Dy') as weekday,
             volume
      from queue_splits
      where split_period = 'day'
        and interval_start >= $1
        and interval_start <= $2
        and ($3::boolean or extract(isodow from interval_start at time zone 'America/Toronto') between 1 and 5)
    `,
    [period.start.toISOString(), period.end.toISOString(), options.includeWeekends ?? false],
  )

  return result.rows
}

export async function getAverageAnsweredDurationByHour(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select extract(hour from start_time at time zone 'America/Toronto')::int as hour,
             round(avg(duration_seconds))::int as average_seconds
      from cdr_segments
      where start_time >= $1
        and start_time <= $2
        and answer_time is not null
        and to_id = any($3::text[])
        and ($4::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
        and extract(hour from start_time at time zone 'America/Toronto') between 8 and 18
      group by hour
      order by hour
    `,
    [
      period.start.toISOString(),
      period.end.toISOString(),
      [process.env.DNIS_PRIMARY!, process.env.DNIS_SECONDARY!],
      options.includeWeekends ?? false,
    ],
  )

  return result.rows
}

export async function getLastSuccessfulIngestAt() {
  const result = await getPool().query(
    `
      select completed_at
      from ingest_runs
      where status = 'completed'
      order by completed_at desc
      limit 1
    `,
  )

  return result.rows[0]?.completed_at
    ? new Date(result.rows[0].completed_at).toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
      })
    : null
}
```

- [ ] **Step 5: Run the tests again**

Run:

```bash
npx vitest run tests/kpis/kpi-7-language-split.test.ts tests/kpis/kpi-8-avg-length.test.ts tests/kpis/kpi-9-day-of-week.test.ts tests/kpis/kpi-10-hourly-length.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/kpis/kpi-7-language-split.test.ts tests/kpis/kpi-8-avg-length.test.ts tests/kpis/kpi-9-day-of-week.test.ts tests/kpis/kpi-10-hourly-length.test.ts lib/kpis/kpi-7-language-split.ts lib/kpis/kpi-8-avg-length.ts lib/kpis/kpi-9-day-of-week.ts lib/kpis/kpi-10-hourly-length.ts lib/db/queries.ts
git commit -m "feat: add split and duration KPI modules"
```

## Task 9: Implement Sync Orchestration, Refresh Route, and Audit Script

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/assertions.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/kpis/get-dashboard-data.test.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/assertions.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/versature/sync.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/lib/kpis/get-dashboard-data.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/api/refresh/route.ts`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/scripts/audit-day.ts`

Patch 3 amendment for this task:

- add `lib/kpis/assertions.ts` with an `assertPart1Invariants(snapshot)` helper
- add `tests/kpis/assertions.test.ts` to prove the gate fails loudly when KPI #2 or KPI #3-#5 exceed KPI #1
- call the assertion helper after `getDashboardData(...)` and before the ingest run is marked complete
- surface broken invariants through `ingest_runs.warnings` and the thrown error path so operators can see exactly which assertion failed

- [ ] **Step 1: Write the failing dashboard aggregator test**

Create `tests/kpis/get-dashboard-data.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/kpis/kpi-1-total-incoming', () => ({
  computeKpi1: vi.fn().mockResolvedValue({ primaryCount: 25, queueCount: 24, deltaPct: 4, warning: 'warn' }),
}))
vi.mock('@/lib/kpis/kpi-2-dropped', () => ({
  computeKpi2: vi.fn().mockResolvedValue({ totalDropped: 5 }),
}))
vi.mock('@/lib/kpis/short-calls', () => ({
  computeShortCalls: vi.fn().mockResolvedValue({ totalShortCalls: 1, thresholdSeconds: 10 }),
}))

describe('getDashboardData', () => {
  test('returns a normalized dashboard payload', async () => {
    const { getDashboardData } = await import('@/lib/kpis/get-dashboard-data')
    const data = await getDashboardData({
      start: new Date('2026-04-01T00:00:00Z'),
      end: new Date('2026-04-01T23:59:59Z'),
    })

    expect(data.kpi1.primaryCount).toBe(25)
    expect(data.shortCalls.totalShortCalls).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/kpis/get-dashboard-data.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Implement the sync orchestrator**

Before transcribing the snippet below, read `docs/versature-cdr-shape.md` and swap the raw CDR upsert conflict target away from `source_hash` if Task 0 confirmed that `external_id` is reliable on every row.

Create `lib/versature/sync.ts`:

```ts
import { createHash } from 'node:crypto'
import { formatInTimeZone } from 'date-fns-tz'
import { getDomainCdrs, getQueueSplits, getQueueStats } from './endpoints'
import { AI_OVERFLOW_QUEUE_IDS, ENGLISH_QUEUE_ID, FRENCH_QUEUE_ID } from './queues'
import { buildLogicalCalls } from './logical-calls'
import { replaceLogicalCallsForDate, withTransaction } from '@/lib/db/queries'
import { assertPart1Invariants } from '@/lib/kpis/assertions'
import { getDashboardData } from '@/lib/kpis/get-dashboard-data'
import { getPool } from '@/lib/db/client'

function hashPayload(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function syncDay(day: Date) {
  const dateKey = formatInTimeZone(day, 'America/Toronto', 'yyyy-MM-dd')
  const run = await getPool().query(
    `
      insert into ingest_runs (run_type, start_date, end_date, status)
      values ($1, $2, $3, 'running')
      returning id
    `,
    ['manual-refresh', dateKey, dateKey],
  )
  try {
    const cdrs = await getDomainCdrs(dateKey, dateKey)
    const logicalCalls = buildLogicalCalls(cdrs)

    const queueIds = [ENGLISH_QUEUE_ID, FRENCH_QUEUE_ID, ...AI_OVERFLOW_QUEUE_IDS]
    const queueStats = await Promise.all(queueIds.map((queueId) => getQueueStats(queueId, dateKey, dateKey)))
    const daySplits = await Promise.all(queueIds.map((queueId) => getQueueSplits(queueId, dateKey, dateKey, 'day')))

    await withTransaction(async (client) => {
      for (const cdr of cdrs) {
        await client.query(
          `
            insert into cdr_segments (
              source_hash, external_id, call_type, start_time, answer_time, end_time,
              duration_seconds, from_number, from_name, from_user, to_id, payload
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            on conflict (source_hash) do update set payload = excluded.payload
          `,
          [
            hashPayload(cdr),
            cdr.id ?? null,
            cdr.call_type ?? null,
            cdr.start_time,
            cdr.answer_time,
            cdr.end_time,
            cdr.duration,
            cdr.from.number ?? null,
            cdr.from.name ?? null,
            cdr.from.user ?? null,
            cdr.to.id ?? null,
            cdr,
          ],
        )
      }

      await replaceLogicalCallsForDate(client, dateKey, logicalCalls)

      for (const [index, stats] of queueStats.entries()) {
        await client.query(
          `
            insert into queue_stats_daily (
              queue_id, stats_date, calls_offered, abandoned_calls, abandoned_rate,
              average_talk_time, average_handle_time, payload
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8)
            on conflict (queue_id, stats_date) do update set
              calls_offered = excluded.calls_offered,
              abandoned_calls = excluded.abandoned_calls,
              abandoned_rate = excluded.abandoned_rate,
              average_talk_time = excluded.average_talk_time,
              average_handle_time = excluded.average_handle_time,
              payload = excluded.payload,
              imported_at = now()
          `,
          [
            queueIds[index],
            dateKey,
            stats.calls_offered,
            stats.abandoned_calls,
            stats.abandoned_rate,
            stats.average_talk_time,
            stats.average_handle_time,
            stats,
          ],
        )
      }

      await client.query(
        `delete from queue_splits where split_period = 'day' and interval_start::date = $1::date`,
        [dateKey],
      )

      for (const [index, splits] of daySplits.entries()) {
        for (const split of splits) {
          await client.query(
            `
              insert into queue_splits (queue_id, split_period, interval_start, volume, payload)
              values ($1,$2,$3,$4,$5)
              on conflict (queue_id, split_period, interval_start) do update set
                volume = excluded.volume,
                payload = excluded.payload,
                imported_at = now()
            `,
            [queueIds[index], 'day', split.interval, split.volume, split],
          )
        }
      }
    })

    const period = {
      start: new Date(`${dateKey}T00:00:00-04:00`),
      end: new Date(`${dateKey}T23:59:59-04:00`),
    }

    const snapshot = await getDashboardData(period, { includeWeekends: false })
    const assertionWarnings = assertPart1Invariants(snapshot)

    if (assertionWarnings.length > 0) {
      await getPool().query(
        `
          update ingest_runs
          set warnings = $2
          where id = $1
        `,
        [run.rows[0].id, JSON.stringify(assertionWarnings)],
      )

      throw new Error(`Part 1 assertion gate failed: ${assertionWarnings.join('; ')}`)
    }

    await withTransaction(async (client) => {
      await client.query(
        `
          insert into kpi_daily_snapshots (snapshot_date, payload)
          values ($1, $2)
          on conflict (snapshot_date) do update set
            payload = excluded.payload,
            updated_at = now()
        `,
        [dateKey, snapshot],
      )
    })

    await getPool().query(
      `
        update ingest_runs
        set status = 'completed', completed_at = now()
        where id = $1
      `,
      [run.rows[0].id],
    )
  } catch (error) {
    await getPool().query(
      `
        update ingest_runs
        set status = 'failed', error_message = $2, completed_at = now()
        where id = $1
      `,
      [run.rows[0].id, error instanceof Error ? error.message : String(error)],
    )

    throw error
  }
}
```

- [ ] **Step 4: Implement the dashboard aggregator, refresh route, and audit script**

Create `lib/kpis/get-dashboard-data.ts`:

```ts
import { computeKpi1 } from './kpi-1-total-incoming'
import { computeKpi2 } from './kpi-2-dropped'
import { computeKpi3 } from './kpi-3-english'
import { computeKpi4 } from './kpi-4-french'
import { computeKpi5 } from './kpi-5-ai'
import { computeKpi6 } from './kpi-6-pct-dropped'
import { computeKpi7 } from './kpi-7-language-split'
import { computeKpi8 } from './kpi-8-avg-length'
import { computeKpi9 } from './kpi-9-day-of-week'
import { computeKpi10 } from './kpi-10-hourly-length'
import { computeShortCalls } from './short-calls'

export async function getDashboardData(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const [
    kpi1,
    kpi2,
    kpi3,
    kpi4,
    kpi5,
    kpi6,
    kpi7,
    kpi8,
    kpi9,
    kpi10,
    shortCalls,
  ] = await Promise.all([
    computeKpi1(period, options),
    computeKpi2(period, options),
    computeKpi3(period, options),
    computeKpi4(period, options),
    computeKpi5(period, options),
    computeKpi6(period, options),
    computeKpi7(period, options),
    computeKpi8(period, options),
    computeKpi9(period, options),
    computeKpi10(period, options),
    computeShortCalls(period, options),
  ])

  return { kpi1, kpi2, kpi3, kpi4, kpi5, kpi6, kpi7, kpi8, kpi9, kpi10, shortCalls }
}

// PART-2: ConnectWise correlation KPIs plug in below this line.
```

Create `app/api/refresh/route.ts`:

```ts
import { eachDayOfInterval } from 'date-fns'
import { NextRequest, NextResponse } from 'next/server'
import { syncDay } from '@/lib/versature/sync'

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  let startDate = new Date().toISOString().slice(0, 10)
  let endDate = startDate

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}))
    startDate = body.startDate ?? body.date ?? startDate
    endDate = body.endDate ?? body.date ?? endDate
  } else {
    const formData = await request.formData().catch(() => null)
    startDate = String(formData?.get('startDate') ?? formData?.get('date') ?? startDate)
    endDate = String(formData?.get('endDate') ?? formData?.get('date') ?? endDate)
  }

  for (const day of eachDayOfInterval({
    start: new Date(`${startDate}T12:00:00-04:00`),
    end: new Date(`${endDate}T12:00:00-04:00`),
  })) {
    await syncDay(day)
  }

  return NextResponse.json({ ok: true, startDate, endDate })
}
```

Create `scripts/audit-day.ts`:

```ts
import { getDashboardData } from '../lib/kpis/get-dashboard-data'

async function main() {
  const dateArg = process.argv[2]
  if (!dateArg) {
    throw new Error('Usage: npm run audit:day -- 2026-04-01')
  }

  const period = {
    start: new Date(`${dateArg}T00:00:00-04:00`),
    end: new Date(`${dateArg}T23:59:59-04:00`),
  }

  const data = await getDashboardData(period)

  console.table([
    {
      metric: 'Deduped DNIS calls',
      value: data.kpi1.primaryCount,
    },
    {
      metric: 'Queue-offered total',
      value: data.kpi1.queueCount,
    },
    {
      metric: 'Delta %',
      value: data.kpi1.deltaPct.toFixed(1),
    },
    {
      metric: 'Dropped calls',
      value: data.kpi2.totalDropped,
    },
    {
      metric: 'Short calls',
      value: data.shortCalls.totalShortCalls,
    },
  ])
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 5: Run the test again**

Run:

```bash
npx vitest run tests/kpis/get-dashboard-data.test.ts
```

      Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/kpis/assertions.test.ts tests/kpis/get-dashboard-data.test.ts lib/kpis/assertions.ts lib/versature/sync.ts lib/kpis/get-dashboard-data.ts app/api/refresh/route.ts scripts/audit-day.ts
git commit -m "feat: add sync flow refresh api and audit script"
```

## Task 10: Build the Dashboard UI with a Server-Render Smoke Test

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/tests/app/page.test.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/components/KpiCard.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/components/LanguageSplitChart.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/components/DayOfWeekChart.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/components/HourlyDurationChart.tsx`
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/components/PeriodToggle.tsx`
- Modify: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/app/page.tsx`

- [ ] **Step 1: Write the failing server-render smoke test**

Create `tests/app/page.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/kpis/get-dashboard-data', () => ({
  getDashboardData: vi.fn().mockResolvedValue({
    kpi1: { primaryCount: 25, queueCount: 24, deltaPct: 4, warning: null },
    kpi2: { totalDropped: 5 },
    kpi3: { totalEnglish: 10 },
    kpi4: { totalFrench: 5 },
    kpi5: { totalAi: 10 },
    kpi6: { rate: 0.2 },
    kpi7: { englishPct: 0.4, frenchPct: 0.2, aiPct: 0.2, unroutedPct: 0.2 },
    kpi8: { rows: [] },
    kpi9: { series: [] },
    kpi10: { series: [] },
    shortCalls: { totalShortCalls: 1, thresholdSeconds: 10 },
  }),
}))

describe('dashboard page', () => {
  test('renders the KPI and chart section headings', async () => {
    const Page = (await import('@/app/page')).default
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))

    expect(html).toContain('CSH Dashboard')
    expect(html).toContain('Total Incoming Calls')
    expect(html).toContain('AI Voice Assist Health')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/app/page.test.tsx
```

Expected: FAIL because the dashboard components and final page structure do not exist yet.

- [ ] **Step 3: Implement the components**

Create `app/components/KpiCard.tsx`:

```tsx
type Props = {
  label: string
  value: string
  helper?: string
  tone?: 'default' | 'good' | 'bad'
}

export function KpiCard({ label, value, helper, tone = 'default' }: Props) {
  const toneClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-900'

  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-3 text-3xl font-semibold ${toneClass}`}>{value}</p>
      {helper ? <p className="mt-2 text-xs text-slate-500">{helper}</p> : null}
    </article>
  )
}
```

Create `app/components/PeriodToggle.tsx`:

```tsx
import Link from 'next/link'

export function PeriodToggle({
  current,
  includeWeekends,
}: {
  current: 'today' | 'this-week' | 'this-month'
  includeWeekends: boolean
}) {
  const items = [
    { key: 'today', label: 'Today' },
    { key: 'this-week', label: 'This Week' },
    { key: 'this-month', label: 'This Month' },
  ] as const

  return (
    <div className="inline-flex rounded-full border border-slate-200 p-1">
      {items.map((item) => (
        <Link
          key={item.key}
          href={`/?period=${item.key}${includeWeekends ? '&includeWeekends=true' : ''}`}
          className={`rounded-full px-4 py-2 text-sm ${
            item.key === current ? 'bg-slate-900 text-white' : 'text-slate-600'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
```

Create `app/components/LanguageSplitChart.tsx`:

```tsx
import { PieChart, Pie, Cell } from 'recharts'

export function LanguageSplitChart({ data }: { data: Array<{ name: string; value: number }> }) {
  const colors = ['#0f172a', '#475569', '#94a3b8', '#cbd5e1']

  return (
    <PieChart width={320} height={240}>
      <Pie data={data} dataKey="value" nameKey="name" cx={160} cy={120} outerRadius={80}>
        {data.map((entry, index) => (
          <Cell key={entry.name} fill={colors[index % colors.length]} />
        ))}
      </Pie>
    </PieChart>
  )
}
```

Create `app/components/DayOfWeekChart.tsx`:

```tsx
import { BarChart, Bar, XAxis, YAxis } from 'recharts'

export function DayOfWeekChart({ data }: { data: Array<{ day: string; average: number }> }) {
  return (
    <BarChart width={640} height={260} data={data}>
      <XAxis dataKey="day" />
      <YAxis />
      <Bar dataKey="average" fill="#0f172a" radius={[6, 6, 0, 0]} />
    </BarChart>
  )
}
```

Create `app/components/HourlyDurationChart.tsx`:

```tsx
import { LineChart, Line, XAxis, YAxis } from 'recharts'

export function HourlyDurationChart({
  data,
}: {
  data: Array<{ hour: number; average_seconds: number }>
}) {
  return (
    <LineChart width={640} height={260} data={data}>
      <XAxis dataKey="hour" />
      <YAxis />
      <Line type="monotone" dataKey="average_seconds" stroke="#0f172a" strokeWidth={2} />
    </LineChart>
  )
}
```

- [ ] **Step 4: Replace `app/page.tsx` with the real dashboard composition**

Replace `app/page.tsx`:

```tsx
      import { KpiCard } from './components/KpiCard'
import { PeriodToggle } from './components/PeriodToggle'
import { LanguageSplitChart } from './components/LanguageSplitChart'
import { DayOfWeekChart } from './components/DayOfWeekChart'
import { HourlyDurationChart } from './components/HourlyDurationChart'
import { getDashboardData } from '@/lib/kpis/get-dashboard-data'
import { getLastSuccessfulIngestAt } from '@/lib/db/queries'
import { getPeriodRange } from '@/lib/utils/dates'
import { formatDuration } from '@/lib/utils/format'
import Link from 'next/link'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const period = params.period === 'this-week' || params.period === 'this-month' ? params.period : 'today'
  const includeWeekends = params.includeWeekends === 'true'
  const range = getPeriodRange(period)
  const data = await getDashboardData(range, { includeWeekends })
  const lastRefreshed = await getLastSuccessfulIngestAt()

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">CSH Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Period: {range.label}</p>
          <p className="mt-1 text-xs text-slate-500">
            Last refreshed: {lastRefreshed ?? 'No completed sync yet'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodToggle current={period} includeWeekends={includeWeekends} />
          <Link
            href={`/?period=${period}${includeWeekends ? '' : '&includeWeekends=true'}`}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600"
          >
            {includeWeekends ? 'Exclude Weekends' : 'Include Weekends'}
          </Link>
          <form action="/api/refresh" method="post">
            <input type="hidden" name="startDate" value={range.start.toISOString().slice(0, 10)} />
            <input type="hidden" name="endDate" value={range.end.toISOString().slice(0, 10)} />
            <button className="rounded-full bg-slate-900 px-4 py-2 text-sm text-white" type="submit">
              Refresh
            </button>
          </form>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total Incoming Calls" value={String(data.kpi1.primaryCount)} helper={data.kpi1.warning ?? 'DNIS logical-call count'} />
        <KpiCard label="Total Dropped Calls" value={String(data.kpi2.totalDropped)} tone="bad" />
        <KpiCard label="English Incoming" value={String(data.kpi3.totalEnglish)} />
        <KpiCard label="French Incoming" value={String(data.kpi4.totalFrench)} />
        <KpiCard label="AI / Overflow Calls" value={String(data.kpi5.totalAi)} />
        <KpiCard label="% Dropped" value={`${(data.kpi6.rate * 100).toFixed(1)}%`} tone="bad" />
        <KpiCard label="Short Calls (&lt;10s)" value={String(data.shortCalls.totalShortCalls)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Avg Call Length by Queue</h2>
            <p className="mt-1 text-sm text-slate-600">Queue-stats talk time, shown separately to keep all four queues readable.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpi8.rows.map((row: { queue_id: string; average_seconds: number }) => (
            <div key={row.queue_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{row.queue_id}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatDuration(row.average_seconds)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Language Split</h2>
          <LanguageSplitChart
            data={[
              { name: 'English', value: data.kpi7.englishPct },
              { name: 'French', value: data.kpi7.frenchPct },
              { name: 'AI', value: data.kpi7.aiPct },
              { name: 'Unrouted', value: data.kpi7.unroutedPct },
            ]}
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Avg Call Length per Hour</h2>
          <HourlyDurationChart data={data.kpi10.series} />
        </div>
        {period === 'this-month' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-2">
            <h2 className="text-lg font-semibold">Avg Calls per Day-of-Week</h2>
            <DayOfWeekChart data={data.kpi9.series} />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold">AI Voice Assist Health</h2>
        <p className="mt-2 text-sm text-slate-600">Reserved for Part 2 after Part 1 manual validation.</p>
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Run the test again**

Run:

```bash
npx vitest run tests/app/page.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/app/page.test.tsx app/components/KpiCard.tsx app/components/LanguageSplitChart.tsx app/components/DayOfWeekChart.tsx app/components/HourlyDurationChart.tsx app/components/PeriodToggle.tsx app/page.tsx
git commit -m "feat: add dashboard page and KPI components"
```

## Task 11: Finish README, Verification, and Manual Audit Gate

**Files:**
- Create: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard/README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

```md
# CSH Dashboard

## Setup

1. Copy `.env.local.example` to `.env.local`.
2. Fill in the Versature client credentials and queue IDs.
3. Make sure PostgreSQL is running and `DATABASE_URL` points to it.
4. Run `npm install`.
5. Run `npm run db:migrate`.

## Net2Phone / Versature App Setup

1. In the Net2Phone developer portal, create a new application for this internal dashboard.
2. Enable the Client Credentials grant for that app.
3. Copy the client ID and client secret into `.env.local`.
4. Confirm the tenant's documented media type before overriding `VERSATURE_API_VERSION`.

## Environment Variables

- `VERSATURE_BASE_URL`: Versature API base URL for your tenant.
- `VERSATURE_CLIENT_ID`: OAuth client ID for the dashboard integration.
- `VERSATURE_CLIENT_SECRET`: OAuth client secret for the dashboard integration.
- `VERSATURE_API_VERSION`: Accept header media type. Leave the default unless your tenant documents a newer one.
- `DATABASE_URL`: PostgreSQL connection string for the local dashboard database.
- `QUEUE_ENGLISH`: English queue ID.
- `QUEUE_FRENCH`: French queue ID.
- `QUEUE_AI_OVERFLOW_EN`: English AI overflow queue ID.
- `QUEUE_AI_OVERFLOW_FR`: French AI overflow queue ID.
- `DNIS_PRIMARY`: Primary tracked CSH DNIS.
- `DNIS_SECONDARY`: Secondary tracked CSH DNIS.

## Run

- `npm run dev` starts the local dashboard.
- `npm run discover:queues` prints the available queue IDs from Versature.
- `npm run audit:day -- 2026-04-01` prints the manual-validation audit for a day.

## Refresh

`POST /api/refresh` syncs a day of data from Versature into PostgreSQL.

## Metric Notes

- Short Calls is a caller-engagement metric. It counts quick DNIS-touching answered segments, including auto-attendant-answered edges, and must not be reinterpreted as a human-answered-only metric.

## Troubleshooting

If numbers look wrong, check these first:

1. Are you counting raw CDRs instead of logical calls? Re-run the audit script and compare the logical-call total to the raw segment total before trusting KPI #1.
2. Are you still sourcing KPI #2-#5 from queue stats? Use deduped `logical_calls` with `routing_bucket` and `is_dropped` for those KPIs; keep queue stats for reconciliation only.
3. Are you treating `answer_time` as proof that a human answered? Treat it only as a duration signal. Dropped-call status must come from grouped logical-call disposition, not raw segment answer flags.
```

- [ ] **Step 2: Run the full test suite**

Run:

```bash
cd /Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard
npm test
```

Expected: all Vitest suites PASS.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: `Compiled successfully` with no type errors.

- [ ] **Step 4: Run the real-world audit gate**

Run:

```bash
npm run audit:day -- 2026-04-01
```

Expected:
- a printed DNIS logical-call count
- a printed queue-offered total
- a printed delta percentage
- a clear dropped-call total
- a short-call total
- no assertion-gate failures for the synced day

Then manually compare the printed counts to the operator's historical day count. Do not start Part 2 until this check is signed off.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md
git commit -m "docs: add setup and audit instructions"
```

## Self-Review

### Spec coverage

- Greenfield Next.js structure: covered in Tasks 1, 10, and 11.
- PostgreSQL override: covered in Tasks 2, 5, and 9.
- Versature OAuth and endpoint wrapping: covered in Task 4.
- Dedupe and CDR-vs-call guardrail: covered in Tasks 5, 6, and the patch amendments.
- Deduped KPI #2-#5 attribution: covered in Task 7 plus Patch 2 and Patch 5.
- Assertion gate: covered in Task 9 plus Patch 3.
- KPIs 1-10 and Short Calls: covered in Tasks 6, 7, and 8.
- Manual refresh endpoint: covered in Task 9.
- Manual audit before Part 2: covered in Task 11.
- README and troubleshooting: covered in Task 11.

### Placeholder scan

- No `TODO`, `TBD`, or "implement later" language remains.
- Every planned code change includes concrete file paths.
- Every test step includes an actual command and expected result.

### Type consistency

- Queue IDs consistently use `QUEUE_ENGLISH`, `QUEUE_FRENCH`, `QUEUE_AI_OVERFLOW_EN`, and `QUEUE_AI_OVERFLOW_FR`.
- Logical-call attribution consistently uses `routing_bucket` values `english`, `french`, `ai`, and `unrouted`.
- KPI functions consistently accept `{ start: Date; end: Date }`.
- KPI #1 consistently exposes `primaryCount`, `queueCount`, `deltaPct`, and `warning`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-09-csh-dashboard-part-1-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
