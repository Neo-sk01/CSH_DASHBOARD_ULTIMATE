import type { EndpointName } from './types'

interface Budget {
  perMinute: number
  minIntervalMs: number
}

const BUDGETS: Record<EndpointName, Budget> = {
  cdrs:         { perMinute: 12, minIntervalMs: 200 },  // docs say 5/s, 15/min — we sit below
  queue_stats:  { perMinute: 24, minIntervalMs: 100 },  // docs say 10/s, 30/min — below
  queue_splits: { perMinute: 24, minIntervalMs: 100 },  // Task 0 Gate 3 verified: 30 requests in 24.6s, 0 x 429
}

interface Bucket {
  timestamps: number[]
  lastAt: number
}

const buckets: Record<EndpointName, Bucket> = {
  cdrs:         { timestamps: [], lastAt: 0 },
  queue_stats:  { timestamps: [], lastAt: 0 },
  queue_splits: { timestamps: [], lastAt: 0 },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function acquire(endpoint: EndpointName): Promise<void> {
  const budget = BUDGETS[endpoint]
  const bucket = buckets[endpoint]

  // 1. Sub-second floor
  const sinceLast = Date.now() - bucket.lastAt
  if (bucket.lastAt > 0 && sinceLast < budget.minIntervalMs) {
    await sleep(budget.minIntervalMs - sinceLast)
  }

  // 2. Per-minute sliding window
  const cutoff = Date.now() - 60_000
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff)
  if (bucket.timestamps.length >= budget.perMinute) {
    const oldest = bucket.timestamps[0]
    const waitMs = oldest + 60_000 - Date.now() + 1
    if (waitMs > 0) await sleep(waitMs)
    bucket.timestamps = bucket.timestamps.filter((t) => t > Date.now() - 60_000)
  }

  // 3. Record this acquire
  const now = Date.now()
  bucket.timestamps.push(now)
  bucket.lastAt = now
}

export function _resetForTests(): void {
  for (const key of Object.keys(buckets) as EndpointName[]) {
    buckets[key] = { timestamps: [], lastAt: 0 }
  }
}
