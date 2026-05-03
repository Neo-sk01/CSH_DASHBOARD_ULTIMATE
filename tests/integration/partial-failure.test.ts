import { it, expect, beforeEach, afterEach } from 'vitest'
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
