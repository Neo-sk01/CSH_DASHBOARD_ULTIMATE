import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow } from '@/lib/versature/types'
import { eachDate, resolvePeriodEnd, resolvePeriodStart } from '@/lib/utils/dates'
import { parseISO } from 'date-fns'
import { log } from '@/lib/utils/logger'

export interface BuildSnapshotsArgs {
  pullRunId: string
  window: DateWindow
  forceFinalize: boolean
  queues: { en: string; fr: string; aiEn: string; aiFr: string }
}

type PeriodType = 'daily' | 'weekly' | 'monthly'

interface SnapshotCandidate {
  period: PeriodType
  periodStart: string
  periodEnd: string
  includeWeekends: boolean
}

async function writeSnapshot(
  w: WarehouseWriter,
  candidate: SnapshotCandidate,
  queues: { en: string; fr: string; aiEn: string; aiFr: string },
  pullRunId: string,
  forceFinalize: boolean,
): Promise<number> {
  const { period, periodStart, periodEnd, includeWeekends } = candidate
  const { en, fr, aiEn, aiFr } = queues

  const existing = await w.one<{ is_finalized: boolean }>(
    `SELECT is_finalized FROM kpi_snapshots
     WHERE period = ? AND period_start = ? AND include_weekends = ?`,
    [period, periodStart, includeWeekends],
  )
  if (existing?.is_finalized === true && !forceFinalize) {
    log.warn('build-snapshots: skipping finalized row', { period, periodStart, includeWeekends })
    return 0
  }

  const weekendFilterLC = includeWeekends ? '' : `AND extract(dow FROM call_date) NOT IN (0, 6)`
  const weekendFilterQS = includeWeekends ? '' : `AND extract(dow FROM business_date) NOT IN (0, 6)`

  let isFinalizedExpr: string
  let finalizedParams: unknown[]
  if (period === 'daily') {
    isFinalizedExpr = `(?::DATE < current_date - INTERVAL 7 DAY) OR ?::BOOLEAN`
    finalizedParams = [periodStart, forceFinalize]
  } else if (period === 'weekly') {
    isFinalizedExpr = `(?::DATE < current_date - INTERVAL 7 DAY AND ?::DATE < current_date - INTERVAL 7 DAY) OR ?::BOOLEAN`
    finalizedParams = [periodStart, periodEnd, forceFinalize]
  } else {
    isFinalizedExpr = `?::BOOLEAN`
    finalizedParams = [forceFinalize]
  }

  const countBefore = await w.one<{ c: number }>(
    `SELECT count(*) as c FROM kpi_snapshots WHERE period = ? AND period_start = ? AND include_weekends = ?`,
    [period, periodStart, includeWeekends],
  )

  const sql = `
    WITH dnis_total AS (
      SELECT
        call_date,
        count(*) AS total_incoming
      FROM logical_calls
      WHERE call_date BETWEEN ? AND ?
        AND touched_dnis = true
        ${weekendFilterLC}
      GROUP BY call_date
    ),
    queue_buckets AS (
      SELECT
        business_date AS call_date,
        sum(calls_offered) FILTER (WHERE queue_id = ?) AS english_calls,
        sum(calls_offered) FILTER (WHERE queue_id = ?) AS french_calls,
        sum(calls_offered) FILTER (WHERE queue_id IN (?, ?)) AS ai_calls
      FROM raw_queue_stats
      WHERE business_date BETWEEN ? AND ?
        ${weekendFilterQS}
      GROUP BY business_date
    ),
    queue_activity AS (
      SELECT
        business_date AS call_date,
        to_json(list(struct_pack(k := queue_id, v := calls_offered) ORDER BY queue_id)) AS total_queue_activity
      FROM raw_queue_stats
      WHERE business_date BETWEEN ? AND ?
        ${weekendFilterQS}
      GROUP BY business_date
    ),
    all_dates AS (
      SELECT call_date FROM dnis_total
      UNION
      SELECT call_date FROM queue_buckets
    ),
    candidate AS (
      SELECT
        ?::VARCHAR AS period,
        ?::DATE AS period_start,
        ?::DATE AS period_end,
        ?::BOOLEAN AS include_weekends,
        coalesce(t.total_incoming, 0) AS total_incoming,
        coalesce(b.english_calls, 0) AS english_calls,
        coalesce(b.french_calls, 0) AS french_calls,
        coalesce(b.ai_calls, 0) AS ai_calls,
        coalesce(b.ai_calls, 0) AS ai_overflow_calls,
        coalesce(q.total_queue_activity, '[]'::JSON) AS total_queue_activity,
        (${isFinalizedExpr}) AS is_finalized,
        now() AS computed_at,
        ?::VARCHAR AS pull_run_id
      FROM all_dates d
      LEFT JOIN dnis_total t USING (call_date)
      LEFT JOIN queue_buckets b USING (call_date)
      LEFT JOIN queue_activity q USING (call_date)
    )
    INSERT OR REPLACE INTO kpi_snapshots
    SELECT c.* FROM candidate c
    WHERE NOT EXISTS (
      SELECT 1 FROM kpi_snapshots e
      WHERE e.period = c.period
        AND e.period_start = c.period_start
        AND e.include_weekends = c.include_weekends
        AND e.total_incoming = c.total_incoming
        AND e.english_calls = c.english_calls
        AND e.french_calls = c.french_calls
        AND e.ai_calls = c.ai_calls
        AND e.ai_overflow_calls = c.ai_overflow_calls
        AND e.total_queue_activity::VARCHAR = c.total_queue_activity::VARCHAR
        AND e.is_finalized = c.is_finalized
    )
  `

  const params: unknown[] = [
    periodStart, periodEnd,
    en, fr, aiEn, aiFr, periodStart, periodEnd,
    periodStart, periodEnd,
    period, periodStart, periodEnd, includeWeekends,
    ...finalizedParams,
    pullRunId,
  ]

  await w.exec(sql, params)

  const countAfter = await w.one<{ c: number }>(
    `SELECT count(*) as c FROM kpi_snapshots WHERE period = ? AND period_start = ? AND include_weekends = ?`,
    [period, periodStart, includeWeekends],
  )

  if (Number(countAfter?.c ?? 0) > Number(countBefore?.c ?? 0)) {
    return 1
  }

  const current = await w.one<{ pull_run_id: string }>(
    `SELECT pull_run_id FROM kpi_snapshots WHERE period = ? AND period_start = ? AND include_weekends = ?`,
    [period, periodStart, includeWeekends],
  )
  if (current?.pull_run_id === pullRunId && Number(countBefore?.c ?? 0) === 0) {
    return 1
  }

  return 0
}

