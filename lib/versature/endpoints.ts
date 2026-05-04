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
//    headroom for busy days. If a single day exceeds 1000 segments, this code
//    cannot retrieve the rest and logs a warning — at that point the API design
//    needs to change (cursor pagination, smaller windows, etc).
const CDR_DAILY_LIMIT = 1000

function nextDay(dateStr: string): string {
  return format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}

export async function* fetchCdrs(window: DateWindow): AsyncIterable<VersatureCdr> {
  for (const day of eachDate(window.start, window.end)) {
    const exclusiveEnd = nextDay(day)
    const rows = await request<VersatureCdr[]>(
      'cdrs',
      `/cdrs/?start_date=${day}&end_date=${exclusiveEnd}&limit=${CDR_DAILY_LIMIT}`,
    )
    for (const row of rows) yield row
    if (rows.length >= CDR_DAILY_LIMIT) {
      log.warn('fetchCdrs: day hit CDR_DAILY_LIMIT — possible truncation', { day, returned: rows.length })
    }
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
  if (Array.isArray(result)) {
    return result[0] ?? ({} as QueueStatsResponse)
  }
  return result
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
