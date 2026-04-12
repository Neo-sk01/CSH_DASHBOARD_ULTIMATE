# Implementation Plan Patch — Part 1 CSH Dashboard

**Applies to:** `Analytics Dashboard Codex Part 1 Implementation Plan` (the Codex-generated plan with Tasks 0–11)
**Purpose:** Close architectural gaps that would reproduce the existing language-split and queue-stats-vs-dedup bug class, before Task 5 ships and the shape becomes hard to change.
**Scope:** Surgical edits only. The plan's overall structure, TDD approach, Task 0 preflight, and review patches C1–C4/S1–S6 are preserved as-written.

---

## Patch 1 — Expand `logical_calls` schema with classification fields

**Affects:** Task 2 (migration), Task 5 (logical call builder), Task 7 (KPI 3/4/5 rewrites in Patch 2)

**Problem:** The current `logical_calls` table carries `answered`, `duration_seconds`, `dnis`, and timestamps — but no classification. This means KPIs 3/4/5 can't be computed from deduped data even if we want to, forcing them into the queue-stats path. It also means Part 2 (ConnectWise, and eventually MSP Process) will need a schema migration on day one.

**Add to `db/migrations/001_initial.sql`, inside the `logical_calls` table definition:**

```sql
-- Classification fields (populated by buildLogicalCalls)
answered_in_queue       text,           -- canonical queue where the call was answered, or null if dropped
terminal_queue          text,           -- last queue the call was in before ending
language_answered       text not null,  -- 'english' | 'french' | 'ai' | 'other'
is_voice_assist         boolean not null default false,  -- reserved for Part 2 MSP Process
is_business_hours       boolean not null,  -- true if start_time falls in Mon-Fri 08:00-16:59 local
talk_duration_seconds   integer,        -- sum of segment talk time where answer_time is not null; null if never answered
```

Also add an index:

```sql
create index if not exists idx_logical_calls_language on logical_calls (call_date, language_answered);
```

**Update `lib/db/schema.ts` `LogicalCallRow` type accordingly.**

**Update `lib/versature/logical-calls.ts` `buildLogicalCalls` to populate these fields:**

The queue classification logic uses the env config from Task 4's `lib/versature/queues.ts`. Add a helper that maps a raw queue ID to a canonical bucket:

```typescript
// lib/versature/queues.ts — additions
export const QUEUE_BUCKETS = {
  [process.env.QUEUE_ENGLISH!]: 'english',
  [process.env.QUEUE_FRENCH!]: 'french',
  [process.env.QUEUE_AI_OVERFLOW_EN!]: 'ai',
  [process.env.QUEUE_AI_OVERFLOW_FR!]: 'ai',
} as const

export type LanguageBucket = 'english' | 'french' | 'ai' | 'other'

export function bucketForQueueId(queueId: string | null | undefined): LanguageBucket {
  if (!queueId) return 'other'
  return (QUEUE_BUCKETS[queueId] as LanguageBucket) ?? 'other'
}
```

Then in `buildLogicalCalls`, after determining `rows` per dedup group, compute:

```typescript
// Find the segment where answer_time first became non-null — that's the answering queue
const answeredSegment = rows
  .filter((row) => row.answer_time !== null)
  .sort((a, b) => new Date(a.answer_time!).getTime() - new Date(b.answer_time!).getTime())[0]
const answeredInQueue = answeredSegment?.to.id ?? null
const terminalQueue = rows[rows.length - 1]?.to.id ?? null

const languageAnswered: LanguageBucket = answeredInQueue
  ? bucketForQueueId(answeredInQueue)
  : bucketForQueueId(terminalQueue)  // for dropped calls, use where they ended

// Talk duration = sum of (end - answer) across answered segments
const talkDurationSeconds =
  answeredRows.length === 0
    ? null
    : answeredRows.reduce((total, row) => {
        const answerMs = new Date(row.answer_time!).getTime()
        const endMs = new Date(row.end_time).getTime()
        return total + Math.max(0, Math.round((endMs - answerMs) / 1000))
      }, 0)

// Business hours in America/Toronto
const startLocal = toZonedTime(new Date(dnisRepresentative.start_time), 'America/Toronto')
const isBusinessHours =
  startLocal.getDay() >= 1 && startLocal.getDay() <= 5 &&
  startLocal.getHours() >= 8 && startLocal.getHours() < 17
```

