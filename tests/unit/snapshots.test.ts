import { it, expect } from 'vitest'
import { wrap } from '@/lib/warehouse/client'
import { makeTestWarehouse } from '@/tests/helpers/test-warehouse'

it('getSnapshot returns null for missing rows', async () => {
  const db = await makeTestWarehouse()
  const w = wrap(db)
  const got = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: true })
  expect(got).toBeNull()
  await db.close()
})

it('getSnapshot disambiguates the weekend toggle', async () => {
  const db = await makeTestWarehouse()
  await db.run(
    `INSERT INTO kpi_snapshots VALUES ('daily','2026-04-30','2026-04-30',true, 10,5,5,0,0,'[]'::JSON,false,now(),'r1')`,
  )
  await db.run(
    `INSERT INTO kpi_snapshots VALUES ('daily','2026-04-30','2026-04-30',false, 8,4,4,0,0,'[]'::JSON,false,now(),'r1')`,
  )
  const w = wrap(db)
  const inc = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: true })
  const exc = await w.getSnapshot({ period: 'daily', periodStart: '2026-04-30', includeWeekends: false })
  expect(Number(inc?.total_incoming)).toBe(10)
  expect(Number(exc?.total_incoming)).toBe(8)
  await db.close()
})

it('getMostRecentFinalizedDay returns the latest finalized daily period_start', async () => {
  const db = await makeTestWarehouse()
  await db.run(
    `INSERT INTO kpi_snapshots VALUES ('daily','2026-04-15','2026-04-15',true, 1,0,0,0,0,'[]'::JSON,true,now(),'r1')`,
  )
  await db.run(
    `INSERT INTO kpi_snapshots VALUES ('daily','2026-04-20','2026-04-20',true, 1,0,0,0,0,'[]'::JSON,true,now(),'r1')`,
  )
  await db.run(
    `INSERT INTO kpi_snapshots VALUES ('daily','2026-04-30','2026-04-30',true, 1,0,0,0,0,'[]'::JSON,false,now(),'r1')`,
  )
  const w = wrap(db)
  const day = (await w.getMostRecentFinalizedDay()) as unknown as Date | string | null
  // DuckDB returns DATE columns as Date objects at runtime even though
  // the helper's return type is string | null — coerce defensively.
  const dayStr = day == null
    ? null
    : day instanceof Date
      ? day.toISOString().slice(0, 10)
      : day
  expect(dayStr).toBe('2026-04-20')
  await db.close()
})
