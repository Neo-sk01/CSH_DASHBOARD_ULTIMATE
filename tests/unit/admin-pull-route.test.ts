import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { POST } from '@/app/api/admin/pull/route'

const server = setupServer()
const ORIGINAL_ENV = { ...process.env }

interface CapturedDispatch {
  payload: unknown | null
}

function dispatchInterceptor(captured: CapturedDispatch) {
  return http.post('https://api.github.com/repos/test-org/test-repo/dispatches', async ({ request }) => {
    captured.payload = await request.json()
    return new HttpResponse(null, { status: 204 })
  })
}

function makeRequest(body: unknown, headers: Record<string, string> = { authorization: 'Bearer admin-token' }): Request {
  return new Request('http://localhost/api/admin/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.ADMIN_PULL_TOKEN = 'admin-token'
  process.env.GH_DISPATCH_TOKEN = 'gh-token'
  process.env.GH_REPO = 'test-org/test-repo'
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  server.close()
  process.env = { ...ORIGINAL_ENV }
})

describe('POST /api/admin/pull validation', () => {
  it('rejects malformed windowStart that is not YYYY-MM-DD', async () => {
    const res = await POST(makeRequest({ windowStart: 'garbage', windowEnd: '2026-04-30' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error).toLowerCase()).toContain('windowstart')
  })

  it('rejects malformed windowEnd that is not YYYY-MM-DD', async () => {
    const res = await POST(makeRequest({ windowStart: '2026-04-01', windowEnd: '2026-13-99' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error).toLowerCase()).toContain('windowend')
  })

  it('rejects forceFinalize when not a real boolean (string "false" must NOT coerce to true)', async () => {
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30', forceFinalize: 'false' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error).toLowerCase()).toContain('forcefinalize')
  })

  it('rejects forceFinalize when truthy non-boolean (number 1)', async () => {
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30', forceFinalize: 1 }))
    expect(res.status).toBe(400)
  })

  it('preserves forceFinalize=true (real boolean) and dispatches it through', async () => {
    const captured: CapturedDispatch = { payload: null }
    server.use(dispatchInterceptor(captured))
    const res = await POST(makeRequest({ windowStart: '2026-04-01', windowEnd: '2026-04-30', forceFinalize: true, reason: 'rebuild' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.forceFinalize).toBe(true)
    expect((captured.payload as { client_payload: { forceFinalize: boolean } }).client_payload.forceFinalize).toBe(true)
  })

  it('rejects forceFinalize for a multi-day window that is not a complete week or month', async () => {
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30', forceFinalize: true, reason: 'partial override' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(String(body.error)).toContain('forceFinalize')
  })

  it('preserves forceFinalize=false and dispatches it through', async () => {
    const captured: CapturedDispatch = { payload: null }
    server.use(dispatchInterceptor(captured))
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30', forceFinalize: false }))
    expect(res.status).toBe(200)
    expect((captured.payload as { client_payload: { forceFinalize: boolean } }).client_payload.forceFinalize).toBe(false)
  })

  it('treats omitted forceFinalize as false', async () => {
    const captured: CapturedDispatch = { payload: null }
    server.use(dispatchInterceptor(captured))
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30' }))
    expect(res.status).toBe(200)
    expect((captured.payload as { client_payload: { forceFinalize: boolean } }).client_payload.forceFinalize).toBe(false)
  })

  it('still enforces auth (no token → 401)', async () => {
    const res = await POST(makeRequest({ windowStart: '2026-04-29', windowEnd: '2026-04-30' }, {}))
    expect(res.status).toBe(401)
  })
})
