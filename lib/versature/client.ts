import { acquire } from './rate-limiter'
import { getAccessToken, invalidateToken } from './auth'
import { VersatureError, type EndpointName } from './types'
import { log } from '@/lib/utils/logger'

const RETRY_BACKOFF_MS = [2_000, 8_000, 32_000]
const DEFAULT_RETRY_AFTER_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function baseUrl(): string {
  const v = process.env.VERSATURE_BASE_URL
  if (!v) throw new Error('VERSATURE_BASE_URL is required')
  return v
}

function apiVersion(): string {
  return process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.10.0+json'
}

export async function request<T>(
  endpoint: EndpointName,
  path: string,
  init?: RequestInit,
): Promise<T> {
  await acquire(endpoint)

  let unauthorizedRetried = false
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken()
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: apiVersion(),
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })

    if (res.status === 401 && !unauthorizedRetried) {
      log.warn('versature 401 — invalidating token and retrying once', { endpoint, path })
      invalidateToken()
      unauthorizedRetried = true
      continue
    }

    if (res.status === 429) {
      if (attempt >= RETRY_BACKOFF_MS.length) {
        throw new VersatureError(429, 'rate-limited (429) after retries')
      }
      const ra = Number(res.headers.get('Retry-After'))
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1_000 : DEFAULT_RETRY_AFTER_MS
      log.warn('versature 429 — sleeping per Retry-After', { endpoint, path, waitMs })
      await sleep(waitMs)
      continue
    }

    if (res.status >= 500 && res.status < 600) {
      if (attempt >= RETRY_BACKOFF_MS.length) {
        throw new VersatureError(res.status, `5xx after retries: ${await res.text()}`)
      }
      const waitMs = RETRY_BACKOFF_MS[attempt]
      log.warn('versature 5xx — backing off', { endpoint, path, status: res.status, waitMs })
      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      throw new VersatureError(res.status, `${res.status}: ${await res.text()}`)
    }

    return res.json() as Promise<T>
  }
}
