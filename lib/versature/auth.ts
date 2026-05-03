import { VersatureError } from './types'

interface CachedToken { accessToken: string; expiresAt: number }

let cached: CachedToken | null = null

const baseUrl = () => {
  const v = process.env.VERSATURE_BASE_URL
  if (!v) throw new Error('VERSATURE_BASE_URL is required')
  return v
}

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken
  cached = await fetchNewToken()
  return cached.accessToken
}

export function invalidateToken(): void {
  cached = null
}

async function fetchNewToken(): Promise<CachedToken> {
  const clientId = process.env.VERSATURE_CLIENT_ID
  const clientSecret = process.env.VERSATURE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('VERSATURE_CLIENT_ID and VERSATURE_CLIENT_SECRET are required')

  const res = await fetch(`${baseUrl()}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    throw new VersatureError(res.status, `OAuth token request failed: ${await res.text()}`)
  }

  const payload = await res.json() as { access_token?: string; expires_in?: number }
  if (!payload.access_token) {
    throw new VersatureError(0, 'OAuth response missing access_token')
  }

  const expiresInMs = (payload.expires_in ?? 3600) * 1000
  return { accessToken: payload.access_token, expiresAt: Date.now() + expiresInMs }
}

// Exposed for tests only.
export function _resetForTests(): void { cached = null }
