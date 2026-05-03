import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from 'duckdb-async'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

const QUEUES = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }

interface LogicalSeed {
  from_call_id: string
  call_date: string
  touched_dnis?: boolean
}

async function seedLogical(db: Database, rows: LogicalSeed[]) {
  for (const r of rows) {
    await db.run(
      `INSERT INTO logical_calls (
         from_call_id, call_date, caller_id, start_time, end_time, total_duration_seconds,
         segment_count, touched_dnis, rebuilt_at, pull_run_id
       ) VALUES (?, ?, '+15551234567', ?, ?, 60, 1, ?, now(), 'seed')`,
      r.from_call_id, r.call_date,
      `${r.call_date}T12:00:00`, `${r.call_date}T12:01:00`,
      r.touched_dnis ?? true,
    )
  }
}

interface QueueStatsSeed {
  queue_id: string
  business_date: string
  calls_offered: number
}

async function seedQueueStats(db: Database, rows: QueueStatsSeed[]) {
  for (const r of rows) {
    await db.run(
      `INSERT INTO raw_queue_stats (
         queue_id, business_date, calls_offered, abandoned_calls, abandoned_rate,
         avg_talk_seconds, avg_handle_seconds, raw_payload, pulled_at, pull_run_id
       ) VALUES (?, ?, ?, 0, 0, 0, 0, '{}', now(), 'seed')`,
      r.queue_id, r.business_date, r.calls_offered,
    )
  }
}

