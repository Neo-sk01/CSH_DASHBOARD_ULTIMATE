import { addDays, format, parseISO } from 'date-fns'
import { request } from './client'
import { log } from '@/lib/utils/logger'
import { eachDate } from '@/lib/utils/dates'
import type { VersatureCdr, QueueStatsResponse, QueueSplitsResponse, DateWindow } from './types'

// Versature `/cdrs/` API quirks (verified 2026-05-04 against tenant `neolore.com`,
// API version `application/vnd.integrate.v1.10.0+json`):
//
// 1. `end_date` is treated as EXCLUSIVE. A request with start=end returns an empty
//    range and the server falls back to "most recent N rows". To pull a calendar day
//    correctly, send end_date = next_day.
//
// 2. The `page` query parameter is silently IGNORED — every page returns identical
//    data. Pagination must therefore be done by date, not by page index. Each day
//    is fetched as a separate single-day call.
//
// 3. `limit` caps at ~1000; values above ~1000 return 429. We use 1000 to maximize
//    headroom for busy days. If a single day reaches that limit, the response may
//    be truncated, so the pull must fail rather than publishing undercounted KPIs.
const CDR_DAILY_LIMIT = 1000
const REQUIRED_QUEUE_STAT_FIELDS = [
  'calls_offered',
  'abandoned_calls',
  'abandoned_rate',
  'average_talk_time',
  'average_handle_time',
] as const

function nextDay(dateStr: string): string {
  return format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateQueueStats(
  queueId: string,
  window: DateWindow,
  stats: unknown,
): QueueStatsResponse {
  if (!isRecord(stats) || Object.keys(stats).length === 0) {
    throw new Error(`queue stats response empty for queue ${queueId} ${window.start}..${window.end}`)
  }

  for (const field of REQUIRED_QUEUE_STAT_FIELDS) {
    if (!(field in stats)) {
      throw new Error(`queue stats response missing ${field} for queue ${queueId} ${window.start}..${window.end}`)
    }
    const value = stats[field]
    if (field === 'calls_offered' || field === 'abandoned_calls') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`queue stats response invalid ${field} for queue ${queueId} ${window.start}..${window.end}`)
      }
    } else if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`queue stats response invalid ${field} for queue ${queueId} ${window.start}..${window.end}`)
    }
  }

  return stats as QueueStatsResponse
}

export async function* fetchCdrs(window: DateWindow): AsyncIterable<VersatureCdr> {
  for (const day of eachDate(window.start, window.end)) {
    const exclusiveEnd = nextDay(day)
    const rows = await request<VersatureCdr[]>(
      'cdrs',
      `/cdrs/?start_date=${day}&end_date=${exclusiveEnd}&limit=${CDR_DAILY_LIMIT}`,
    )
    if (rows.length >= CDR_DAILY_LIMIT) {
      log.error('fetchCdrs: day hit CDR_DAILY_LIMIT; aborting to avoid truncated KPIs', { day, returned: rows.length })
      throw new Error(`CDR daily limit reached for ${day}; possible truncation`)
    }
    for (const row of rows) yield row
  }
}

// `/call_queues/{id}/stats/` also treats end_date as exclusive and returns an
// array (one element per day in the window). The loader expects a single
// per-day object, so we send [day, day+1] and unwrap the first element.
export async function fetchQueueStats(queueId: string, window: DateWindow): Promise<QueueStatsResponse> {
  const exclusiveEnd = nextDay(window.end)
  const result = await request<QueueStatsResponse | QueueStatsResponse[]>(
    'queue_stats',
    `/call_queues/${queueId}/stats/?start_date=${window.start}&end_date=${exclusiveEnd}`,
  )
  const stats = Array.isArray(result) ? result[0] : result
  return validateQueueStats(queueId, window, stats)
}

export async function fetchQueueSplits(
  queueId: string,
  period: 'day' | 'hour' | 'month',
  window: DateWindow,
): Promise<QueueSplitsResponse> {
  const exclusiveEnd = nextDay(window.end)
  return request<QueueSplitsResponse>(
    'queue_splits',
    `/call_queues/${queueId}/reports/splits/?start_date=${window.start}&end_date=${exclusiveEnd}&period=${period}`,
  )
}
