import { it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { loadQueueStats } from '@/lib/pipeline/fetch-and-load'
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

it('writes 4 queues x N business dates rows; re-pull updates in place', async () => {
  server.use(http.get(`${BASE}/call_queues/:qid/stats/`, ({ params }) => HttpResponse.json({
    calls_offered: params.qid === '8020' ? 100 : 50,
    abandoned_calls: 5, abandoned_rate: 0.05,
    average_talk_time: 120, average_handle_time: 150,
  })))

  const db = await makeTestWarehouse()
  const w = wrap(db)
  // Mon 2026-04-27 to Wed 2026-04-29 = 3 business dates x 4 queues = 12
  const count = await loadQueueStats(w, {
    pullRunId: 'run-1', pulledAt: '2026-05-01T08:00:00Z',
    window: { start: '2026-04-27', end: '2026-04-29' },
    queueIds: ['8020', '8021', '8030', '8031'],
  })
  expect(count).toBe(12)

  server.use(http.get(`${BASE}/call_queues/:qid/stats/`, () => HttpResponse.json({
    calls_offered: 200, abandoned_calls: 0, abandoned_rate: 0,
    average_talk_time: 100, average_handle_time: 100,
  })))
  await loadQueueStats(w, {
    pullRunId: 'run-2', pulledAt: '2026-05-01T08:05:00Z',
    window: { start: '2026-04-27', end: '2026-04-29' },
    queueIds: ['8020', '8021', '8030', '8031'],
  })
  const total = (await w.all<{ c: number; o: number }>('SELECT count(*) as c, max(calls_offered) as o FROM raw_queue_stats'))[0]
  expect(Number(total.c)).toBe(12)
  expect(Number(total.o)).toBe(200)
  await db.close()
})
