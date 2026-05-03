import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse, delay } from 'msw'
import { request } from '@/lib/versature/client'
import { _resetForTests as resetLimiter } from '@/lib/versature/rate-limiter'
import { _resetForTests as resetAuth } from '@/lib/versature/auth'
import { VersatureError } from '@/lib/versature/types'

const server = setupServer()

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  resetLimiter()
  resetAuth()
  process.env.VERSATURE_BASE_URL = 'https://test.versature.com/api'
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  process.env.VERSATURE_API_VERSION = 'application/vnd.integrate.v1.10.0+json'

  server.listen({ onUnhandledRequest: 'error' })
  server.use(
    http.post('https://test.versature.com/api/oauth/token/', () =>
      HttpResponse.json({ access_token: 'tok-1', expires_in: 3600 }),
    ),
  )
})

afterEach(() => {
  server.resetHandlers()
  server.close()
  vi.useRealTimers()
})

describe('request()', () => {
  it('passes Accept and Authorization headers', async () => {
    const captured: { headers: Headers | null } = { headers: null }
    server.use(
      http.get('https://test.versature.com/api/cdrs/', ({ request }) => {
        captured.headers = request.headers
        return HttpResponse.json([])
      }),
    )
    await request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    expect(captured.headers?.get('accept')).toBe('application/vnd.integrate.v1.10.0+json')
    expect(captured.headers?.get('authorization')).toBe('Bearer tok-1')
  })

  it('on 401 invalidates the token, refreshes, retries once, then succeeds', async () => {
    let tokenCallCount = 0
    let cdrCallCount = 0
    server.use(
      http.post('https://test.versature.com/api/oauth/token/', () => {
        tokenCallCount += 1
        return HttpResponse.json({ access_token: `tok-${tokenCallCount}`, expires_in: 3600 })
      }),
      http.get('https://test.versature.com/api/cdrs/', () => {
        cdrCallCount += 1
        if (cdrCallCount === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json([])
      }),
    )
    await request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    expect(tokenCallCount).toBe(2)
    expect(cdrCallCount).toBe(2)
  })

  it('on second 401 throws fatal', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 401 })),
    )
    await expect(
      request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30'),
    ).rejects.toBeInstanceOf(VersatureError)
  })

  it('on 429 honors Retry-After header', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        calls += 1
        if (calls === 1) return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '5' } })
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(4_999)
    let resolved = false
    promise.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await promise
    expect(calls).toBe(2)
  })

  it('on 5xx backs off 2s/8s/32s', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        calls += 1
        if (calls < 4) return new HttpResponse(null, { status: 503 })
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 32_000 + 100)
    await promise
    expect(calls).toBe(4)
  })

  it('on persistent 5xx throws after 3 retries', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 503 })),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    // Suppress unhandled-rejection noise while timers advance; assertion below re-catches it.
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 32_000 + 100)
    await expect(promise).rejects.toBeInstanceOf(VersatureError)
  })

  it('on other 4xx throws immediately', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => new HttpResponse(null, { status: 400 })),
    )
    await expect(
      request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30'),
    ).rejects.toBeInstanceOf(VersatureError)
  })

  it('retries transient network errors with backoff, then succeeds', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        calls += 1
        if (calls < 3) return HttpResponse.error()
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 200)
    await promise
    expect(calls).toBe(3)
  })

  it('on persistent network errors throws VersatureError after retries', async () => {
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => HttpResponse.error()),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(2_000 + 8_000 + 32_000 + 200)
    await expect(promise).rejects.toBeInstanceOf(VersatureError)
  })

  it('aborts hung requests after FETCH_TIMEOUT_MS and retries', async () => {
    let calls = 0
    server.use(
      http.get('https://test.versature.com/api/cdrs/', async () => {
        calls += 1
        if (calls === 1) {
          // Hang past the timeout; AbortController should kill us.
          await delay(120_000)
          return HttpResponse.json([])
        }
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    // Advance past 30s timeout + 2s backoff for retry.
    await vi.advanceTimersByTimeAsync(35_000)
    await promise
    expect(calls).toBe(2)
  })

  it('on 401, retry waits for rate-limit slot (minIntervalMs)', async () => {
    const callTimes: number[] = []
    server.use(
      http.get('https://test.versature.com/api/cdrs/', () => {
        callTimes.push(Date.now())
        if (callTimes.length === 1) return new HttpResponse(null, { status: 401 })
        return HttpResponse.json([])
      }),
    )
    const promise = request('cdrs', '/cdrs/?start_date=2026-04-30&end_date=2026-04-30')
    await vi.advanceTimersByTimeAsync(500)
    await promise
    expect(callTimes.length).toBe(2)
    // CDR minIntervalMs = 200; the retry must respect the limiter.
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(200)
  })
})
