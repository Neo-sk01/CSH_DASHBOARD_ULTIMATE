# CSH Dashboard Part 1 Data Trust Design Addendum

Date: 2026-04-12
Project root: `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`
Status: Approved in brainstorming, pending implementation planning
Depends on:
- `docs/superpowers/specs/2026-04-09-csh-dashboard-part-1-design.md`
- `docs/superpowers/plans/2026-04-09-csh-dashboard-part-1-implementation.md`

## Goal

Refine the existing Part 1 design with an explicit data-trust model that governs when the dashboard is blocked, provisional, review-required, or trusted.

This addendum does not change Part 1 scope, KPIs, or product boundaries. It tightens the trust rules around logical-call derivation, KPI reconciliation, signoff, and traceability.

## Relationship to the Existing Part 1 Design

The 2026-04-09 Part 1 design remains the base design for the dashboard. This addendum only resolves the data-trust decisions that were still implicit:

- whether heuristic fallback dedupe is allowed
- how much real-world validation is required before Part 1 is trusted
- what counts as a failed validation day
- how drift reviews are handled
- who must approve trust exceptions and final trust status
- how provisional data is shown before trust approval
- where trust evidence and approval history live
- when trust is automatically reset

If this addendum conflicts with the older Part 1 design or implementation plan, this addendum wins for trust and approval behavior.

## Locked Decisions

The following decisions are now fixed for Part 1:

1. No heuristic fallback is allowed if Task 0 cannot prove a trustworthy shared cross-segment identifier. Part 1 stops instead of falling back to caller-plus-time grouping.
2. Trust requires validation across one full operational week.
3. Any day with a broken counting invariant is a hard stop. Trust progression halts until the logic is corrected and a fresh full-week validation is rerun.
4. A day with more than 2% drift between DNIS-filtered `logical_calls` and summed queue `calls_offered` requires manual review.
5. A drift day may pass if a concrete evidence-backed explanation is recorded and both required approvers sign off on it.
6. Only days with drift or invariant warnings require manual inspection. Clean days can pass on automated checks alone.
7. Both manually reviewed drift days and final trust approval require one technical owner and one operations/business owner.
8. Before trust approval is complete, dashboard data may be shown, but the whole Part 1 view must be marked provisional and not decision-grade.
9. Trust evidence must live both in structured app records and in a versioned repo document.
10. Any future counting-related change automatically resets trust and requires a new full-week validation.
11. Entire must be used for commit-linked traceability so the approved counting model can be tied to durable checkpoints.

## Trust Lifecycle

Part 1 trust is an explicit lifecycle with four states:

- `blocked`
- `provisional`
- `review_required`
- `trusted`

### `blocked`

Use `blocked` when Part 1 cannot be trusted at all because a foundational rule failed.

Examples:

- Task 0 did not prove a trustworthy shared call identifier across relevant segments
- a required counting invariant failed during the validation week
- the current validation week contains an unresolved hard-fail day

When Part 1 is `blocked`, the dashboard must not present the affected KPI set as decision-grade.

### `provisional`

Use `provisional` when ingestion and KPI computation work, but the dashboard has not yet earned trust approval.

Examples:

- the full operational validation week has not been completed yet
- the previous trusted model was reset because counting logic changed

When Part 1 is `provisional`, the dashboard may show real data, but the whole Part 1 view must clearly state that it is not yet decision-grade.

### `review_required`

Use `review_required` for a specific validation day when automated checks did not fail hard, but the day cannot pass silently.

In Part 1, this state is triggered when KPI #1 reconciliation drift exceeds 2% for a day:

- Method A: DNIS-filtered `logical_calls`
- Method B: summed queue `calls_offered`

The day remains `review_required` until both a technical owner and an operations/business owner sign off on a concrete evidence-backed explanation.

### `trusted`

Use `trusted` only after:

1. Task 0 passed its structural proof requirements
2. one full operational week completed validation
3. every day in that week is either clean or manually reviewed and signed off
4. both a technical owner and an operations/business owner approve the week

Trust applies to the specific counting model that was validated, not to the app in the abstract.

## Release Gates

### Gate 0: Structural Proof Before Part 1 Proceeds

Task 0 becomes a hard gate, not an exploratory convenience step.

Before Part 1 can proceed, Task 0 must verify:

- the real Versature CDR response wrapper shape
- whether the raw top-level CDR `id` is reliably present
- whether one trustworthy shared identifier exists across the segment types Part 1 depends on

If that shared identifier cannot be proved trustworthy, Part 1 stops. The system must not fall back to caller-plus-time heuristics for the production trust model.

### Gate 1: Full Operational Week Validation

Part 1 cannot become trusted after a single sampled day. The system must pass one contiguous full operational week.

For a week to pass:

- no day may have an unresolved invariant failure
- no day may remain in `review_required`
- all reviewed variance days must have evidence-backed signoff
- the week must end with both technical and operations/business approval

If even one day fails hard or remains unresolved, the week does not count.

## Daily Validation Rules

The validation model separates structural prerequisites, hard-fail invariants, and review-gated drift checks.

### Structural prerequisites

These are established by Task 0 and are required before the validation week can begin:

- verified CDR wrapper
- verified raw row identifier reliability
- verified trustworthy shared logical-call identifier