**Update `tests/versature/logical-calls.test.ts` to assert the new fields on the existing fixtures.** The existing two-segment fixture (call-1 crosses DNIS → queue 8020) should produce `languageAnswered: 'english'`, `answeredInQueue: '8020'`, and `talkDurationSeconds: 67` (from the answered segment's answer→end window).

---

## Patch 2 — Compute KPIs #3, #4, #5 from `logical_calls`, use queue stats as cross-check only

**Affects:** Task 7

**Problem:** The current plan sources KPI #3 (English), #4 (French), and #5 (AI) from `queue_stats_daily.calls_offered`, while KPI #1 (Total Incoming) comes from deduped `logical_calls`. KPI #6 (% Dropped) and KPI #7 (Language Split) then divide one source by the other, producing percentages that can sum to 140%+ when callers overflow between queues. The `unroutedPct = max(0, 1 - sum)` clamp in the current KPI #7 silently hides the contradiction.

**Rewrite `lib/db/queries.ts` to add a deduped language counter:**

```typescript
export async function getLogicalCallCountByLanguage(
  period: { start: Date; end: Date },
  language: 'english' | 'french' | 'ai' | 'other',
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from logical_calls
      where start_time >= $1 and start_time <= $2
        and language_answered = $3
        and ($4::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [period.start.toISOString(), period.end.toISOString(), language, options.includeWeekends ?? false],
  )
  return result.rows[0]?.count ?? 0
}
```

**Rewrite `lib/kpis/kpi-3-english.ts` (and symmetrically for KPIs 4 and 5):**

```typescript
import { ENGLISH_QUEUE_ID } from '@/lib/versature/queues'
import { getCallsOfferedForQueues, getLogicalCallCountByLanguage } from '@/lib/db/queries'

export type Kpi3Result = {
  primaryCount: number      // from logical_calls.language_answered
  queueCount: number        // from queue_stats_daily.calls_offered (cross-check)
  deltaPct: number
  warning: string | null
  totalEnglish: number      // alias for primaryCount — what downstream code reads
}

export async function computeKpi3(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
): Promise<Kpi3Result> {
  const primaryCount = await getLogicalCallCountByLanguage(period, 'english', options)
  const queueCount = await getCallsOfferedForQueues(period, [ENGLISH_QUEUE_ID], options)
  const deltaPct = queueCount === 0 ? 0 : Math.abs(primaryCount - queueCount) / queueCount * 100
  const warning =
    deltaPct > 10
      ? `KPI #3 methods differ by ${deltaPct.toFixed(1)}% (expected — queue stats double-count overflowing callers)`
      : null
  return { primaryCount, queueCount, deltaPct, warning, totalEnglish: primaryCount }
}
```

Note the warning threshold is 10% for KPIs 3/4/5, not 2% like KPI #1. Queue stats for language buckets are *expected* to diverge from deduped answered-in counts because of overflow — the warning is only informational. Use 2% only for the deduped-vs-deduped reconciliation checks.

**Apply the same rewrite to `lib/kpis/kpi-4-french.ts` and `lib/kpis/kpi-5-ai.ts`.**

**Update the existing tests `tests/kpis/kpi-3-english.test.ts` etc. to mock both query functions:**

```typescript
vi.mock('@/lib/db/queries', () => ({
  getLogicalCallCountByLanguage: vi.fn().mockResolvedValue(48),
  getCallsOfferedForQueues: vi.fn().mockResolvedValue(50),
}))

test('returns deduped English count plus queue-stats cross-check', async () => {
  const { computeKpi3 } = await import('@/lib/kpis/kpi-3-english')
  const result = await computeKpi3({ start: new Date(...), end: new Date(...) })
  expect(result.totalEnglish).toBe(48)
  expect(result.queueCount).toBe(50)
  expect(result.deltaPct).toBeCloseTo(4, 0)
  expect(result.warning).toBeNull()  // 4% < 10% threshold
})
```

**Net effect:** KPI #7 language split now divides deduped language counts by deduped total, which sums to 100% ± `other`/`unrouted` by construction. KPI #7's `unroutedPct = 1 - (englishPct + frenchPct + aiPct)` is no longer a math rescue; it's the legitimate "calls that touched a non-tracked queue or no tracked queue" bucket.

---

## Patch 3 — Add assertion gate to `getDashboardData`

**Affects:** Task 9

**Problem:** There's no global consistency check on the final dashboard payload. If something goes wrong upstream (a new Versature field changes meaning, a classification bug slips through, a queue ID gets removed from env), the bad numbers render in the UI and the audit catches them only on human inspection.

**Create `lib/kpis/assertions.ts`:**

```typescript
export class ReportConsistencyError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown>) {
    super(message)
    this.name = 'ReportConsistencyError'
  }
}

