# CSH Dashboard Part 2 ConnectWise Correlation Design

Date: 2026-04-09
Project root: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`
Depends on: Approved Part 1 dashboard design and implementation plan
Status: Drafted from approved brainstorming decisions, pending user review

## Goal

Extend the CSH Call Analytics Dashboard with a ConnectWise ticket-correlation module that answers one operational question:

> For each call in the existing Phase 1 AI/overflow candidate bucket, did the AI workflow produce a ConnectWise ticket, and what happened to that ticket afterward?

This Part 2 design is additive only. It does not modify the source rules, counting rules, or implementation boundaries for KPI #1 through KPI #10 from Part 1.

## Why Part 2 Exists

Phase 1 establishes a trustworthy call-reporting foundation. It tells the business how many relevant calls entered the monitored experience, how those calls were routed, and what happened at the telephony layer.

Part 2 adds the next business question:

- did the AI-related call produce a ticket at all
- did it produce a normal ticket, a catchall failure-mode ticket, or a ticket that was later merged
- once a ticket existed, did it remain healthy from an SLA perspective

This separation is intentional.

Why this choice was made:

- Part 1 and Part 2 answer different layers of the operational story
- if Part 2 changed Phase 1 logic at the same time it added new KPIs, stakeholders would not know whether a number changed because the business changed or because the counting rules changed
- additive design protects trust and makes the rollout easier to validate

## Relationship to Part 1

Part 2 must preserve these Part 1 boundaries:

- Phase 1 KPI logic remains authoritative for call selection and call attribution
- Part 2 reuses the exact same candidate set as Phase 1 KPI #5's AI/overflow queue bucket
- Part 2 must not redefine "AI-handled call" more narrowly than the already-approved KPI #5 bucket
- Part 2 must not change KPI #1 through KPI #10 source rules, formulas, or UI behavior

Why these rules are fixed:

- the business already accepted the KPI #5 denominator for Phase 1
- reusing that denominator keeps Part 2 interpretable
- if Part 2 silently changed which calls count as "AI-related," then any new ticket-creation rate would be hard to trust because the top-line denominator would have moved

## Non-Negotiable Part 2 Rules

These rules must be enforced in code, tests, docs, and operator-facing UI:

1. Part 2 uses the exact same AI/overflow candidate call set as Phase 1 KPI #5.
   Why: this keeps the denominator stable and avoids redefining the business meaning of AI-related calls.

2. Correlation uses time plus normalized phone number, not `enteredBy = MSPProcess`.
   Why: merge workflows can overwrite or obscure authorship fields, but the time-and-phone event still preserves what happened.

3. The correlation window is 5 minutes after call end.
   Why: this is the approved trust budget. Wider windows increase false positives. Narrower windows increase false negatives.

4. `Z-SPAM` is the only spam/failure-mode company bucket for KPI #12.
   Why: the team confirmed it is the one true catchall bucket, which keeps the KPI precise and defensible.

5. A ticket counts as merged only when `mergedIntoTicketId` is present.
   Why: this gives KPI #13 a single auditable system signal rather than a fuzzy mix of statuses or workflow interpretations.

6. ConnectWise failures must surface as unavailable or error states, never as silent `no-match` outcomes.
   Why: a broken integration must not impersonate poor AI performance.

7. Every important interpretation caveat must be available inside the platform through info buttons, inline notices, or modals.
   Why: stakeholders should not have to remember the technical spec to interpret the dashboard correctly.

8. The ConnectWise follow-up action in the audit table must be honest about its current capabilities.
   Why: until the exact phone-search deep-link pattern is confirmed, the UI must show a disclaimer, a safe fallback, and clear error handling so users are not confused.

## Scope

In scope for Part 2:

- ConnectWise Manage API integration using public/private key auth plus ClientID
- ticket fetching for the reporting period with boundary buffers
- phone normalization shared between CDR and ConnectWise data
- time-plus-phone correlation for the existing KPI #5 call set
- KPI #11 through KPI #14
- a new dashboard section: `AI Voice Assist Health`
- operator-facing explanation surfaces for correlation caveats and KPI interpretation
- an uncorrelated-calls audit table with fallback follow-up actions
- tests, error handling, README updates, and manual validation workflow

Out of scope for this Part 2 design:

- changing the definition of KPI #5
- changing any existing Phase 1 KPI
- broadening spam detection beyond `Z-SPAM`
- counting merged tickets through custom statuses
- requiring ConnectWise audit-trail fetches for initial merge detection
- automatic remediation actions inside ConnectWise
- multi-tenant or role-based access control

## Runtime and Configuration

### Stack Additions

Part 2 keeps the Part 1 stack and adds only the ConnectWise Manage REST API.

- ConnectWise Manage REST API
- existing Next.js App Router application
- existing TypeScript, React, Tailwind CSS, Recharts, `pg`, `date-fns`, `date-fns-tz`, `tsx`, and Vitest

Why this choice was made:

- the module should feel like a natural extension of the existing dashboard
- no new framework means less integration risk and less onboarding burden

### Environment Variables

Add these placeholders to `.env.local.example`:

```env
CONNECTWISE_SITE=
CONNECTWISE_COMPANY_ID=
CONNECTWISE_PUBLIC_KEY=
CONNECTWISE_PRIVATE_KEY=
CONNECTWISE_CLIENT_ID=
AI_SERVICE_USER=MSPProcess
SPAM_COMPANY_IDENTIFIER=Z-SPAM
```

Notes:

- `AI_SERVICE_USER` remains documented for diagnostics and operator context, but it is not the primary correlation key
- `SPAM_COMPANY_IDENTIFIER` should default to `Z-SPAM` and remain overridable only if business policy changes later

Why these choices were made:

- the module needs explicit configuration for ConnectWise access
- keeping `AI_SERVICE_USER` visible helps documentation and troubleshooting even though matching does not rely on it
- the default for `SPAM_COMPANY_IDENTIFIER` captures the confirmed business rule without hard-wiring the value irreversibly

## Project Structure Additions

The module should remain additive and isolated:

```text
csh-dashboard/
├── db/
│   └── migrations/
│       └── 002_connectwise_correlation.sql
├── lib/
│   ├── connectwise/
│   │   ├── client.ts
│   │   ├── endpoints.ts
│   │   ├── types.ts
│   │   └── correlate.ts
│   ├── db/
│   │   └── connectwise-queries.ts
│   ├── kpis/
│   │   ├── kpi-11-tickets-created.ts
│   │   ├── kpi-12-spam-rate.ts
│   │   ├── kpi-13-merge-rate.ts
│   │   └── kpi-14-sla-health.ts
│   └── utils/
│       └── phone.ts
├── app/
│   └── components/
│       ├── TicketCorrelationCard.tsx
│       ├── SlaHealthChart.tsx
│       ├── UncorrelatedCallsTable.tsx
│       ├── KpiInfoButton.tsx
│       ├── ExplanationModal.tsx
│       └── InlineDisclaimer.tsx
├── tests/
│   ├── connectwise/
│   │   └── correlate.test.ts
│   ├── utils/
│   │   └── phone.test.ts
│   └── kpis/
│       ├── kpi-11.test.ts
│       ├── kpi-12.test.ts
│       ├── kpi-13.test.ts
│       └── kpi-14.test.ts
└── README.md
```

Why this structure was chosen:

- ConnectWise access, phone cleanup, KPI math, and UI explanation surfaces each have a single purpose
- isolating the new code helps keep Part 1 stable
- the additional DB migration and query module keep Part 2 consistent with the approved Postgres-first architecture from Part 1

## Data Architecture

### Postgres-First Consistency

Part 1 explicitly replaced the original file-cache-first prompt with PostgreSQL as the single source of truth. Part 2 must follow that same architecture instead of assuming a file-cache layer that does not exist in the approved Part 1 docs.

Why this choice was made:

- it keeps the system internally consistent
- it avoids introducing a one-off storage pattern just for Part 2
- it preserves the Part 1 principle that reporting inputs and derived outputs should remain inspectable and auditable in PostgreSQL

### New Tables

`connectwise_tickets`
- stores normalized snapshots of fetched ConnectWise tickets
- keeps both raw payload and the normalized fields required for correlation and SLA reporting
- keyed by ConnectWise ticket ID

`connectwise_correlations`
- stores one correlation result per logical call candidate for a given business date
- tracks the chosen outcome: `matched`, `matched_spam`, `matched_merged`, or `no_match`
- stores the chosen ticket ID when a match exists
- stores `parent_ticket_id` when `mergedIntoTicketId` is present
- stores the normalized call phone used during correlation for auditability

`kpi_daily_snapshots`
- continues as the daily KPI snapshot store
- gains Part 2 payloads for KPI #11 through KPI #14 instead of introducing a second snapshot system

`ingest_runs`
- continues as the cross-source operational record
- must store ConnectWise fetch errors, correlation warnings, and Part 2 computation warnings separately from Part 1 events

Why these table choices were made:

- raw ticket snapshots must be inspectable after the fact
- correlation results need their own persisted record so past days can be reviewed without recomputing every view live
- reusing the existing KPI snapshot pattern keeps dashboard assembly consistent

### Business Date Semantics

Part 2 should reuse the same Toronto-local business-date treatment as Part 1 for cross-day reporting and daily snapshots.

Why this choice was made:

- Part 1 already established Toronto-local business dates
- mixing UTC day boundaries in Part 2 would make cross-module comparisons confusing

## ConnectWise Client Design

### Authentication

Use ConnectWise Manage API headers built from:

- company ID
- public key
- private key
- ClientID

Do not implement OAuth.

Why this choice was made:

- it matches the user's confirmed ConnectWise credential model
- it avoids unnecessary auth complexity

### Fetch Boundaries

For a requested reporting period:

- fetch tickets where `dateEntered >= period.start - 5 minutes`
- fetch tickets where `dateEntered <= period.end + 5 minutes`

Why this wider fetch is allowed:

- it prevents edge-of-period misses
- it does not widen the actual correlation rule, because the match still only allows tickets created between call end and call end plus 5 minutes

### Ticket Fields

The normalized ticket model should expose:

- `id`
- `summary`
- `company`
- `contact`
- `contactPhone`
- `dateEntered`
- `enteredBy`
- `status`
- `slaStatus`
- `resolvedDateTime`
- `mergedIntoTicketId`

Design note:

- `enteredBy` is still valuable for diagnostics and explanation, but it is not part of the primary match rule

## Phone Normalization

Create `lib/utils/phone.ts` with a pure function:

```ts
export function normalizePhone(raw: string): string | null
```

Normalization rules:

- strip everything except digits and a leading `+`
- drop extensions after markers like `x`, `ext`, or `,`
- if 10 digits remain, prepend `+1`
- if 11 digits remain and start with `1`, prepend `+`
- return `null` if fewer than 10 digits remain after cleanup

Why this choice was made:

- the same number appears differently across Net2Phone and ConnectWise
- normalization makes the comparison about identity rather than formatting
- returning `null` on weak input is safer than forcing a risky guess

Required tests:

- `(613) 594-9199`
- `613-594-9199 x102`
- `+1 613 594 9199`
- `6135949199`
- `16135949199`
- `invalid`

Expected results:

- all valid forms normalize to `+16135949199`
- invalid input returns `null`

## Correlation Model

### Inputs

Calls must come from the exact Phase 1 KPI #5 AI/overflow candidate set, with each row exposing:

- `call_id`
- `from_number`
- `end_time`
- `duration`

Tickets must come from the buffered ConnectWise ticket fetch for the reporting period.

Why this input definition was chosen:

- it keeps Part 2 tied to an already-approved business denominator
- it avoids duplicating or re-deriving call selection logic in a second place

### Match Algorithm

Implement a pure function in `lib/connectwise/correlate.ts`:

```ts
type CorrelationResult =
  | { kind: 'matched'; ticket: Ticket }
  | { kind: 'matched-spam'; ticket: Ticket }
  | { kind: 'matched-merged'; ticket: Ticket; parentId: number }
  | { kind: 'no-match' }