Failure here means `blocked`.

### Hard-fail invariants

The existing Part 1 assertions become trust gates, not just warnings.

At minimum, the system must enforce:

- `kpi3.totalEnglish + kpi4.totalFrench + kpi5.totalAi <= kpi1.primaryCount`
- `kpi2.totalDropped <= kpi1.primaryCount`

If any required invariant breaks on any day in the validation week, that day fails hard and Part 1 trust progression stops until the logic is corrected and a new full-week validation is run.

### Review-gated reconciliation drift

KPI #1 reconciliation remains a cross-check, but it now has operational consequences.

If the difference between:

- DNIS-filtered `logical_calls`
- summed queue `calls_offered`

exceeds 2% on a business day, that day moves to `review_required`.

That day may still pass, but only after the review record captures:

- business date
- both KPI #1 method counts
- drift percentage
- suspected explanation
- concrete evidence supporting that explanation
- technical approver identity
- operations/business approver identity
- technical signoff timestamp
- operations/business signoff timestamp
- final decision

Documented explanation is sufficient for the day to pass if the evidence is concrete and both approvers sign off.

### Manual inspection scope

Manual inspection is limited on purpose:

- inspect only days that trigger drift or invariant warnings
- do not require end-to-end manual review of every day in the validation week

This keeps the trust process strict without making it unnecessarily slow.

## Approval Model

Part 1 requires two approval layers:

### Drift-day signoff

A reviewed drift day may pass only when both a technical owner and an operations/business owner sign off on a concrete evidence-backed explanation.

### Final trust approval

A validation week becomes trusted only when both of the following approve it:

- one technical owner
- one operations/business owner

This ensures the model is both technically defensible and operationally credible.

## Evidence and Traceability

Trust evidence must live in three places, with different responsibilities.

### 1. Structured runtime records

The application database stores the operational truth of the current trust state and day-level review records.

This layer should capture:

- current Part 1 trust state
- day-level validation outcomes
- drift-review evidence and decisions
- approval timestamps
- reviewer identities

### 2. Versioned repo trust log

The repository stores a human-readable trust history document that records:

- the approved validation week
- any reviewed variance days
- the final dual signoff
- the validated counting-model version or commit reference

Recommended path:

- `csh-dashboard/docs/superpowers/part-1-trust-log.md`

This document is the durable approval narrative for future reviews.

### 3. Entire checkpoints

Entire is enabled for this repository in manual-commit mode and must be part of the trust workflow.

Entire is not the runtime source of truth, but it provides durable checkpoint traceability for:

- the addendum spec approval
- the implementation commits that introduce trust behavior
- the commit that records the first approved validation week
- any later commit that changes counting logic and resets trust

The repo trust log should reference the relevant commit or checkpoint boundary so the approved trust state can be traced back to the exact implementation state that produced it.

## Dashboard Behavior by Trust State

The dashboard should present trust status clearly.

### When `provisional`

- show real ingested data
- display a clear banner that the Part 1 view is provisional
- state that the numbers are not yet decision-grade

### When `review_required`

- visually mark the affected day as needing review
- do not silently blend the day into normal trusted reporting

### When `blocked`

- stop presenting the affected KPI view as usable for decision-making
- explain whether the issue is a failed invariant, unresolved validation, or missing structural proof

### When `trusted`

- show trusted status
- surface lightweight metadata such as approved week and most recent signoff date

Deep audit detail belongs in the trust log and the structured review records, not in the main operator-facing view.

## Trust Reset Policy

Trust attaches to a specific counting model.

Any change to counting-related logic automatically resets trust to `provisional` and requires a fresh full-week validation.

Counting-related changes include:

- logical-call grouping rules
- dedupe keys
- routing-bucket assignment rules
- KPI formulas
- dropped-call derivation logic
- other logic that can change the numeric meaning of Part 1 KPIs

Non-counting changes do not reset trust.

Examples of non-counting changes:

- UI polish
- layout changes
- copy updates
- documentation-only edits

## Implementation Implications for the Existing Plan

The existing Part 1 implementation plan remains valid, but the following additions now apply:

1. Task 0 must be treated as a release gate. If it fails to prove a trustworthy shared identifier, implementation for trusted Part 1 stops.
2. Trust-state persistence must be added to the runtime data model so the app can represent `blocked`, `provisional`, `review_required`, and `trusted`.
3. Review-required day records must capture evidence, both approver identities, and both signoff timestamps.
4. The dashboard UI must expose provisional, blocked, and review-required states clearly.
5. A versioned trust log document must be maintained in the repo.
6. Counting-related changes must trigger a documented trust reset workflow.
7. Commit boundaries for trust-relevant milestones must be preserved so Entire can act as the durable checkpoint trail.

## Out of Scope

This addendum does not:

- change the Part 1 KPI set
- broaden Part 1 into Part 2 functionality
- introduce new product features beyond trust-state visibility and approval traceability
- weaken the existing counting rules

## Result

With this addendum, Part 1 trust is no longer an informal judgment. It becomes a defined release process:

- structural proof first
- one full operational week of validation
- hard stops for invariant failures
- human review for reconciliation drift
- dual signoff for trust approval
- provisional display before approval
- automatic trust reset on counting-model changes
- repo and Entire-backed traceability for the exact model that was approved
