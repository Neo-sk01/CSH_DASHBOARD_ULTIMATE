import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { loadCdrs } from '@/lib/pipeline/fetch-and-load'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'

const server = setupServer()
const BASE = 'https://test.versature.com/api'

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

function makeRow(callId: string, startTime: string, toUser: string | null, duration = 60) {
  return {
    duration,
    answer_time: startTime,
    start_time: startTime,
    end_time: startTime,
    from: { call_id: callId, name: null, id: '+15551234567', user: null, domain: null },
    to:   { call_id: 'tcid-' + callId, id: '+16135949199', user: toUser, domain: 'neolore.com' },
  }
}

describe('loadCdrs', () => {
  it('iterates day-by-day across the window and writes all rows; re-running is a no-op', async () => {
    // Windows are inclusive [start, end]; fetchCdrs makes one API call per day with
    // exclusive end_date `[day, day+1]`. Two days in the window → two calls. Each call
    // is keyed on start_date in the mock (since `page` is no longer sent).
    const day1 = Array.from({ length: 500 }, (_, i) => makeRow(`c${i}`, '2026-04-29T12:00:00', '8020'))
    const day2 = Array.from({ length: 200 }, (_, i) => makeRow(`c${500 + i}`, '2026-04-30T13:00:00', '8021'))
    let calls = 0
    server.use(http.get(`${BASE}/cdrs/`, ({ request }) => {
      const u = new URL(request.url)
      const start = u.searchParams.get('start_date')
      calls += 1
      return HttpResponse.json(start === '2026-04-29' ? day1 : start === '2026-04-30' ? day2 : [])
    }))

    const db = await makeTestWarehouse()
    const w = wrap(db)
    const count = await loadCdrs(w, {
      pullRunId: 'run-1',
      pulledAt: '2026-05-01T08:00:00Z',
      window: { start: '2026-04-29', end: '2026-04-30' },
    })
    expect(count).toBe(700)
    expect(calls).toBe(2)

    const rowCount = (await w.all<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments'))[0].c
    expect(Number(rowCount)).toBe(700)

    await loadCdrs(w, {
      pullRunId: 'run-2',
      pulledAt: '2026-05-01T08:05:00Z',
      window: { start: '2026-04-29', end: '2026-04-30' },
    })
    const rowCount2 = (await w.all<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments'))[0].c
    expect(Number(rowCount2)).toBe(700)
    await db.close()
  })

  it('fails the pull when a day reaches the Versature CDR limit', async () => {
    const cappedDay = Array.from({ length: 1000 }, (_, i) => makeRow(`c${i}`, '2026-04-29T12:00:00', '8020'))
    server.use(http.get(`${BASE}/cdrs/`, () => HttpResponse.json(cappedDay)))

    const db = await makeTestWarehouse()
    const w = wrap(db)
    await expect(loadCdrs(w, {
      pullRunId: 'run-truncated',
      pulledAt: '2026-05-01T08:00:00Z',
      window: { start: '2026-04-29', end: '2026-04-29' },
    })).rejects.toThrow(/CDR.*limit|truncation/i)

    const rowCount = (await w.all<{ c: number }>('SELECT count(*) as c FROM raw_cdr_segments'))[0].c
    expect(Number(rowCount)).toBe(0)
    await db.close()
  })
})
