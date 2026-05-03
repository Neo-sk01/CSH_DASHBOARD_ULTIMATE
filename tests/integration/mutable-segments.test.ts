import { it, expect, beforeEach, afterEach } from 'vitest'
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
  const dur = (await w.all<{ d: number }>('SELECT duration_seconds as d FROM raw_cdr_segments'))[0].d
  expect(Number(dur)).toBe(60)

  await loadCdrs(w, { pullRunId: 'run-2', pulledAt: '2026-05-01T08:05:00Z', window: { start: '2026-04-30', end: '2026-04-30' } })
  const rows = await w.all<{ d: number; c: number }>('SELECT duration_seconds as d, count(*) as c FROM raw_cdr_segments GROUP BY duration_seconds')
  expect(rows).toHaveLength(1)
  expect(Number(rows[0].d)).toBe(120)

  await db.close()
})
