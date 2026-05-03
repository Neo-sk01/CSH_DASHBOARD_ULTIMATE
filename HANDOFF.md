# Handoff: csh-dashboard (CSH_DASHBOARD_ULTIMATE on GitHub)
Generated: 2026-05-03T17:20:00Z
Session: 1 (Tasks 0–15 of 27)
Type: clean
Epic: Versature batch pipeline (replace live-CDR-on-page-load with scheduled batch into MotherDuck)
Plan progress: 16 of 27 tasks complete (Task 0 verification gate + Tasks 1–15 implementation)

## How to start the next session

> Read this HANDOFF.md, the spec at `docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md`, and the plan at `docs/superpowers/plans/2026-05-02-versature-batch-pipeline-implementation.md`. Then execute Tasks 16–26 using the **superpowers:subagent-driven-development** skill (one subagent per task with two-stage review). The plan has full TDD step-by-step text for each task with code blocks ready to drop in.

## Repository state

- **Worktree (where to work):** `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard.worktrees/versature-pipeline`
- **Main repo (for spec/plan):** `/Users/neosekaleli/developer/neolore_codex_dahsboard/csh-dashboard`
- **GitHub remote:** `https://github.com/Neo-sk01/CSH_DASHBOARD_ULTIMATE.git`
- **Branches on remote:**
  - `main` at `0c75c4b` — spec + plan (Revisions 1 & 2), plus original Next.js scaffold
  - `feat/versature-pipeline` at `5de411d` — all 18 implementation commits
  - `entire/checkpoints/v1` — Entire's auto-pushed local checkpoint snapshots; harmless, ignore

## Last commit
`5de411d` — task-15: build kpi_snapshots (Revision 2 — queue buckets from raw_queue_stats)

## Dirty files
None of substance. `tsconfig.tsbuildinfo` is the only untracked artifact (ignored by convention; should be in `.gitignore` but isn't yet — fixing it isn't urgent).

## Completed this session

- [x] Task 0 — verification gate against live tenant; **Gate 2 failed → triggered spec Revision 2**
- [x] Spec + plan Revision 2 (master branch, commits `626acf3` + `0c75c4b`)
- [x] Task 1 — scaffold (deps, vitest projects, env template)
- [x] Task 2 — MotherDuck schema + migration script (script committed; live migration deferred — see Open Questions)
- [x] Task 3 — DNIS normalization (TS + DuckDB UDF macro body)
- [x] Task 4 — date helpers (with a real DST bug found in the spec; implementer fixed via `parseTZDate`)
- [x] Task 5 — structured logger
- [x] Task 6 — Versature types
- [x] Task 7 — OAuth token cache
- [x] Task 8 — rate limiter (sliding window + sub-second floor)
- [x] Task 9 — HTTP client (401/429/5xx handling) + TS narrowing fix
- [x] Task 10 — endpoint wrappers
- [x] Task 11 — warehouse client (`WarehouseReader`/`Writer` surfaces, UDF registration)
- [x] Task 12 — `pull_runs` helpers
- [x] Task 13 — fetch-and-load Stages 1–3 + 3 integration tests
- [x] Task 14 — `build-logical-calls.ts` (Revision 2: simplified, no bucket derivation)
- [x] Task 15 — `build-snapshots.ts` (Revision 2: bucket counts from `raw_queue_stats`)
- [x] Pushed all work to GitHub (CSH_DASHBOARD_ULTIMATE)

## Current task
None. Tasks 1–15 are clean. Ready to start Task 16.

## Next actions (priority order)

1. **Task 16 — orchestrator (`jobs/run-pull.ts`)** — plan section ~line 2935. Wires Stages 0+6 plus dispatches Stages 1–5. Includes `resolveWindow()` for the env-var → window mapping (workflow_dispatch / repository_dispatch / cron). **Important:** the orchestrator's `buildSnapshots` call needs the new `queues` arg (added in Task 15) — the original Task 16 plan code does NOT have this arg; add it.
2. **Task 17 — `jobs/notify-failure.ts`** — plan section just after Task 16. Posts to `ALERT_WEBHOOK_URL`.
3. **Task 18 — GitHub Actions workflows** (`pull.yml`, `smoke.yml`, `missing-run.yml`, `ci.yml`) — plan section ~line 3100ish. **Will not be exercisable until you provision MotherDuck and set GH secrets.**
4. **Task 19 — `lib/warehouse/snapshots.ts`** (dashboard read API) + tests — small, depends only on `lib/warehouse/client.ts`.
5. **Task 20 — Dashboard root** (`app/page.tsx`, layout, 5 components: DashboardView, NotDownloadedYet, KpiCard, PeriodToggle, WeekendToggle).
6. **Task 21 — Admin page + admin pull route** (`app/admin/page.tsx`, `app/api/admin/pull/route.ts`).
7. **Task 22 — Health endpoint** (`app/api/health/freshness/route.ts`).
8. **Task 23 — ESLint architectural lint** (`eslint.config.mjs`) — enforces dashboard-never-imports-versature.
9. **Task 24 — `scripts/audit-day.ts`** — per-day diagnostic.
10. **Task 25 — README** — operator runbook.
11. **Task 26 — staging E2E validation** — needs MotherDuck + GH workflows live.
12. Final superpowers:requesting-code-review pass over the whole branch.
13. superpowers:finishing-a-development-branch — open PR to `main`.

