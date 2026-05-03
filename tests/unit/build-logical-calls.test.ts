import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Database } from 'duckdb-async'
import { buildLogicalCalls } from '@/lib/pipeline/build-logical-calls'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

const QUEUES = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }
const TRACKED_DNIS = ['6135949199']

interface SegmentSeed {
  from_call_id: string
  to_user: string | null
  to_id: string | null
  start_time: string
  duration?: number
}

async function seed(db: Database, seeds: SegmentSeed[]) {
  for (const s of seeds) {
    const sourceHash = `${s.from_call_id}|${s.to_user ?? ''}|${s.start_time}`
    await db.run(
      `INSERT INTO raw_cdr_segments (
         source_hash, from_call_id, to_call_id, from_id, from_name, from_user, from_domain,
         to_id, to_user, to_domain, duration_seconds, start_time, end_time, answer_time,
         call_date, pulled_at, pull_run_id
       ) VALUES (?, ?, NULL, '+15551234567', NULL, NULL, NULL, ?, ?, 'neolore.com',
                 ?, ?, ?, ?, '2026-04-30', now(), 'seed-run')`,
      sourceHash, s.from_call_id, s.to_id, s.to_user,
      s.duration ?? 60, s.start_time, s.start_time, s.start_time,
    )
  }
}

describe('buildLogicalCalls (Revision 2)', () => {
  it('25 distinct from_call_ids across 100 segments → 25 logical calls', async () => {
    const db = await makeTestWarehouse()
    const seeds: SegmentSeed[] = []
    for (let i = 0; i < 25; i++) {
      for (let s = 0; s < 4; s++) {
        seeds.push({
          from_call_id: `c${i}`,
          to_user: s === 0 ? QUEUES.en : '40',
          to_id: '+16135949199',
          start_time: `2026-04-30T12:0${s}:00`,
        })
      }
    }
    await seed(db, seeds)
    const w = wrap(db)
    const built = await buildLogicalCalls(w, {
      pullRunId: 'r1',
      window: { start: '2026-04-30', end: '2026-04-30' },
      queues: QUEUES,
      trackedDnisNormalized: TRACKED_DNIS,
    })
    expect(built).toBe(25)
    const c = await w.one<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(c?.c)).toBe(25)
    await db.close()
  })

  it('DNIS in multiple formats are all included; different DNIS is excluded', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'd1', to_user: null, to_id: '+16135949199',     start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd2', to_user: null, to_id: '6135949199',       start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd3', to_user: null, to_id: '+1 (613) 594-9199',start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd4', to_user: null, to_id: '613-594-9199',     start_time: '2026-04-30T12:00:00' },
      { from_call_id: 'd5', to_user: null, to_id: '6135949198',       start_time: '2026-04-30T12:00:00' }, // NOT included
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const ids = (await w.all<{ from_call_id: string }>('SELECT from_call_id FROM logical_calls ORDER BY from_call_id')).map((r) => r.from_call_id)
    expect(ids).toEqual(['d1', 'd2', 'd3', 'd4'])
    await db.close()
  })

  it('Call with no DNIS and no tracked queue is excluded', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'x1', to_user: '40', to_id: '+15551234567', start_time: '2026-04-30T12:00:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const c = await w.one<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(c?.c)).toBe(0)
    await db.close()
  })

  it('Tracked-queue-only call (no DNIS) is included via secondary inclusion path', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'q1', to_user: QUEUES.aiEn, to_id: '+15551234567', start_time: '2026-04-30T12:00:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const c = await w.one<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(c?.c)).toBe(1)
    await db.close()
  })

  it('total_duration_seconds is the sum across segments; segment_count counts segments', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'cD', to_user: QUEUES.en, to_id: '+16135949199', start_time: '2026-04-30T12:00:00', duration: 30 },
      { from_call_id: 'cD', to_user: '40',      to_id: null,           start_time: '2026-04-30T12:01:00', duration: 90 },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const lc = await w.one<{ total_duration_seconds: number; segment_count: number }>('SELECT * FROM logical_calls WHERE from_call_id = ?', ['cD'])
    expect(Number(lc?.total_duration_seconds)).toBe(120)
    expect(Number(lc?.segment_count)).toBe(2)
    await db.close()
  })

  it('DELETE + INSERT is idempotent for the same window', async () => {
    const db = await makeTestWarehouse()
    await seed(db, [
      { from_call_id: 'i1', to_user: QUEUES.en, to_id: '+16135949199', start_time: '2026-04-30T12:00:00' },
    ])
    const w = wrap(db)
    await buildLogicalCalls(w, { pullRunId: 'r1', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    await buildLogicalCalls(w, { pullRunId: 'r2', window: { start: '2026-04-30', end: '2026-04-30' }, queues: QUEUES, trackedDnisNormalized: TRACKED_DNIS })
    const c = await w.one<{ c: number }>('SELECT count(*) as c FROM logical_calls')
    expect(Number(c?.c)).toBe(1)
    await db.close()
  })

  it('Real-sample canary: fixture matches expected counts', async () => {
    const ndjson = await fs.readFile(path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.ndjson'), 'utf8')
    const expected = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.expected.json'), 'utf8'))

    const db = await makeTestWarehouse()
    // Bulk-insert the fixture directly via NDJSON read (same path the production loader uses).
    const tmp = path.join(process.cwd(), 'tests/fixtures/.real-cdr-samples-flat.ndjson')
    const flat = ndjson.split('\n').filter(Boolean).map((line) => {
      const r = JSON.parse(line)
      const sourceHash = createHash('sha256').update(`${r.from.call_id}|${r.to.call_id ?? ''}|${r.start_time}`).digest('hex')
      return JSON.stringify({
        source_hash: sourceHash,
        from_call_id: r.from.call_id, to_call_id: r.to.call_id,
        from_id: r.from.id, from_name: r.from.name, from_user: r.from.user, from_domain: r.from.domain,
        to_id: r.to.id, to_user: r.to.user, to_domain: r.to.domain,
        duration_seconds: r.duration, start_time: r.start_time, end_time: r.end_time,
        answer_time: r.answer_time, call_date: r.start_time.slice(0, 10),
        pulled_at: '2026-05-01T08:00:00Z', pull_run_id: 'fixture',
      })
    }).join('\n') + '\n'
    await fs.writeFile(tmp, flat, 'utf8')
    await db.exec(`INSERT INTO raw_cdr_segments SELECT * FROM read_json('${tmp}', format='newline_delimited', auto_detect=true)`)
    await fs.unlink(tmp)

    const w = wrap(db)
    await buildLogicalCalls(w, {
      pullRunId: 'fixture',
      window: { start: '2026-04-16', end: '2026-04-16' },
      queues: QUEUES,
      trackedDnisNormalized: TRACKED_DNIS,
    })
    const c = await w.one<{ lc: number; ti: number }>(
      `SELECT count(*) as lc, count(*) FILTER (WHERE touched_dnis) as ti FROM logical_calls`,
    )
    expect(Number(c?.lc)).toBe(expected.totalLogicalCallsAfterFilter)
    expect(Number(c?.ti)).toBe(expected.totalIncoming)
    await db.close()
  })
})
