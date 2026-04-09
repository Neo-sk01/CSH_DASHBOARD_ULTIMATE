# CSH Dashboard Part 1 Design

Date: 2026-04-09
Project root: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`
Status: Approved for planning, not yet implemented

## Goal

Build Part 1 of the CSH Call Analytics Dashboard as a new local-first internal Next.js application for NeoLore. Part 1 covers the 10 Versature-backed KPIs plus the required "Short Calls (<10s)" operational metric. Part 2 is explicitly out of scope until Part 1 is manually validated.

This design follows the user's approved override to use PostgreSQL as the storage layer for Part 1 instead of the original prompt's file-cache-only v1. All KPI definitions, counting rules, and audit requirements from the prompt remain intact.

## Non-Negotiable Counting Rules

These rules are the core of the system and must be enforced in code, tests, docs, and operator workflows:

1. Raw CDR count is not call count.
   A single real-world customer call can produce 3-5+ CDR segments across auto attendants, queues, and extensions.

2. `call_type === 'Incoming'` is never enough to count queue-entering calls.
   DNIS filtering must be applied for DNIS-based counts, and queue stats must be used for queue-level totals.

3. `answer_time` does not prove a human answered the call.
   Auto attendant behavior can populate `answer_time`, so dropped-call logic must come from queue stats `abandoned_calls`, not CDR inference.

## Build Scope

Part 1 only:

- Next.js dashboard with Today / This Week / This Month views
- Versature OAuth client-credentials integration
- Persisted raw Versature data in PostgreSQL
- Derived logical-call model to prevent CDR overcounting
- KPIs 1-10 from the prompt
- Short Calls (<10s) as a separate operational metric
- Manual refresh and manual audit workflow
- Tests and documentation

Out of scope for Part 1:

- ConnectWise integration
- AI CSV ingestion
- Part 2 KPIs and panels
- Authentication and multi-user roles

## User-Approved Runtime Choices

- Package manager: `npm`
- Runtime target: local-first
- Prompt fidelity: strict, except for the user-approved Postgres storage override
- AI queues for KPI #5: aggregate both `QUEUE_AI_OVERFLOW_EN=8030` and `QUEUE_AI_OVERFLOW_FR=8031`

## Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- Recharts
- Native server-side `fetch`
- `date-fns`
- `date-fns-tz`
- PostgreSQL for persisted source data and derived daily KPI storage
- Vitest for tests
- `pg` for PostgreSQL access
- `tsx` for local scripts

## Project Structure

The project keeps the prompt's greenfield structure and adds an explicit database layer:

```text
csh-dashboard/
├── .env.local.example
├── README.md
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── api/
│   │   └── refresh/route.ts
│   └── components/
│       ├── KpiCard.tsx
│       ├── LanguageSplitChart.tsx
│       ├── DayOfWeekChart.tsx
│       ├── HourlyDurationChart.tsx
│       └── PeriodToggle.tsx
├── db/
│   └── migrations/
├── lib/
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── queries.ts
│   ├── versature/
│   │   ├── auth.ts
│   │   ├── client.ts
│   │   ├── endpoints.ts
│   │   ├── types.ts
│   │   └── queues.ts
│   ├── connectwise/
│   │   └── .gitkeep
│   ├── kpis/
│   │   ├── kpi-1-total-incoming.ts
│   │   ├── kpi-2-dropped.ts
│   │   ├── kpi-3-english.ts
│   │   ├── kpi-4-french.ts
│   │   ├── kpi-5-ai.ts
│   │   ├── kpi-6-pct-dropped.ts
│   │   ├── kpi-7-language-split.ts
│   │   ├── kpi-8-avg-length.ts
│   │   ├── kpi-9-day-of-week.ts
│   │   └── kpi-10-hourly-length.ts
│   ├── filters/
│   │   ├── weekends.ts
│   │   └── dnis.ts
│   └── utils/
│       ├── dates.ts
│       └── format.ts
├── scripts/
│   ├── discover-queues.ts
│   └── audit-day.ts
└── tests/
    └── kpis/
