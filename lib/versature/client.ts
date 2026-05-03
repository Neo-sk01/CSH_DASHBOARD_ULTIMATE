import { acquire } from './rate-limiter'
import { getAccessToken, invalidateToken } from './auth'
import { VersatureError, type EndpointName } from './types'
import { log } from '@/lib/utils/logger'

const RETRY_BACKOFF_MS = [2_000, 8_000, 32_000]
const DEFAULT_RETRY_AFTER_MS = 30_000
const FETCH_TIMEOUT_MS = 30_000

const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'ECONNABORTED',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])

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

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  // Node fetch (undici) wraps transport errors as TypeError with a `cause` carrying the syscall code.
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string; name?: string } }).cause
    if (cause?.code && TRANSIENT_NET_CODES.has(cause.code)) return true
    if (cause?.name === 'AbortError' || cause?.name === 'TimeoutError') return true
    // msw simulates network errors as `TypeError: Failed to fetch` with no cause.
    if (err.message === 'Failed to fetch') return true
  }
  return false
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function request<T>(
  endpoint: EndpointName,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let unauthorizedRetried = false
  for (let attempt = 0; ; attempt++) {
    await acquire(endpoint)
    const token = await getAccessToken()
    let res: Response
    try {
      res = await fetchWithTimeout(`${baseUrl()}${path}`, {
        ...init,
        headers: {
          Accept: apiVersion(),
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      }, FETCH_TIMEOUT_MS)
    } catch (err) {
      if (isTransientNetworkError(err) && attempt < RETRY_BACKOFF_MS.length) {
        const waitMs = RETRY_BACKOFF_MS[attempt]
        log.warn('versature transport error — backing off', { endpoint, path, error: (err as Error).message, waitMs })
        await sleep(waitMs)
        continue
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new VersatureError(0, `transport error after retries: ${message}`)
    }

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
