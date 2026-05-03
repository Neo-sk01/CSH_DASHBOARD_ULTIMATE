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
  // Reserved fire times (synchronous, may be in the future). Acts as the per-minute window.
  reservations: number[]
  // Earliest time the next acquire is allowed to fire (sub-second floor).
  nextAvailableAt: number
}

const buckets: Record<EndpointName, Bucket> = {
  cdrs:         { reservations: [], nextAvailableAt: 0 },
  queue_stats:  { reservations: [], nextAvailableAt: 0 },
  queue_splits: { reservations: [], nextAvailableAt: 0 },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Reserve a fire time atomically (synchronous), then sleep until it.
// Concurrent callers each get a unique reservation, preventing bursts past the budget.
export async function acquire(endpoint: EndpointName): Promise<void> {
  const budget = BUDGETS[endpoint]
  const bucket = buckets[endpoint]
  const now = Date.now()

  // Earliest fire = max(now, sub-second floor from previous reservation).
  let reservedAt = Math.max(now, bucket.nextAvailableAt)

  // Drop reservations outside the 60s window relative to the candidate fire time.
  bucket.reservations = bucket.reservations.filter((t) => t > reservedAt - 60_000)

  // Per-minute window: if at limit, push reservation past the oldest entry's window.
  if (bucket.reservations.length >= budget.perMinute) {
    const oldest = bucket.reservations[0]
    reservedAt = Math.max(reservedAt, oldest + 60_000 + 1)
    bucket.reservations = bucket.reservations.filter((t) => t > reservedAt - 60_000)
  }

  bucket.reservations.push(reservedAt)
  bucket.nextAvailableAt = reservedAt + budget.minIntervalMs

  const sleepMs = reservedAt - Date.now()
  if (sleepMs > 0) await sleep(sleepMs)
}

export function _resetForTests(): void {
  for (const key of Object.keys(buckets) as EndpointName[]) {
    buckets[key] = { reservations: [], nextAvailableAt: 0 }
  }
}