export function assertReportConsistent(data: {
  kpi1: { primaryCount: number }
  kpi2: { totalDropped: number }
  kpi3: { totalEnglish: number }
  kpi4: { totalFrench: number }
  kpi5: { totalAi: number }
  kpi6: { rate: number }
  kpi7: { englishPct: number; frenchPct: number; aiPct: number; unroutedPct: number }
}) {
  // 1. Language percentages sum cleanly
  const pctSum = data.kpi7.englishPct + data.kpi7.frenchPct + data.kpi7.aiPct + data.kpi7.unroutedPct
  if (pctSum < 0.99 || pctSum > 1.01) {
    throw new ReportConsistencyError(
      `Language percentages sum to ${(pctSum * 100).toFixed(2)}%, expected ~100%`,
      { kpi7: data.kpi7 },
    )
  }

  // 2. Dropped rate in valid range
  if (data.kpi6.rate < 0 || data.kpi6.rate > 1) {
    throw new ReportConsistencyError(
      `Dropped rate ${data.kpi6.rate} out of [0, 1]`,
      { kpi1: data.kpi1, kpi2: data.kpi2 },
    )
  }

  // 3. Language counts don't exceed total (can be less due to 'other' bucket)
  const langSum = data.kpi3.totalEnglish + data.kpi4.totalFrench + data.kpi5.totalAi
  if (langSum > data.kpi1.primaryCount) {
    throw new ReportConsistencyError(
      `Language counts (${langSum}) exceed total incoming (${data.kpi1.primaryCount}) — classification leak`,
      { langSum, primary: data.kpi1.primaryCount },
    )
  }

  // 4. Dropped cannot exceed total
  if (data.kpi2.totalDropped > data.kpi1.primaryCount) {
    throw new ReportConsistencyError(
      `Dropped (${data.kpi2.totalDropped}) exceeds total incoming (${data.kpi1.primaryCount})`,
      { kpi1: data.kpi1, kpi2: data.kpi2 },
    )
  }
}
```

**Call it in `lib/kpis/get-dashboard-data.ts` just before return:**

```typescript
import { assertReportConsistent } from './assertions'
// ... existing code ...
const result = { kpi1, kpi2, kpi3, kpi4, kpi5, kpi6, kpi7, kpi8, kpi9, kpi10, shortCalls }
assertReportConsistent(result)
return result
```

**Add `tests/kpis/assertions.test.ts`** covering: valid report passes, language sum of 110% throws, dropped > total throws, language sum of 90% (with 10% unrouted) passes.

**Runtime behavior:** A failing assertion throws from the dashboard route and the UI shows an error boundary. This is intentional — a dashboard that silently publishes a 538% language split is worse than a dashboard that's broken loudly for ten minutes while the cause is investigated.

---

## Patch 5 — KPI #2 (Dropped) should also be deduped

**Affects:** Task 7

**Problem:** The current plan sources KPI #2 from `queue_stats_daily.abandoned_calls` summed across queues. This is the same inflation problem as KPIs 3/4/5: a call that rang English, overflowed to AI, and was abandoned in AI will appear in the abandoned_calls count once, but if it was abandoned in *both* (rang English for 15 sec, hung up during transfer, or similar), it could be counted in multiple queues' `abandoned_calls`.

More importantly, mixing a queue-stats numerator (dropped) with a deduped denominator (total incoming) in KPI #6 is exactly the kind of source mismatch the rebuild is trying to eliminate.

**Add a deduped dropped counter to `lib/db/queries.ts`:**

```typescript
export async function getLogicalCallDroppedCount(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const result = await getPool().query(
    `
      select count(*)::int as count
      from logical_calls
      where start_time >= $1 and start_time <= $2
        and answered = false
        and ($3::boolean or extract(isodow from start_time at time zone 'America/Toronto') between 1 and 5)
    `,
    [period.start.toISOString(), period.end.toISOString(), options.includeWeekends ?? false],
  )
  return result.rows[0]?.count ?? 0
}
```

**Rewrite `lib/kpis/kpi-2-dropped.ts` to match the KPI #1 dual-method shape:**

```typescript
import { AI_OVERFLOW_QUEUE_IDS, ENGLISH_QUEUE_ID, FRENCH_QUEUE_ID } from '@/lib/versature/queues'
import { getAbandonedCallsForQueues, getLogicalCallDroppedCount } from '@/lib/db/queries'