```

Algorithm rules:

1. normalize the call phone
2. if normalization fails, return `no-match`
3. compare only tickets whose normalized phone equals the normalized call phone
4. compare only tickets whose `dateEntered` is greater than or equal to the call `end_time`
5. compare only tickets whose `dateEntered` is within 5 minutes after the call `end_time`
6. if several tickets match, choose the earliest-created ticket
7. classify the chosen ticket:
   - `matched-spam` if `company === SPAM_COMPANY_IDENTIFIER`
   - `matched-merged` if `mergedIntoTicketId` is present
   - `matched` otherwise

Why these rules were chosen:

- the business question is about whether the ticket event followed the call event
- the 5-minute limit reflects the team's approved balance between false positives and false negatives
- choosing the earliest eligible ticket gives the system one deterministic outcome instead of ambiguous multi-match behavior
- using exclusive outcome buckets prevents double counting

### Merge Detection

For this Part 2 design, a match counts as merged only when `mergedIntoTicketId` is present on the matched ticket.

Do not expand merge detection to custom statuses in this version.

Do not require audit-trail fetches for initial KPI #13 computation.

Why this choice was made:

- it gives KPI #13 one stable, inspectable system signal
- it keeps the design simple enough to validate before adding deeper provenance lookups
- it matches the user's approved rule

### Why `enteredBy = MSPProcess` Is Not the Match Rule

The platform should explain this clearly in both docs and UI.

Reason:

- merged tickets can survive under a parent ticket whose top-level authorship no longer reflects the original AI-created child ticket
- time plus phone is more resilient because it matches the event pattern, not just a mutable field

## KPI Definitions

### KPI #11: Tickets Created Rate

Formula:

- numerator: `matched + matched_merged`
- denominator: total Phase 1 KPI #5 AI/overflow candidate calls

Why merged tickets are included:

- a merged ticket still proves a ticket was created as a result of the call
- merge rate is a separate interpretive question, not a reason to remove the ticket from created-work totals

UI explanation requirement:

- info button explaining what counts as created, why merged tickets are included, and why `enteredBy` is not the match key

### KPI #12: Spam / Failure-Mode Rate

Formula:

- numerator: `matched_spam`
- denominator: total Phase 1 KPI #5 AI/overflow candidate calls

Why only `Z-SPAM` counts:

- the team confirmed that `Z-SPAM` is the one true catchall bucket
- this keeps the KPI narrow and meaningful

UI explanation requirement:

- info button explaining that this is the AI's catchall failure-mode bucket, not a generic data-quality score

### KPI #13: Merge Rate

Formula:

- numerator: `matched_merged`
- denominator: `matched + matched_merged`

Why this denominator was chosen:

- it answers a clean question: of the calls where a ticket was found at all, how many later became merged tickets

UI explanation requirement:

- dedicated modal explaining:
  - a ticket counts as merged only when `mergedIntoTicketId` exists
  - merged does not mean "ticket not created"
  - a higher merge rate may suggest duplicate work or overlapping human handling, not ticket-creation failure

### KPI #14: AI Ticket SLA Health

Population:

- include `matched`
- exclude `matched_spam`
- exclude `matched_merged`

Outputs:

- percent within SLA
- percent breached respond-by
- percent breached resolution
- median resolution time in minutes
- single longest open ticket
- single oldest unresolved ticket

Why this scoped population was chosen:

- spam tickets represent a different business path
- merged tickets stop behaving like stable standalone work items
- the KPI is meant to describe the health of normal surviving AI-created tickets

UI explanation requirement:

- info button explaining that this KPI measures downstream ticket health after successful normal correlation, not ticket-creation success

## Dashboard UX

### Section Placement

Add a new dashboard section below the existing KPI grid titled:

`AI Voice Assist Health`

Why this placement was chosen:

- it visually reinforces that Part 2 sits on top of the Phase 1 foundation
- it preserves the business storytelling order: first call activity, then ticket outcomes

### Section Contents

The section should include:

1. three KPI cards for KPI #11, KPI #12, and KPI #13
2. one SLA health chart for KPI #14
3. one `UncorrelatedCallsTable`
4. shared explanation surfaces for caveats

### Information Buttons, Notices, and Modals

The platform must compensate for important caveats in-product instead of expecting stakeholders to remember them from the technical spec.

Use:

- info buttons for short local explanations
- inline notices for operational disclaimers and fallback states
- modals for concepts that materially affect interpretation

Every explanation surface must answer three questions in plain language:

- what does this number or state mean
- why is it calculated this way
- what should the operator conclude or do next

Why this choice was made:

- non-technical stakeholders will use the dashboard without reading all underlying design documents
- the product should carry its own explanation burden

### Required Explanation Surfaces

1. Section-level info button
   - explains that Part 2 is additive to Phase 1
   - explains that the denominator reuses KPI #5's AI/overflow bucket

2. Tickets Created Rate info button
   - explains time-plus-phone correlation and inclusion of merged tickets

3. Spam Rate info button
   - explains `Z-SPAM` as the one true catchall failure-mode bucket

4. Merge Rate modal
   - explains the `mergedIntoTicketId` rule and business implications

5. SLA Health info button
   - explains the scoped population and difference between creation success and ticket health

6. Uncorrelated table info button
   - explains that unmatched means "no confident automatic match found," not "no ticket definitely exists"

### Uncorrelated Calls Table

The table should list every AI/overflow candidate call whose outcome is `no-match`.

Columns:

- call time
- caller number
- duration
- correlation status note
- follow-up action

Behavior:

- sortable by time
- easy to scan
- clearly labeled as an audit and exception queue, not a failure log

Why this table matters:

- it is the operator escape hatch when the heuristic cannot make a confident decision
- it keeps the module auditable instead of turning it into a black box

### ConnectWise Follow-Up Action

The UI should explicitly tell the user that ConnectWise URL access is intended, but the exact direct phone-search deep-link pattern may still be pending confirmation.

Required behavior:

- show an inline disclaimer near the action control
- if a trusted deep-link format is configured later, use it
- until then, offer a safe fallback such as opening the ConnectWise site root or presenting a copy-ready normalized phone value
- if the action cannot complete, show a human-readable error state rather than failing silently

Why this choice was made:

- a broken or unclear action button creates more confusion than value
- the dashboard should be honest about what it can and cannot do today

## Loading, Empty, and Error States

### Loading

Part 2 must show its own loading state distinct from Phase 1 KPI loading.

Why:

- operators should understand that call data and ticket-correlation data are separate layers

### Empty

If there are no AI/overflow candidate calls in the selected period, show an explicit empty state instead of performance-looking zeros.

Why:

- zero calls is different from zero ticket success

### Error

If ConnectWise auth or data fetch fails:

- show the Part 2 section as unavailable or errored
- do not default outcomes to `no-match`
- preserve the distinction between integration problems and business outcomes

Why:

- silent degradation would create false conclusions about the AI workflow

## Caching and Persistence Policy

Part 2 should follow these freshness rules even though the storage mechanism remains Postgres-backed:

- closed tickets can be treated as effectively immutable for this reporting purpose
- open tickets should refresh every 15 minutes
- a past business day may be frozen only when it is no longer the current Toronto business date and every matched non-spam ticket for that day is either closed, resolved, or merged

Implementation direction:

- persist ticket snapshots in `connectwise_tickets`
- persist correlation outcomes in `connectwise_correlations`
- mark refresh timestamps so the app can avoid needless refetches while still honoring freshness windows

Why this design was chosen:

- it preserves the operational benefits of caching without introducing a second storage model that conflicts with Part 1's Postgres-first architecture

## Error Handling Rules

These rules are mandatory:

- ConnectWise 401 must surface as a loud auth/config error
- ConnectWise fetch failures must surface as data-unavailable errors
- malformed phone data must remain inspectable in the audit flow
- unresolved deep-link configuration must show a disclaimer and fallback state
- correlation must never collapse upstream errors into misleading `no-match` outcomes

Why these rules were chosen:

- each failure mode tells the operator something different
- the UI must help people act on the real problem instead of guessing

## Testing Requirements

### Phone Normalization Tests

Create `tests/utils/phone.test.ts` with the required cases from the approved prompt.

### Correlation Tests

Create `tests/connectwise/correlate.test.ts` covering at least:

1. happy-path match
2. outside time window
3. phone mismatch
4. ticket created before call ended
5. `Z-SPAM` company match
6. merged ticket match
7. multiple candidate tickets where the earliest wins
8. extension-stripping phone normalization edge case

### KPI Tests

Create tests for:

- KPI #11 formula and denominator behavior
- KPI #12 strict `Z-SPAM` handling
- KPI #13 denominator and merge classification rule
- KPI #14 filtered population and named exception outputs

### Rendering and State Tests

Add tests for:

- section-level explanation surfaces rendering
- uncorrelated table fallback/disclaimer state
- ConnectWise error state rendering
- empty-state rendering when no AI candidate calls exist

Why this test mix was chosen:

- the risk is spread across input normalization, correlation logic, KPI math, and UI state communication

## Manual Validation and Acceptance

Part 2 is considered ready only when:

1. the Phase 1 acceptance checks still pass with no KPI regressions
2. a known historical day produces a Tickets Created Rate within 5 percentage points of a manual count
3. the `UncorrelatedCallsTable` contains every manually confirmed unmatched call for that day
4. the follow-up action clearly communicates whether it is using a real deep link or a temporary fallback
5. all new Vitest tests pass
6. `README.md` includes a new `Phase 2: ConnectWise Correlation` section explaining:
   - how time-plus-phone matching works
   - why the design does not rely on `enteredBy = MSPProcess`
   - what `Z-SPAM` means
   - what merge rate means
   - what to check when correlation rates drop unexpectedly

Why manual validation remains mandatory:

- this module is intentionally heuristic
- the heuristic is carefully constrained, but it still needs real-world spot-checking before it earns trust

## Rollout Guidance

Recommended rollout order:

1. complete and validate Part 1
2. enable Part 2 for internal review on known historical days
3. compare KPI #11 against manual counts
4. verify that explanation buttons and modals are understandable to non-technical stakeholders
5. verify that error states are distinguishable from poor performance states
6. only then treat Part 2 as an operational reporting surface

Why this rollout is recommended:

- Part 2 adds interpretation risk as well as technical risk
- a soft launch gives the team time to validate both the numbers and the meanings attached to those numbers

## Out-of-Scope Follow-On Ideas

These may be explored later, but they are not part of this Part 2 design:

- custom duplicate-status support beyond `mergedIntoTicketId`
- richer audit-trail provenance panels for merged tickets
- direct deep-link search templates once the exact ConnectWise URL pattern is confirmed
- ticket-owner and dispatch analytics
- automated exception workflows for unmatched calls

## Summary

Part 2 extends the dashboard by correlating the already-approved KPI #5 AI/overflow call set to ConnectWise tickets using a deliberately narrow time-plus-phone heuristic. It adds four new KPIs, a new `AI Voice Assist Health` section, and in-product explanation surfaces that make the module understandable to non-technical stakeholders.

The design is intentionally strict about trust boundaries:

- reuse the approved Phase 1 denominator
- use `Z-SPAM` only for failure-mode counting
- use `mergedIntoTicketId` only for merge detection
- surface failures honestly
- make the product explain its caveats at the point of use
