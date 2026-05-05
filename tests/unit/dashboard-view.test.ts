import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { DashboardView } from '@/components/DashboardView'
import type { SnapshotRow } from '@/lib/warehouse/client'

it('describes freshness with the snapshot computed_at timestamp, not a global latest pull', () => {
  const snapshot: SnapshotRow = {
    period: 'daily',
    period_start: '2026-04-30',
    period_end: '2026-04-30',
    include_weekends: false,
    total_incoming: 10,
    english_calls: 5,
    french_calls: 3,
    ai_calls: 2,
    ai_overflow_calls: 2,
    total_queue_activity: [],
    is_finalized: true,
    computed_at: '2026-04-30T08:00:00Z',
    pull_run_id: 'snapshot-run',
  }

  const html = renderToStaticMarkup(React.createElement(DashboardView, {
    snapshot,
    period: 'daily',
    includeWeekends: false,
    latestPullAt: '2026-05-05T08:00:00Z',
  } as any))

  expect(html).toContain('computed 2026-04-30 08:00 UTC')
  expect(html).not.toContain('2026-05-05 08:00 UTC')
})