## Decisions made (this session)

| Decision | Rationale | Reversible? |
|---|---|---|
| Spec Revision 2: queue buckets sourced from `raw_queue_stats`, not `logical_calls` | Task 0 Gate 2 proved CDR `to.user` is the segment's terminal destination, not its queue traversal. Per-call queue attribution is not derivable from this Versature tenant. | Yes, but only if Versature exposes queue-route history later |
| Drop 7 bucket fields from `logical_calls` (`touched_queues`, `first_tracked_queue`, `touched_ai`, `is_english/_french/_ai/_ai_overflow`) | Same as above — they were derived from a broken assumption | Schema change; need new migration if reverted |
| `ai_overflow_calls = ai_calls` for v1 | Per-call attribution required for true overflow detection is not derivable from API. AI queues assumed overflow-only by tenant policy. | Yes when per-call attribution becomes available |
| Gate 2 reframed as monthly regression guard | The pre-build pass/fail decision has already been executed (it failed). Script + baseline numbers committed; CI runs monthly. | n/a (one-way change) |
| `queue_splits.perMinute` raised 12 → 24 | Gate 3 calibration: 30 reqs in 24.6s, zero 429s | Yes, lower if 429s appear in production |
| `from_call_id` PK retained on `logical_calls` | Gate 4: 6,277 distinct IDs / 30 days, zero duplicates | Yes if true cross-date reuse appears later |
| Existing env file uses old names (`QUEUE_ENGLISH` not `QUEUE_EN_MAIN`); scripts read with fallback | Don't force a refactor of the user's `.env.local` mid-session | Update `.env.local` later to match the new names |
| 8007 (mystery `to.user` extension) ignored | Operator decision; not enough local evidence to identify | Add as configured queue if Versature/admin confirms |
| Used spec-recommended pattern for everything else (rate limiter, retry policy, normalize_dnis as DuckDB MACRO, etc.) | Spec is self-consistent and well-reviewed | Yes, standard refactors |

## Doc Verifications (Context7)

| Library | Context7 ID | Query | Key Finding | Installed Ver |
|---|---|---|---|---|
| **(none performed this session)** | — | — | The implementer subagents did not invoke Context7 lookups. They worked from the plan's full code blocks plus their own training data. | — |

**Action for next session:** before Tasks 16–22 begin, run a doc-check pass on:

1. **Next.js 16** (`/vercel/next.js`) — confirm App Router server-component patterns, `route.ts` handler shape, dynamic `searchParams` (which is `Promise<>` in Next 16), `redirect()` from `next/navigation`. Tasks 20–22 build on these.
2. **MSW 2.x** (`/mswjs/msw`) — confirm `setupServer`/`http`/`HttpResponse` API; the integration tests use it. Task 16 may add more integration tests.
3. **duckdb-async** — confirm `Database.create()`, run/all/exec methods, parameter-binding API. Verified working in Tasks 11–15 via in-memory tests; production MotherDuck connection (`md:DBNAME?motherduck_token=TOKEN`) is documented but unverified live.
4. **GitHub Actions** workflow_dispatch + repository_dispatch event payloads — confirm the `${{ github.event.inputs.* }}` and `${{ github.event.client_payload.* }}` access patterns used in Task 18.
5. **MotherDuck connection string format** — confirm whether the URL form `md:DBNAME?motherduck_token=TOKEN` is current or if newer SDKs require a different form.

## Codebase updates

These should fold into `CODEBASE.md` (Obsidian) when next session creates it:

