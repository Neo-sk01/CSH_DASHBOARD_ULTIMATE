import { Database } from 'duckdb-async'
import { NORMALIZE_DNIS_UDF_SQL } from '@/lib/utils/dnis'

export type SnapshotRow = {
  period: 'daily' | 'weekly' | 'monthly'
  period_start: string
  period_end: string
  include_weekends: boolean
  total_incoming: number
  english_calls: number
  french_calls: number
  ai_calls: number
  ai_overflow_calls: number
  total_queue_activity: unknown
  is_finalized: boolean
  computed_at: string
  pull_run_id: string
}

export type PullRunRow = {
  pull_run_id: string
  triggered_by: string
  triggered_at: string
  finished_at: string | null
  status: string
  window_start: string
  window_end: string
  cdr_segments_count: number | null
  queue_stats_count: number | null
  splits_count: number | null
  logical_calls_built: number | null
  snapshots_built: number | null
  error_summary: string | null
  finalized_month: string | null
}

// Read-only surface used by app/ and components/
export interface WarehouseReader {
  getSnapshot(args: { period: SnapshotRow['period']; periodStart: string; includeWeekends: boolean }): Promise<SnapshotRow | null>
  getMostRecentFinalizedDay(): Promise<string | null>
  getLatestSuccessfulPull(): Promise<PullRunRow | null>
  getRecentPullRuns(limit: number): Promise<PullRunRow[]>
  close(): Promise<void>
}

// Write surface used by jobs/ and lib/pipeline/
export interface WarehouseWriter extends WarehouseReader {
  exec(sql: string, params?: unknown[]): Promise<void>
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  one<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>
}

export interface OpenWarehouseOpts {
  mode: 'read' | 'write'
}

export async function openWarehouse(opts: OpenWarehouseOpts): Promise<WarehouseWriter> {
  const dbName = process.env.MOTHERDUCK_DATABASE
  if (!dbName) throw new Error('MOTHERDUCK_DATABASE is required')
  const token = opts.mode === 'write'
    ? process.env.MOTHERDUCK_TOKEN_RW
    : process.env.MOTHERDUCK_TOKEN_RO
  if (!token) {
    throw new Error(opts.mode === 'write' ? 'MOTHERDUCK_TOKEN_RW is required' : 'MOTHERDUCK_TOKEN_RO is required')
  }

  const db = await Database.create(`md:${dbName}?motherduck_token=${token}`)
  // Register the normalize_dnis UDF/macro for this connection
  await db.exec(NORMALIZE_DNIS_UDF_SQL)
  return wrap(db)
}

export function wrap(db: Database): WarehouseWriter {
  return {
    async exec(sql, params = []) {
      await db.run(sql, ...params)
    },
    async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await db.all(sql, ...params)) as T[]
    },
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const rows = (await db.all(sql, ...params)) as T[]
      return rows[0] ?? null
    },
    async getSnapshot({ period, periodStart, includeWeekends }) {
      const rows = await db.all(
        `SELECT * FROM kpi_snapshots
         WHERE period = ? AND period_start = ? AND include_weekends = ?
         LIMIT 1`,
        period, periodStart, includeWeekends,
      )
      return (rows[0] as SnapshotRow | undefined) ?? null
    },
    async getMostRecentFinalizedDay() {
      const rows = await db.all(
        `SELECT period_start FROM kpi_snapshots
         WHERE period = 'daily' AND is_finalized = true
         ORDER BY period_start DESC LIMIT 1`,
      )
      return ((rows[0] as { period_start?: string } | undefined)?.period_start) ?? null
    },
    async getLatestSuccessfulPull() {
      const rows = await db.all(
        `SELECT * FROM pull_runs
         WHERE status = 'success'
         ORDER BY finished_at DESC LIMIT 1`,
      )
      return (rows[0] as PullRunRow | undefined) ?? null
    },
    async getRecentPullRuns(limit) {
      return (await db.all(
        `SELECT * FROM pull_runs ORDER BY triggered_at DESC LIMIT ?`,
        limit,
      )) as PullRunRow[]
    },
    async close() {
      await db.close()
    },
  }
}
