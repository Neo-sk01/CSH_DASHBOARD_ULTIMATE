export type EndpointName = 'cdrs' | 'queue_stats' | 'queue_splits'

export interface VersatureCdr {
  duration: number
  answer_time: string | null
  start_time: string
  end_time: string
  from: {
    call_id: string
    name: string | null
    id: string | null
    user: string | null
    domain: string | null
  }
  to: {
    call_id: string | null
    id: string | null
    user: string | null
    domain: string | null
  }
}

export interface QueueStatsResponse {
  calls_offered: number | null
  abandoned_calls: number | null
  abandoned_rate: number | null
  average_talk_time: number | null
  average_handle_time: number | null
  // Versature may include other fields; we capture them in raw_payload for audit.
  [key: string]: unknown
}

export interface QueueSplitsResponse {
  // The shape varies by `period`. We treat it as opaque JSON in raw_queue_splits
  // and inspect it later. Define an open shape.
  [key: string]: unknown
}

export interface DateWindow {
  start: string  // YYYY-MM-DD
  end: string    // YYYY-MM-DD
}

export class VersatureError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'VersatureError'
  }
}
