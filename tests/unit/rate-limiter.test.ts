import { describe, it, expect, beforeEach, vi } from 'vitest'
import { acquire, _resetForTests } from '@/lib/versature/rate-limiter'

beforeEach(() => {
  vi.useFakeTimers()
  _resetForTests()
})

describe('rate limiter', () => {
  it('lets the first per-minute budget through immediately', async () => {
    // CDR budget is 12/min; 12 calls should not block on the per-minute window.
    for (let i = 0; i < 12; i++) {
      const startedAt = Date.now()
      const wait = acquire('cdrs')
      // Sub-second floor (200ms) means call N>=2 will sleep ~200ms
      vi.advanceTimersByTime(250)
      await wait
      // Still under 60s window; per-minute limit not exceeded
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    }
  })

  it('blocks the 13th CDR call within 60s until the oldest entry ages out', async () => {
    // Burn the 12-per-minute budget
    for (let i = 0; i < 12; i++) {
      const wait = acquire('cdrs')
      vi.advanceTimersByTime(250)
      await wait
    }
    // 13th call should sleep until the first call's timestamp is >60s old.
    const wait13 = acquire('cdrs')
    let resolved = false
    wait13.then(() => { resolved = true })
    vi.advanceTimersByTime(50_000)
    await Promise.resolve()
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(15_000)  // total 65s past the first call
    await wait13
    expect(resolved).toBe(true)
  })

  it('per-endpoint buckets are isolated', async () => {
    // Burn CDR budget
    for (let i = 0; i < 12; i++) {
      const wait = acquire('cdrs')
      vi.advanceTimersByTime(250)
      await wait
    }
    // queue_stats should still be unblocked
    const wait = acquire('queue_stats')
    vi.advanceTimersByTime(150)
    await wait
    expect(true).toBe(true)  // didn't time out
  })

  it('enforces sub-second minIntervalMs floor', async () => {
    // First CDR call goes immediately; second must wait at least 200ms.
    await acquire('cdrs')
    const wait = acquire('cdrs')
    let resolved = false
    wait.then(() => { resolved = true })
    vi.advanceTimersByTime(150)
    await Promise.resolve()
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(60)  // total 210ms
    await wait
    expect(resolved).toBe(true)
  })
})