export async function buildSnapshots(w: WarehouseWriter, args: BuildSnapshotsArgs): Promise<number> {
  const { pullRunId, window, forceFinalize, queues } = args
  const dates = eachDate(window.start, window.end)

  let written = 0

  for (const date of dates) {
    for (const includeWeekends of [true, false]) {
      const n = await writeSnapshot(
        w,
        { period: 'daily', periodStart: date, periodEnd: date, includeWeekends },
        queues,
        pullRunId,
        forceFinalize,
      )
      written += n
    }
  }

  const weeklyStartsSeen = new Set<string>()
  for (const date of dates) {
    const ref = parseISO(`${date}T12:00:00`)
    const wStart = resolvePeriodStart('weekly', ref)
    if (weeklyStartsSeen.has(wStart)) continue
    weeklyStartsSeen.add(wStart)

    for (const includeWeekends of [true, false]) {
      const wEnd = resolvePeriodEnd('weekly', wStart, includeWeekends)
      const n = await writeSnapshot(
        w,
        { period: 'weekly', periodStart: wStart, periodEnd: wEnd, includeWeekends },
        queues,
        pullRunId,
        forceFinalize,
      )
      written += n
    }
  }

  const monthlyStartsSeen = new Set<string>()
  for (const date of dates) {
    const ref = parseISO(`${date}T12:00:00`)
    const mStart = resolvePeriodStart('monthly', ref)
    if (monthlyStartsSeen.has(mStart)) continue
    monthlyStartsSeen.add(mStart)

    for (const includeWeekends of [true, false]) {
      const mEnd = resolvePeriodEnd('monthly', mStart, includeWeekends)
      const n = await writeSnapshot(
        w,
        { period: 'monthly', periodStart: mStart, periodEnd: mEnd, includeWeekends },
        queues,
        pullRunId,
        forceFinalize,
      )
      written += n
    }
  }

  log.info('build-snapshots: done', { pullRunId, written, window })
  return written
}
