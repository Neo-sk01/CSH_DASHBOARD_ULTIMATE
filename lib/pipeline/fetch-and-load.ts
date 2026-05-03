import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import type { WarehouseWriter } from '@/lib/warehouse/client'
import type { DateWindow, VersatureCdr, QueueStatsResponse, QueueSplitsResponse } from '@/lib/versature/types'
import { fetchCdrs, fetchQueueStats, fetchQueueSplits } from '@/lib/versature/endpoints'
import { eachBusinessDate, toTorontoDate } from '@/lib/utils/dates'
import { log } from '@/lib/utils/logger'

function sourceHash(c: VersatureCdr): string {
  return createHash('sha256')
    .update(`${c.from.call_id}|${c.to.call_id ?? ''}|${c.start_time}`)
    .digest('hex')
}

interface LoadCdrArgs {
  pullRunId: string
  pulledAt: string
  window: DateWindow
}

export async function loadCdrs(w: WarehouseWriter, args: LoadCdrArgs): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `cdrs_${args.pullRunId}.ndjson`)
  let count = 0

  const lines: string[] = []
  for await (const row of fetchCdrs(args.window)) {
    const flat = {
      source_hash:      sourceHash(row),
      from_call_id:     row.from.call_id,
      to_call_id:       row.to.call_id,
      from_id:          row.from.id,
      from_name:        row.from.name,
      from_user:        row.from.user,
      from_domain:      row.from.domain,
      to_id:            row.to.id,
      to_user:          row.to.user,
      to_domain:        row.to.domain,
      duration_seconds: row.duration,
      start_time:       row.start_time,
      end_time:         row.end_time,
      answer_time:      row.answer_time,
      call_date:        toTorontoDate(row.start_time),
      pulled_at:        args.pulledAt,
      pull_run_id:      args.pullRunId,
    }
    lines.push(JSON.stringify(flat))
    count += 1
  }

  if (count === 0) {
    log.info('loadCdrs: no rows', { window: args.window })
    return 0
  }

  await fs.writeFile(tmpFile, lines.join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_cdr_segments
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})

  log.info('loadCdrs: complete', { window: args.window, count })
  return count
}

export async function loadQueueStats(
  w: WarehouseWriter,
  args: { pullRunId: string; pulledAt: string; window: DateWindow; queueIds: string[] },
): Promise<number> {
  const rows: Array<Record<string, unknown>> = []
  for (const queueId of args.queueIds) {
    for (const date of eachBusinessDate(args.window)) {
      const stats: QueueStatsResponse = await fetchQueueStats(queueId, { start: date, end: date })
      rows.push({
        queue_id:           queueId,
        business_date:      date,
        calls_offered:      Number(stats.calls_offered ?? 0),
        abandoned_calls:    Number(stats.abandoned_calls ?? 0),
        abandoned_rate:     Number(stats.abandoned_rate ?? 0),
        avg_talk_seconds:   Number(stats.average_talk_time ?? 0),
        avg_handle_seconds: Number(stats.average_handle_time ?? 0),
        raw_payload:        JSON.stringify(stats),
        pulled_at:          args.pulledAt,
        pull_run_id:        args.pullRunId,
      })
    }
  }

  if (rows.length === 0) return 0
  const tmpFile = path.join(os.tmpdir(), `queue_stats_${args.pullRunId}.ndjson`)
  await fs.writeFile(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_queue_stats
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})
  return rows.length
}

export async function loadQueueSplits(
  w: WarehouseWriter,
  args: { pullRunId: string; pulledAt: string; window: DateWindow; queueIds: string[] },
): Promise<number> {
  const rows: Array<Record<string, unknown>> = []
  for (const queueId of args.queueIds) {
    for (const period of ['day', 'hour', 'month'] as const) {
      const splits: QueueSplitsResponse = await fetchQueueSplits(queueId, period, args.window)
      rows.push({
        queue_id:     queueId,
        period,
        bucket_start: `${args.window.start}T00:00:00`,
        raw_payload:  JSON.stringify(splits),
        pulled_at:    args.pulledAt,
        pull_run_id:  args.pullRunId,
      })
    }
  }

  if (rows.length === 0) return 0
  const tmpFile = path.join(os.tmpdir(), `queue_splits_${args.pullRunId}.ndjson`)
  await fs.writeFile(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  await w.exec(
    `INSERT OR REPLACE INTO raw_queue_splits
       SELECT * FROM read_json(?, format='newline_delimited', auto_detect=true)`,
    [tmpFile],
  )
  await fs.unlink(tmpFile).catch(() => {})
  return rows.length
}
