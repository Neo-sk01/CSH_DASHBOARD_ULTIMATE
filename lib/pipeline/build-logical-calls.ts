import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow } from '@/lib/versature/types'

export interface BuildLogicalCallsArgs {
  pullRunId: string
  window: DateWindow
  queues: { en: string; fr: string; aiEn: string; aiFr: string }
  trackedDnisNormalized: string[]   // pre-normalized 10-digit strings
}

export async function buildLogicalCalls(
  w: WarehouseWriter,
  args: BuildLogicalCallsArgs,
): Promise<number> {
  // Strict DNIS-only inclusion (per code review): a call enters logical_calls only when at
  // least one segment's normalized to_id matches a tracked DNIS. Queue-touch is no longer
  // an inclusion path. `args.queues` is retained on the interface for future use.
  void args.queues

  // Validate every entry is a 10-digit string before substituting into SQL.
  for (const d of args.trackedDnisNormalized) {
    if (!/^\d{10}$/.test(d)) {
      throw new Error(`trackedDnisNormalized contains non-canonical entry: ${d}`)
    }
  }
  const dnisList = args.trackedDnisNormalized.map((d) => `'${d}'`).join(',') || `''`

  await w.exec(`DELETE FROM logical_calls WHERE call_date BETWEEN ? AND ?`, [args.window.start, args.window.end])

  await w.exec(`
    INSERT INTO logical_calls
    WITH segments AS (
      SELECT * FROM raw_cdr_segments
      WHERE call_date BETWEEN ? AND ?
    ),
    inclusion AS (
      SELECT
        from_call_id,
        bool_or(normalize_dnis(to_id) IN (${dnisList})) AS touched_dnis
      FROM segments
      GROUP BY from_call_id
    )
    SELECT
      s.from_call_id,
      date_trunc('day', min(s.start_time))::DATE                            AS call_date,
      any_value(s.from_id ORDER BY s.start_time)                            AS caller_id,
      min(s.start_time)                                                     AS start_time,
      max(s.end_time)                                                       AS end_time,
      sum(s.duration_seconds)                                               AS total_duration_seconds,
      count(*)                                                              AS segment_count,
      any_value(i.touched_dnis)                                             AS touched_dnis,
      now()                                                                 AS rebuilt_at,
      ?                                                                     AS pull_run_id
    FROM segments s
    JOIN inclusion i USING (from_call_id)
    WHERE i.touched_dnis = true
    GROUP BY s.from_call_id
  `, [args.window.start, args.window.end, args.pullRunId])

  const c = await w.one<{ c: number }>(
    `SELECT count(*) as c FROM logical_calls WHERE call_date BETWEEN ? AND ?`,
    [args.window.start, args.window.end],
  )
  return Number(c?.c ?? 0)
}
