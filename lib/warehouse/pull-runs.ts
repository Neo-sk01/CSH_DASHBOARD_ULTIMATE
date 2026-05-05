import { ulid } from 'ulid'
import type { WarehouseWriter } from './client'

export type TriggeredBy = 'cron' | 'cron-month-rollover' | 'admin' | 'manual'
export type PullStatus = 'running' | 'success' | 'partial_fetch' | 'partial_build' | 'failed'

export interface OpenRunArgs {
  triggeredBy: TriggeredBy
  windowStart: string
  windowEnd: string
  reason?: string
}

export async function openPullRun(w: WarehouseWriter, args: OpenRunArgs): Promise<string> {
  const id = ulid()
  await w.exec(
    `INSERT INTO pull_runs
       (pull_run_id, triggered_by, triggered_at, status, window_start, window_end, reason)
     VALUES (?, ?, now(), 'running', ?, ?, ?)`,
    [id, args.triggeredBy, args.windowStart, args.windowEnd, args.reason?.trim() || null],
  )
  return id
}

export interface CloseRunArgs {
  pullRunId: string
  status: PullStatus
  cdrSegmentsCount?: number
  queueStatsCount?: number
  splitsCount?: number
  logicalCallsBuilt?: number
  snapshotsBuilt?: number
  errorSummary?: string
  finalizedMonth?: string
}

export async function closePullRun(w: WarehouseWriter, args: CloseRunArgs): Promise<void> {
  await w.exec(
    `UPDATE pull_runs SET
       finished_at = now(),
       status = ?,
       cdr_segments_count = ?,
       queue_stats_count = ?,
       splits_count = ?,
       logical_calls_built = ?,
       snapshots_built = ?,
       error_summary = ?,
       finalized_month = ?
     WHERE pull_run_id = ?`,
    [
      args.status,
      args.cdrSegmentsCount ?? null,
      args.queueStatsCount ?? null,
      args.splitsCount ?? null,
      args.logicalCallsBuilt ?? null,
      args.snapshotsBuilt ?? null,
      args.errorSummary ?? null,
      args.finalizedMonth ?? null,
      args.pullRunId,
    ],
  )
}

export async function updatePullRunCounts(
  w: WarehouseWriter,
  pullRunId: string,
  field: 'cdr_segments_count' | 'queue_stats_count' | 'splits_count' | 'logical_calls_built' | 'snapshots_built',
  value: number,
): Promise<void> {
  await w.exec(`UPDATE pull_runs SET ${field} = ? WHERE pull_run_id = ?`, [value, pullRunId])
}