describe('buildSnapshots (Revision 2)', () => {
  it('writes daily snapshots with both weekend variants; queue counts come from raw_queue_stats', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [
      { from_call_id: 'a', call_date: '2026-04-30' },
      { from_call_id: 'b', call_date: '2026-04-30' },
    ])
    await seedQueueStats(db, [
      { queue_id: '8020', business_date: '2026-04-30', calls_offered: 100 },
      { queue_id: '8021', business_date: '2026-04-30', calls_offered: 5 },
      { queue_id: '8030', business_date: '2026-04-30', calls_offered: 30 },
      { queue_id: '8031', business_date: '2026-04-30', calls_offered: 0 },
    ])
    const w = wrap(db)
    await buildSnapshots(w, {
      pullRunId: 'r1',
      window: { start: '2026-04-30', end: '2026-04-30' },
      forceFinalize: false,
      queues: QUEUES,
    })
    const daily = await w.all<any>(`SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' ORDER BY include_weekends`)
    expect(daily).toHaveLength(2)
    const wIncWeekends = daily.find((r: any) => r.include_weekends === true)
    expect(Number(wIncWeekends.total_incoming)).toBe(2)
    expect(Number(wIncWeekends.english_calls)).toBe(100)
    expect(Number(wIncWeekends.french_calls)).toBe(5)
    expect(Number(wIncWeekends.ai_calls)).toBe(30)
    expect(Number(wIncWeekends.ai_overflow_calls)).toBe(30)
    await db.close()
  })

  it('re-running with no data changes is a strict no-op (computed_at unchanged)', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30' }])
    await seedQueueStats(db, [{ queue_id: '8020', business_date: '2026-04-30', calls_offered: 10 }])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r1', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false, queues: QUEUES })
    const before = await w.one<{ ca: string; pid: string }>(`SELECT computed_at as ca, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    await new Promise((r) => setTimeout(r, 25))
    await buildSnapshots(w, { pullRunId: 'r2', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false, queues: QUEUES })
    const after = await w.one<{ ca: string; pid: string }>(`SELECT computed_at as ca, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    expect(after?.ca).toStrictEqual(before?.ca)
    expect(after?.pid).toBe(before?.pid)
    await db.close()
  })

  it('updates exactly the row whose data changed (queue calls_offered changed)', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30' }])
    await seedQueueStats(db, [{ queue_id: '8020', business_date: '2026-04-30', calls_offered: 10 }])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r1', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false, queues: QUEUES })
    await db.run(`UPDATE raw_queue_stats SET calls_offered = 20 WHERE queue_id = '8020' AND business_date = '2026-04-30'`)
    await buildSnapshots(w, { pullRunId: 'r2', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false, queues: QUEUES })
    const row = await w.one<{ ec: number; pid: string }>(`SELECT english_calls as ec, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    expect(Number(row?.ec)).toBe(20)
    expect(row?.pid).toBe('r2')
    await db.close()
  })

  it('finalized snapshot is not overwritten without forceFinalize', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-01' }])
    await seedQueueStats(db, [{ queue_id: '8020', business_date: '2026-04-01', calls_offered: 100 }])
    await db.run(
      `INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
         total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
         total_queue_activity, is_finalized, computed_at, pull_run_id)
       VALUES ('daily','2026-04-01','2026-04-01',true,
               999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`,
    )
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'rNew', window: { start: '2026-04-01', end: '2026-04-01' }, forceFinalize: false, queues: QUEUES })
    const row = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-01' AND include_weekends=true`)
    expect(Number(row?.ti)).toBe(999)
    expect(row?.pid).toBe('old')
    await db.close()
  })

  it('forceFinalize=true overrides and updates a finalized row', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-01' }])
    await seedQueueStats(db, [{ queue_id: '8020', business_date: '2026-04-01', calls_offered: 100 }])
    await db.run(
      `INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
         total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
         total_queue_activity, is_finalized, computed_at, pull_run_id)
       VALUES ('daily','2026-04-01','2026-04-01',true,
               999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`,
    )
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'rForce', window: { start: '2026-04-01', end: '2026-04-01' }, forceFinalize: true, queues: QUEUES })
    const row = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-01' AND include_weekends=true`)
    expect(Number(row?.ti)).toBe(1)
    expect(row?.pid).toBe('rForce')
    await db.close()
  })

  it('total_queue_activity JSON is sorted by queue_id', async () => {
    const db = await makeTestWarehouse()
    await seedLogical(db, [{ from_call_id: 'a', call_date: '2026-04-30' }])
    await seedQueueStats(db, [
      { queue_id: '8030', business_date: '2026-04-30', calls_offered: 30 },
      { queue_id: '8020', business_date: '2026-04-30', calls_offered: 20 },
      { queue_id: '8021', business_date: '2026-04-30', calls_offered: 21 },
    ])
    const w = wrap(db)
    await buildSnapshots(w, { pullRunId: 'r', window: { start: '2026-04-30', end: '2026-04-30' }, forceFinalize: false, queues: QUEUES })
    const row = await w.one<{ tqa: string }>(`SELECT total_queue_activity::VARCHAR as tqa FROM kpi_snapshots WHERE period='daily' AND period_start='2026-04-30' AND include_weekends=true`)
    expect(row?.tqa).toMatch(/^\[\{"k":"8020"/)
    expect(row?.tqa.indexOf('"8020"')).toBeLessThan(row?.tqa.indexOf('"8021"') ?? -1)
    expect(row?.tqa.indexOf('"8021"')).toBeLessThan(row?.tqa.indexOf('"8030"') ?? -1)
    await db.close()
  })

  it('Real-sample canary: combines real-cdr-samples + queue-stats-samples → expected-snapshot', async () => {
    const expected = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/expected-snapshot.json'), 'utf8'))
    const queueStatsFx = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/queue-stats-samples.json'), 'utf8'))
    const cdrExpected = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.expected.json'), 'utf8'))

    const db = await makeTestWarehouse()
    for (let i = 0; i < cdrExpected.totalIncoming; i++) {
      await db.run(
        `INSERT INTO logical_calls (from_call_id, call_date, caller_id, start_time, end_time,
          total_duration_seconds, segment_count, touched_dnis, rebuilt_at, pull_run_id)
         VALUES (?, ?, '+15551234567', ?, ?, 60, 1, true, now(), 'fixture')`,
        `c${i}`, expected.row.period_start,
        `${expected.row.period_start}T12:00:00`, `${expected.row.period_start}T12:01:00`,
      )
    }
    for (const r of queueStatsFx.rows) {
      await db.run(
        `INSERT INTO raw_queue_stats (queue_id, business_date, calls_offered, abandoned_calls,
          abandoned_rate, avg_talk_seconds, avg_handle_seconds, raw_payload, pulled_at, pull_run_id)
         VALUES (?, ?, ?, 0, 0, 0, 0, '{}', now(), 'fixture')`,
        r.queue_id, r.business_date, r.calls_offered,
      )
    }
    const w = wrap(db)
    await buildSnapshots(w, {
      pullRunId: 'fixture',
      window: { start: expected.row.period_start, end: expected.row.period_end },
      forceFinalize: true,
      queues: QUEUES,
    })
    const row = await w.one<any>(
      `SELECT * FROM kpi_snapshots WHERE period='daily' AND period_start = ? AND include_weekends = true`,
      [expected.row.period_start],
    )
    expect(Number(row?.total_incoming)).toBe(expected.row.total_incoming)
    expect(Number(row?.english_calls)).toBe(expected.row.english_calls)
    expect(Number(row?.french_calls)).toBe(expected.row.french_calls)
    expect(Number(row?.ai_calls)).toBe(expected.row.ai_calls)
    expect(Number(row?.ai_overflow_calls)).toBe(expected.row.ai_overflow_calls)
    expect(row?.is_finalized).toBe(true)
    await db.close()
  })
})