```

## Data Architecture

PostgreSQL is the single source of truth for Part 1.

### Tables

`cdr_segments`
- Raw CDR rows from `GET /cdrs/users/`
- Stores original payload plus normalized columns used for filtering and grouping
- Must prefer the verified Versature row `id` as the source identifier if Task 0 confirms it is reliably present on every segment; otherwise retain a documented derived-hash fallback

`queue_stats_daily`
- One row per queue per day
- Stores `calls_offered`, `abandoned_calls`, `abandoned_rate`, `average_talk_time`, and `average_handle_time`

`queue_splits`
- Split-report rows used for day-of-week and other chart calculations

`logical_calls`
- Derived representation of real-world calls built from raw CDR segments
- Exists specifically to prevent accidental overcounting from segment-level data

`kpi_daily_snapshots`
- Daily KPI payloads for day-level reuse and week/month assembly
- Convenience layer only; raw persisted Versature data remains authoritative

`ingest_runs`
- Sync attempts, status, record counts, warnings, and error details

## Ingest and Normalization Flow

### Source ingestion

`POST /api/refresh` triggers a sync flow that:

1. Authenticates with Versature via OAuth client credentials
2. Pulls paginated CDRs for the target day or date range
3. Pulls queue stats for English, French, AI overflow EN, and AI overflow FR
4. Pulls queue splits required for charting KPIs
5. Upserts all raw source records into PostgreSQL

### Logical-call derivation

After raw CDR persistence, the app rebuilds affected `logical_calls` rows.

The logical-call grouping strategy must be verified against one real historical day before implementation. That preflight must confirm both the actual CDR page wrapper and whether Versature exposes a shared call identifier across AA, queue, and answered legs.

Once that verification is written down in `docs/versature-cdr-shape.md`, logical-call derivation must follow these rules:

- use the verified shared call identifier as the primary dedupe key when one exists across segments
- otherwise fall back to caller number plus a Toronto-local minute bucket
- restrict KPI #1 to groups touching the tracked DNIS values
- use the DNIS-touching segment only to label the tracked DNIS
- derive `answered` from whether any segment in the group has `answer_time`
- derive `duration_seconds` from the longest answered segment, or from the longest segment overall if none were answered

This is the mechanism that protects the dashboard from the "CDRs are not calls" failure mode.

### Daily snapshot derivation

For each affected date:

1. Recompute KPI inputs from persisted raw and derived data
2. Store KPI daily snapshots
3. Store any KPI #1 delta warning when CDR-dedupe and queue-stats totals differ by more than 2%

Week and month views are assembled from stored daily data, not from fresh period-wide API pulls.

## KPI Source Rules

### KPI #1: Total Incoming Calls

Implement both methods and compare them:

- Method A: count DNIS-filtered `logical_calls`
- Method B: sum `calls_offered` across English, French, AI overflow EN, and AI overflow FR queues

Return both counts plus delta percentage. Log and persist a warning when the variance exceeds 2%.

### KPI #2: Total Dropped Calls

Use only queue stats `abandoned_calls`, summed across English, French, AI overflow EN, and AI overflow FR.

### KPI #3 and #4

Use queue stats `calls_offered` for English and French respectively.

### KPI #5: AI / Overflow Calls

Sum `calls_offered` for both AI overflow queues.

### KPI #6: % Dropped

Derived from KPI #1 and KPI #2, with queue-stats abandoned rate exposed as a sanity check.

### KPI #7: Language Split

Derived from English, French, AI totals, and total incoming calls, with residual displayed as unrouted.

### KPI #8: Avg Call Length

Use queue stats `average_talk_time`, shown per queue grouping.

### KPI #9: Avg Calls per Day-of-Week

Use stored split data across the full month, averaging by weekday occurrence count.

### KPI #10: Avg Call Length per Hour

Use persisted CDR data only for duration analysis after:

- DNIS filtering
- `answer_time IS NOT NULL`
- weekend filtering unless explicitly overridden

This KPI must not reuse CDR answer logic for dropped-call inference.

### Short Calls (<10s)

Separate operational metric:

- answered CDRs only
- `duration < 10`
- DNIS-filtered
- caller-engagement metric, not a human-answered-only metric

It must not be merged into dropped calls, and the README must explicitly warn future maintainers not to "fix" the auto-attendant edge case by turning this into a human-answer metric.

## Date and Business Rules

- Timezone: `America/Toronto`
- Default weekend handling: exclude Saturday and Sunday
- Optional override: `?includeWeekends=true`
- "This week" means Monday through Friday, capped at today when earlier
- Business-hours fields from the provided env may exist, but Part 1 scope remains the prompt-defined Today / This Week / This Month views and weekend toggle

## UI Design

Single-page dashboard with four vertical regions:

1. Header strip
   - period toggle
   - last refreshed timestamp
   - manual refresh button
   - weekend toggle

2. KPI card grid
   - KPIs 1-7
   - Short Calls card as required operational companion metric
   - small delta vs prior equivalent period where practical
   - inline KPI #1 warning when logical-call and queue-stats methods drift

3. Charts row
   - Avg Call Length by Queue as its own multi-row panel
   - Language Split donut
   - Day-of-Week bar chart for month view
   - Hourly Duration line chart

4. Reserved Part 2 slot
   - labeled placeholder for future AI Voice Assist Health section

Design tone:
- internal and corporate
- white background
- slate-heavy palette
- clear warnings for KPI #1 audit mismatches

## Scripts and Operator Workflow

### `scripts/discover-queues.ts`

One-shot setup script that lists queues and descriptions from Versature so operators can verify IDs.

### `scripts/audit-day.ts`

Manual validation helper that prints:

- deduped DNIS call count
- queue-stats offered total
- delta percentage
- dropped-call total
- short-call total
- representative logical-call samples for spot-checking

This script is part of the Part 1 completion gate.

## Testing Strategy

### Unit tests

One test file per KPI under `tests/kpis/`, covering:

- 100 raw CDRs collapsing to 25 logical calls
- English queue offered and abandoned values
- day-of-week month averaging
- weekend exclusion
- short-call identification from answered calls under 10 seconds

### Integration-style data tests

Add tests that exercise the Postgres-backed normalization path to prove the persistence layer does not reintroduce overcounting.

## Documentation Requirements

`README.md` must include:

- local setup
- env var list with a short purpose note for each variable
- how to create the Net2Phone developer app with client-credentials grant
- how to run local Postgres
- how to sync data
- how to run queue discovery
- how to run day-level audit validation
- troubleshooting checklist naming all three core counting pitfalls and the corrective action for each one

`.env.local.example` must contain placeholders only, never real secrets.

## Acceptance Gate for Part 1

Part 1 is complete only when all of the following are true:

1. `npm run dev` starts the dashboard locally
2. Versature OAuth token exchange works and logs token scope
3. Sync writes raw CDRs, queue stats, split rows, logical calls, and KPI daily snapshots into Postgres
4. KPI #1 dual-method check is available and warns when variance exceeds 2%
5. All tests pass
6. A real historical day is manually validated against human counting
7. Work stops after Part 1 and waits for explicit approval before Part 2 begins

## Risks to Watch

- Overcounting from accidentally aggregating raw CDR segments
- Silent misuse of `call_type === 'Incoming'`
- False dropped-call inference from `answer_time`
- Drift between logical-call derivation and queue-stats totals
- Hidden assumptions caused by two AI overflow queues being aggregated into one KPI card

## Implementation Direction

The next step after user review of this spec is to create a written implementation plan, then execute Part 1 top-to-bottom:

1. verify the real CDR wrapper, shared call identifier, and raw row identifier on a historical day
2. scaffold app and database foundation
3. build Versature auth/client layer
4. implement and test KPI #1 first
5. implement remaining KPIs in order
6. build UI
7. run manual audit on a real day
8. stop for human validation before Part 2
