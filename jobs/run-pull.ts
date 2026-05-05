import { pathToFileURL } from 'node:url'
import { format, parseISO, startOfMonth, subDays, lastDayOfMonth } from 'date-fns'
import { tz } from '@date-fns/tz'

import { openWarehouse } from '@/lib/warehouse/client'
import { openPullRun, closePullRun, updatePullRunCounts, type TriggeredBy } from '@/lib/warehouse/pull-runs'
import { loadCdrs, loadQueueStats, loadQueueSplits } from '@/lib/pipeline/fetch-and-load'
import { buildLogicalCalls } from '@/lib/pipeline/build-logical-calls'
import { buildSnapshots } from '@/lib/pipeline/build-snapshots'
import { normalizeDnisList } from '@/lib/utils/dnis'
import { log } from '@/lib/utils/logger'

const TZ = 'America/Toronto'
const NIGHTLY_CRON = '0 8 * * *'
const MONTHLY_CRON = '30 8 2 * *'

interface ResolvedWindow {
  start: string
  end: string
  triggeredBy: TriggeredBy
  forceFinalize: boolean
  reason: string
}

export function resolveWindow(env: NodeJS.ProcessEnv, now: Date = new Date()): ResolvedWindow {
  const start = env.PULL_WINDOW_START?.trim() || ''
  const end   = env.PULL_WINDOW_END?.trim()   || ''
  const trigger = env.PULL_TRIGGER || ''
  const reason = env.PULL_REASON?.trim() || ''
  const cron = (env.PULL_SCHEDULE_CRON?.trim() || '').replace(/\s+/g, ' ')
  const force = env.PULL_FORCE_FINALIZE === 'true'

  if (start && end) {
    const triggeredBy: TriggeredBy =
      trigger === 'workflow_dispatch' ? 'manual' :
      trigger === 'repository_dispatch' ? 'admin' :
      'manual'
    return { start, end, triggeredBy, forceFinalize: force, reason: reason || trigger || triggeredBy }
  }

  if (!cron) {
    throw new Error('Wiring error: PULL_WINDOW_* blank and PULL_SCHEDULE_CRON empty')
  }

  if (cron === MONTHLY_CRON) {
    const today = parseISO(format(now, 'yyyy-MM-dd', { in: tz(TZ) }))
    const prevMonthAny = subDays(startOfMonth(today, { in: tz(TZ) }), 1)
    const ws = format(startOfMonth(prevMonthAny, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
    const we = format(lastDayOfMonth(prevMonthAny, { in: tz(TZ) }),   'yyyy-MM-dd', { in: tz(TZ) })
    return { start: ws, end: we, triggeredBy: 'cron-month-rollover', forceFinalize: true, reason: reason || 'monthly rollover' }
  }

  if (cron === NIGHTLY_CRON) {
    const today = parseISO(format(now, 'yyyy-MM-dd', { in: tz(TZ) }))
    const ws = format(subDays(today, 7), 'yyyy-MM-dd')
    const we = format(subDays(today, 1), 'yyyy-MM-dd')
    return { start: ws, end: we, triggeredBy: 'cron', forceFinalize: false, reason: reason || 'nightly cron' }
  }

  throw new Error(`Wiring error: unrecognized PULL_SCHEDULE_CRON value '${cron}'`)
}

async function main() {
  const window = resolveWindow(process.env)
  log.info('pull starting', { ...window })

  const w = await openWarehouse({ mode: 'write' })
  const pullRunId = await openPullRun(w, {
    triggeredBy: window.triggeredBy,
    windowStart: window.start,
    windowEnd: window.end,
    reason: window.reason,
  })

  const queues = {
    en: process.env.QUEUE_EN_MAIN!,
    fr: process.env.QUEUE_FR_MAIN!,
    aiEn: process.env.QUEUE_AI_OVERFLOW_EN!,
    aiFr: process.env.QUEUE_AI_OVERFLOW_FR!,
  }
  for (const [k, v] of Object.entries(queues)) {
    if (!v) throw new Error(`Missing env: queue ${k}`)
  }
  const queueIds = [queues.en, queues.fr, queues.aiEn, queues.aiFr]
  const trackedDnisNormalized = normalizeDnisList(process.env.TRACKED_DNIS ?? '')
  if (trackedDnisNormalized.length === 0) throw new Error('TRACKED_DNIS produced no valid normalized values')

  const pulledAt = new Date().toISOString()
  const stages: Record<number, boolean> = {}
  let cdrCount = 0, statsCount = 0, splitsCount = 0, logicalCount = 0, snapsCount = 0
  let errorSummary: string | undefined

  try {
    cdrCount = await loadCdrs(w, { pullRunId, pulledAt, window })
    await updatePullRunCounts(w, pullRunId, 'cdr_segments_count', cdrCount)
    stages[1] = true
  } catch (e: any) { errorSummary = `Stage 1 (CDRs): ${e.message}`; log.error(errorSummary); stages[1] = false }

  try {
    statsCount = await loadQueueStats(w, { pullRunId, pulledAt, window, queueIds })
    await updatePullRunCounts(w, pullRunId, 'queue_stats_count', statsCount)
    stages[2] = true
  } catch (e: any) { errorSummary = (errorSummary ?? '') + ` | Stage 2 (queue stats): ${e.message}`; log.error('Stage 2 failed', { e: e.message }); stages[2] = false }

  try {
    splitsCount = await loadQueueSplits(w, { pullRunId, pulledAt, window, queueIds })
    await updatePullRunCounts(w, pullRunId, 'splits_count', splitsCount)
    stages[3] = true
  } catch (e: any) { errorSummary = (errorSummary ?? '') + ` | Stage 3 (splits): ${e.message}`; log.error('Stage 3 failed', { e: e.message }); stages[3] = false }

  if (!(stages[1] && stages[2] && stages[3])) {
    log.warn('skipping Stages 4-5 due to fetch failure')
    await closePullRun(w, {
      pullRunId, status: 'partial_fetch',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      errorSummary,
    })
    await w.close()
    process.exit(1)
  }

  try {
    logicalCount = await buildLogicalCalls(w, { pullRunId, window, queues, trackedDnisNormalized })
    await updatePullRunCounts(w, pullRunId, 'logical_calls_built', logicalCount)
    stages[4] = true
  } catch (e: any) { errorSummary = `Stage 4 (logical): ${e.message}`; log.error(errorSummary); stages[4] = false }

  if (!stages[4]) {
    await closePullRun(w, {
      pullRunId, status: 'partial_build',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      logicalCallsBuilt: logicalCount, errorSummary,
    })
    await w.close(); process.exit(1)
  }

  try {
    snapsCount = await buildSnapshots(w, { pullRunId, window, forceFinalize: window.forceFinalize, queues })
    await updatePullRunCounts(w, pullRunId, 'snapshots_built', snapsCount)
    stages[5] = true
  } catch (e: any) { errorSummary = `Stage 5 (snapshots): ${e.message}`; log.error(errorSummary); stages[5] = false }

  if (!stages[5]) {
    await closePullRun(w, {
      pullRunId, status: 'partial_build',
      cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
      logicalCallsBuilt: logicalCount, snapshotsBuilt: snapsCount, errorSummary,
    })
    await w.close(); process.exit(1)
  }

  const finalizedMonth = window.triggeredBy === 'cron-month-rollover'
    ? window.start.slice(0, 7)
    : undefined

  await closePullRun(w, {
    pullRunId, status: 'success',
    cdrSegmentsCount: cdrCount, queueStatsCount: statsCount, splitsCount,
    logicalCallsBuilt: logicalCount, snapshotsBuilt: snapsCount,
    finalizedMonth,
    errorSummary: window.forceFinalize ? `forceFinalize override: ${window.reason}` : undefined,
  })
  log.info('pull complete', { pullRunId, cdrCount, statsCount, splitsCount, logicalCount, snapsCount })
  await w.close()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
