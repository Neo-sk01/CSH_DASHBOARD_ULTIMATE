import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET } from '@/app/api/health/freshness/route'
import * as snapshots from '@/lib/warehouse/snapshots'

const NOW_FIXED = new Date('2026-05-03T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_FIXED)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.FRESHNESS_MAX_AGE_HOURS
})

function fakePull(finishedAtIso: string | null) {
  return {
    pull_run_id: 'r1',
    triggered_by: 'cron',
    triggered_at: '2026-05-03T08:00:00Z',
    finished_at: finishedAtIso,
    status: 'success',
    window_start: '2026-05-02',
    window_end: '2026-05-02',
    cdr_segments_count: 0,
    queue_stats_count: 0,
    splits_count: 0,
    logical_calls_built: 0,
    snapshots_built: 0,
    error_summary: null,
    finalized_month: null,
  }
}

describe('GET /api/health/freshness', () => {
  it('returns 503 when no successful pull exists', async () => {
    vi.spyOn(snapshots, 'getLatestSuccessfulPull').mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.last_pull_at).toBeNull()
    expect(body.checked_at).toBe(NOW_FIXED.toISOString())
    expect(body.max_age_hours).toBe(36)
  })

  it('returns 503 when the most recent pull is older than the SLO', async () => {
    // 40 hours before NOW_FIXED → stale (default SLO is 36h).
    const fortyHoursAgo = new Date(NOW_FIXED.getTime() - 40 * 60 * 60 * 1000).toISOString()
    vi.spyOn(snapshots, 'getLatestSuccessfulPull').mockResolvedValue(fakePull(fortyHoursAgo) as never)
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.age_hours).toBe(40)
  })

  it('returns 200 when the most recent pull is within the SLO', async () => {
    const tenHoursAgo = new Date(NOW_FIXED.getTime() - 10 * 60 * 60 * 1000).toISOString()
    vi.spyOn(snapshots, 'getLatestSuccessfulPull').mockResolvedValue(fakePull(tenHoursAgo) as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.age_hours).toBe(10)
    expect(body.last_pull_at).toBe(tenHoursAgo)
  })

  it('honors the FRESHNESS_MAX_AGE_HOURS env override', async () => {
    process.env.FRESHNESS_MAX_AGE_HOURS = '72'
    const fiftyHoursAgo = new Date(NOW_FIXED.getTime() - 50 * 60 * 60 * 1000).toISOString()
    vi.spyOn(snapshots, 'getLatestSuccessfulPull').mockResolvedValue(fakePull(fiftyHoursAgo) as never)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.max_age_hours).toBe(72)
  })

  it('treats a successful pull with null finished_at as missing (503)', async () => {
    vi.spyOn(snapshots, 'getLatestSuccessfulPull').mockResolvedValue(fakePull(null) as never)
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
