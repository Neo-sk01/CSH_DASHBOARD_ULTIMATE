import { expect, it } from 'vitest'
import { openPullRun } from '@/lib/warehouse/pull-runs'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

it('persists the operator reason on pull_runs for auditability', async () => {
  const db = await makeTestWarehouse()
  const w = wrap(db)

  const id = await openPullRun(w, {
    triggeredBy: 'admin',
    windowStart: '2026-04-01',
    windowEnd: '2026-04-30',
    reason: 'correct April French queue stats',
  })

  const row = await w.one<{ reason: string }>('SELECT reason FROM pull_runs WHERE pull_run_id = ?', [id])
  expect(row?.reason).toBe('correct April French queue stats')
  await db.close()
})
