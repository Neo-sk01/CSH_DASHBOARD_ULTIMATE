import { request } from './client'
import type { VersatureCdr, QueueStatsResponse, QueueSplitsResponse, DateWindow } from './types'

const CDR_PAGE_SIZE = 500

export async function* fetchCdrs(window: DateWindow): AsyncIterable<VersatureCdr> {
  let page = 1
  while (true) {
    const rows = await request<VersatureCdr[]>(
      'cdrs',
      `/cdrs/?start_date=${window.start}&end_date=${window.end}&limit=${CDR_PAGE_SIZE}&page=${page}`,
    )
    if (rows.length === 0) return
    for (const row of rows) yield row
    if (rows.length < CDR_PAGE_SIZE) return
    page += 1
  }
}

export async function fetchQueueStats(queueId: string, window: DateWindow): Promise<QueueStatsResponse> {
  return request<QueueStatsResponse>(
    'queue_stats',
    `/call_queues/${queueId}/stats/?start_date=${window.start}&end_date=${window.end}`,
  )
}

export async function fetchQueueSplits(
  queueId: string,
  period: 'day' | 'hour' | 'month',
  window: DateWindow,
): Promise<QueueSplitsResponse> {
  return request<QueueSplitsResponse>(
    'queue_splits',
    `/call_queues/${queueId}/reports/splits/?start_date=${window.start}&end_date=${window.end}&period=${period}`,
  )
}