export async function computeKpi2(
  period: { start: Date; end: Date },
  options: { includeWeekends?: boolean } = {},
) {
  const primaryCount = await getLogicalCallDroppedCount(period, options)
  const queueCount = await getAbandonedCallsForQueues(period, [
    ENGLISH_QUEUE_ID,
    FRENCH_QUEUE_ID,
    ...AI_OVERFLOW_QUEUE_IDS,
  ], options)
  const deltaPct = queueCount === 0 ? 0 : Math.abs(primaryCount - queueCount) / queueCount * 100
  const warning =
    deltaPct > 10
      ? `KPI #2 methods differ by ${deltaPct.toFixed(1)}%`
      : null
  return { totalDropped: primaryCount, queueCount, deltaPct, warning }
}
```

Both KPI #1 and KPI #2 now come from `logical_calls`, and KPI #6 becomes a pure deduped ratio.

---

## What NOT to change

These things in the plan are correct and should stay as-written:

- **Task 0 preflight** (verifying CDR shape before coding). This is smart. Keep it.
- **Task 6 KPI #1 dual-method audit.** The 2% warning threshold is appropriate for the total-incoming reconciliation and catches Versature API drift.
- **KPI #8 (Avg Call Length) sourcing from `queue_stats_daily.average_talk_time`.** This is questionable but not worth fixing in Part 1 — it will be replaced entirely by MSP Process data in Part 2 for the AI slice, and the human-queue averages from Versature are at least dimensionally correct. Revisit when Part 2 lands.
- **Short Calls as a separate metric, not bundled into "dropped."** The plan's approach (short calls = "answered but very quick, exposed as informational flag") is cleaner than my spec's `quick_hangup` sub-category and makes the dropped rate easier to reason about. Keep it.
- **TDD structure and per-KPI file organization.** Matches `lib/metrics/` layout from v2 §7.
- **Weekend exclusion as `includeWeekends` option.** Aligns with v3 Amendment B.
- **Review patches C1–C4 and S1–S6.** All correct.

---

## Order of application

Apply the patches in this order. Each one is a small PR that can be reviewed independently.

1. **Patch 1** (expand schema) — lands with Task 2. Sets up the data model the other patches need.
2. **Patch 5** (dedup KPI #2) — lands with Task 7. Smallest change, proves the pattern.
3. **Patch 2** (dedup KPIs 3/4/5) — lands with Task 7. Same pattern, more surface area.
4. **Patch 3** (assertion gate) — lands with Task 9. Requires Patches 1, 2, 5 to be complete so the gate has real invariants to check.

---

## Deferred to Part 2

Things this patch intentionally does *not* address because they belong to Part 2's scope:

- **MSP Process integration.** The plan treats AI as a Versature queue. Part 2 will need to replace KPI #5 sourcing with MSP Process's `AiCallHistory` and reconcile against the Versature queue counts (see v4 amendment §3, KPI 20 Reconciliation Gap).
- **Voice Assist vs AI Overflow distinction.** `is_voice_assist` is added to the schema in Patch 1 as a placeholder, defaulting to `false`. Part 2 populates it from MSP Process.
- **ConnectWise ticket match rate.** Entirely Part 2 scope. See v4 amendment §3 KPI 18 — the match rate is now a ticket-exists check, not a phone+time matcher.
- **AI quality score KPI.** New KPI from MSP Process's `EvaluationScore` field. See v4 amendment §3 KPI 19.
- **Business-hours-only KPI variants.** The plan has `isBusinessHours` on `logical_calls` (added by Patch 1) but doesn't surface BH-only KPIs in Part 1. Part 2 or a later phase can add the toggle.

---

**End of patch document.**