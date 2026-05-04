import { it, expect, beforeEach, afterEach } from 'vitest'
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
  // Fixture: 3 unique from_call_ids — cEn (queue 8020), cFr (queue 8021), cAi (queue 8020 + 8030 segments)
  const cdrs = [
    { duration: 60, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cEn', name: null, id: '+15551234567', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8020', domain: 'neolore.com' } },
    { duration: 60, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cFr', name: null, id: '+15551234568', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8021', domain: 'neolore.com' } },
    { duration: 30, answer_time: '2026-04-30T12:00:00', start_time: '2026-04-30T12:00:00', end_time: '2026-04-30T12:01:00', from: { call_id: 'cAi', name: null, id: '+15551234569', user: null, domain: null }, to: { call_id: null, id: '+16135949199', user: '8020', domain: 'neolore.com' } },
    { duration: 30, answer_time: '2026-04-30T12:01:30', start_time: '2026-04-30T12:01:30', end_time: '2026-04-30T12:02:00', from: { call_id: 'cAi', name: null, id: '+15551234569', user: null, domain: null }, to: { call_id: null, id: null,             user: '8030', domain: 'neolore.com' } },
  ]
  // fetchCdrs sends one call per day with no `page` param; the mock returns the
  // fixture once for the matching start_date (=window.start) and empty otherwise.
  server.use(
    http.get(`${BASE}/cdrs/`, ({ request }) => {
      const u = new URL(request.url)
      return HttpResponse.json(u.searchParams.get('start_date') === '2026-04-30' ? cdrs : [])
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
  await buildSnapshots(w, { pullRunId: pullRunId1, window, forceFinalize: false, queues })
  await closePullRun(w, { pullRunId: pullRunId1, status: 'success' })

  const snap1 = await w.one<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
  // Revision 2: bucket counts come from raw_queue_stats.calls_offered (each queue mock returns 1).
  // April 30, 2026 is a Thursday, so eachBusinessDate yields 1 weekday. loadQueueStats called over
  // 4 queue IDs × 1 weekday = 4 raw_queue_stats rows, one per queue, calls_offered=1 each.
  expect(Number(snap1.total_incoming)).toBe(3)       // 3 unique from_call_ids touched DNIS / queue
  expect(Number(snap1.english_calls)).toBe(1)        // queue 8020 calls_offered=1
  expect(Number(snap1.french_calls)).toBe(1)         // queue 8021 calls_offered=1
  expect(Number(snap1.ai_calls)).toBe(2)             // queue 8030 + 8031, each calls_offered=1
  expect(Number(snap1.ai_overflow_calls)).toBe(2)    // ai_overflow = ai per Revision 2

  // --- run 2 (no Versature changes) ---
  const pullRunId2 = await openPullRun(w, { triggeredBy: 'manual', windowStart: window.start, windowEnd: window.end })
  await loadCdrs(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window })
  await loadQueueStats(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await loadQueueSplits(w, { pullRunId: pullRunId2, pulledAt: '2026-05-01T08:05:00Z', window, queueIds: ['8020','8021','8030','8031'] })
  await buildLogicalCalls(w, { pullRunId: pullRunId2, window, queues, trackedDnisNormalized: ['6135949199'] })
  await buildSnapshots(w, { pullRunId: pullRunId2, window, forceFinalize: false, queues })
  await closePullRun(w, { pullRunId: pullRunId2, status: 'success' })

  const snap2 = await w.one<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
  // Update-only-on-change: byte-identical (use toStrictEqual for DuckDB Date/Timestamp values)
  expect(snap2.computed_at).toStrictEqual(snap1.computed_at)
  expect(snap2.pull_run_id).toBe(snap1.pull_run_id)

  await db.close()
})
