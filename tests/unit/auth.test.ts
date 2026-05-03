import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { getAccessToken, _resetForTests as resetAuth } from '@/lib/versature/auth'

const server = setupServer()

beforeEach(() => {
  resetAuth()
  process.env.VERSATURE_BASE_URL = 'https://test.versature.com/api'
  process.env.VERSATURE_CLIENT_ID = 'cid'
  process.env.VERSATURE_CLIENT_SECRET = 'csecret'
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  server.close()
})

describe('getAccessToken()', () => {
  it('coalesces concurrent refreshes into a single OAuth request', async () => {
    let oauthCalls = 0
    server.use(
      http.post('https://test.versature.com/api/oauth/token/', async () => {
        oauthCalls += 1
        // Simulate non-zero RTT so the in-flight window is wide.
        await new Promise((r) => setTimeout(r, 20))
        return HttpResponse.json({ access_token: `tok-${oauthCalls}`, expires_in: 3600 })
      }),
    )
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => getAccessToken()),
    )
    expect(oauthCalls).toBe(1)
    expect(new Set(tokens).size).toBe(1)
    expect(tokens[0]).toBe('tok-1')
  })

  it('reuses the cached token within the refresh window', async () => {
    let oauthCalls = 0
    server.use(
      http.post('https://test.versature.com/api/oauth/token/', () => {
        oauthCalls += 1
        return HttpResponse.json({ access_token: `tok-${oauthCalls}`, expires_in: 3600 })
      }),
    )
    await getAccessToken()
    await getAccessToken()
    await getAccessToken()
    expect(oauthCalls).toBe(1)
  })

  it('fetches a new token after invalidate', async () => {
    let oauthCalls = 0
    server.use(
      http.post('https://test.versature.com/api/oauth/token/', () => {
        oauthCalls += 1
        return HttpResponse.json({ access_token: `tok-${oauthCalls}`, expires_in: 3600 })
      }),
    )
    const t1 = await getAccessToken()
    const { invalidateToken } = await import('@/lib/versature/auth')
    invalidateToken()
    const t2 = await getAccessToken()
    expect(t1).toBe('tok-1')
    expect(t2).toBe('tok-2')
    expect(oauthCalls).toBe(2)
  })
})
