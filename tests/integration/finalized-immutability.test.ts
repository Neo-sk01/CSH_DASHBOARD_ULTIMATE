import { it, expect } from 'vitest'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'

it('finalized monthly snapshot resists update without forceFinalize; forceFinalize overrides', async () => {
  const db = await makeTestWarehouse()
  // Seed an old logical call (Revision 2 schema: 10 columns) + a finalized monthly snapshot that disagrees
  await db.run(`INSERT INTO logical_calls (
    from_call_id, call_date, caller_id, start_time, end_time, total_duration_seconds,
    segment_count, touched_dnis, rebuilt_at, pull_run_id
  ) VALUES ('a','2026-03-15','+15551234567','2026-03-15T12:00:00','2026-03-15T12:01:00',60,1,true,now(),'seed')`)
  await db.run(`INSERT INTO kpi_snapshots (period, period_start, period_end, include_weekends,
    total_incoming, english_calls, french_calls, ai_calls, ai_overflow_calls,
    total_queue_activity, is_finalized, computed_at, pull_run_id)
    VALUES ('monthly','2026-03-01','2026-03-31',true,
            999, 0, 0, 0, 0, '[]'::JSON, true, now(), 'old')`)
  const w = wrap(db)
  const queues = { en: '8020', fr: '8021', aiEn: '8030', aiFr: '8031' }
  await buildSnapshots(w, { pullRunId: 'rNew', window: { start: '2026-03-15', end: '2026-03-15' }, forceFinalize: false, queues })
  const blocked = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='monthly' AND period_start='2026-03-01' AND include_weekends=true`)
  expect(Number(blocked?.ti)).toBe(999)
  await buildSnapshots(w, { pullRunId: 'rForce', window: { start: '2026-03-15', end: '2026-03-15' }, forceFinalize: true, queues })
  const overridden = await w.one<{ ti: number; pid: string }>(`SELECT total_incoming as ti, pull_run_id as pid FROM kpi_snapshots WHERE period='monthly' AND period_start='2026-03-01' AND include_weekends=true`)
  expect(Number(overridden?.ti)).toBe(1)
  expect(overridden?.pid).toBe('rForce')
  await db.close()
})