- **Architecture:** Next.js 16 App Router + worker (jobs/) split. The dashboard reads only MotherDuck snapshots; the worker (`jobs/run-pull.ts`) is the only code that talks to Versature. Enforced structurally (Task 23 will lock it via ESLint).
- **Test conventions:** Vitest with two named projects (`unit` and `integration`). Unit tests use in-memory DuckDB via `tests/helpers/test-warehouse.ts`. Integration tests use msw 2.x for HTTP mocking.
- **DST gotcha:** `parseISO('2026-04-27')` produces UTC midnight — in Toronto-local that's 8 PM the previous day. Always anchor to noon when doing tz-aware date math; see `lib/utils/dates.ts:parseTZDate`.
- **Vitest pitfall:** comparing DuckDB-returned timestamp objects with `.toBe()` fails (Object.is); use `.toStrictEqual()` for Date equality. Affected: `tests/unit/build-snapshots.test.ts:90`.
- **Versature CDR shape:** 6 fields per row, never more. No queue-route field anywhere. Per-call queue attribution is impossible. **This is the load-bearing finding of Task 0.**
- **Versature env names:** the existing `.env.local` uses pre-redesign names. Scripts read with fallback (`QUEUE_EN_MAIN ?? QUEUE_ENGLISH`). New env vars to add when convenient: `MOTHERDUCK_TOKEN_RW`, `MOTHERDUCK_TOKEN_RO`, `MOTHERDUCK_DATABASE`, `TRACKED_DNIS`, `ADMIN_PULL_TOKEN`, `GH_DISPATCH_TOKEN`, `GH_REPO`, `ALERT_WEBHOOK_URL`.
- **The 8007 extension:** appears 25 times as `to.user` on tracked-DNIS calls; ignored per operator decision. If Versature/admin later confirms it's a tracked queue, add as a configured env var.

## Env snapshot

- **Runtime:** Node 20+ (Node 25 on dev box). TypeScript 5.7. Next.js 16.1.1. React 19.2.0.
- **Key packages added this session:** `duckdb-async ^1.1.3`, `ulid ^2.3.0`, `msw ^2.4.9` (devDep). Removed: `pg`, `@types/pg`.
- **Env vars needed (not yet set in worktree):** `MOTHERDUCK_TOKEN_RW`, `MOTHERDUCK_TOKEN_RO`, `MOTHERDUCK_TOKEN_SMOKE`, `MOTHERDUCK_DATABASE` (currently no MotherDuck account provisioned). `ADMIN_PULL_TOKEN`, `GH_DISPATCH_TOKEN`, `GH_REPO`, `ALERT_WEBHOOK_URL` for Tasks 21+. Versature creds and queue IDs already present in main repo's `.env.local`, symlinked into worktree.
- **Test command:** `npm test` — **45 passing, 0 failing** (9 test files: 7 unit + 2 integration files of multiple tests each).
- **Build status:** `npm run typecheck` passes. `npm run build` not yet run this session (no `app/page.tsx` changes yet — Task 20 will).

## Context for next session

**Three things matter most:**

1. **Use spec Revision 2's SQL, not Revision 1's.** The plan still has Revision 1 code blocks for Tasks 14 and 15 with banner warnings — DO NOT follow what's below the banner. Tasks 14 and 15 are already done with the new SQL; don't re-implement them.
2. **The orchestrator (Task 16) needs a spec adjustment** — `buildSnapshots` now takes a `queues: { en, fr, aiEn, aiFr }` arg (Revision 2 added this to the function signature). The plan's Task 16 orchestrator code in `jobs/run-pull.ts` needs to pass this. Easy fix; just don't let the implementer copy-paste the old call shape verbatim without updating it.
3. **Task 18 workflows reference live MotherDuck and Versature secrets** that the user hasn't provisioned. The workflows can be committed but won't run successfully until provisioning happens. Don't gate Task 19+ on Task 18 actually executing.

**Gotchas to avoid:**

- The `vitest run` exit code: the project has `passWithNoTests: true` set in `vitest.config.ts`. Don't add new test projects without setting this on them.
- `npm test` prints test runner logs INCLUDING `console.log` from the rate-limiter and HTTP client — those are intentional (Task 5 logger). Just expect noise.
- Don't commit `.claude/` (local CC config) or `tsconfig.tsbuildinfo` (build artifact). Both are conventionally ignored.
- The `.env.local` in the worktree is a SYMLINK to the main repo's. Don't `rm` it.

**Where to read for context (in order):**

1. This HANDOFF.md
2. `docs/superpowers/specs/2026-05-02-versature-batch-pipeline-design.md` — start with Revision history (lines 14–58) for the design pivots
3. `docs/superpowers/plans/2026-05-02-versature-batch-pipeline-implementation.md` — Task 0 prose and the Revision 2 banners on Tasks 14/15 explain what's already done
4. `docs/versature-task-0-verification.md` — the verification report; explains why Revision 2 happened
5. `git log --oneline feat/versature-pipeline` — the commit-by-commit progression
