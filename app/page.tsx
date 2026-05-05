import {
  getSnapshot,
  getLatestSuccessfulPull,
  getMostRecentFinalizedDay,
  getMostRecentSnapshotPeriodStart,
} from '@/lib/warehouse/snapshots'
import { resolvePeriodStart, formatDate, type Period } from '@/lib/utils/dates'
import { DashboardView } from '@/components/DashboardView'
import { NotDownloadedYet } from '@/components/NotDownloadedYet'

export const dynamic = 'force-dynamic'

const VALID_PERIODS = new Set<Period>(['daily', 'weekly', 'monthly'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface PageProps {
  searchParams: Promise<{ period?: string; includeWeekends?: string; periodStart?: string }>
}

export default async function Page({ searchParams }: PageProps) {
  const { period: periodParam, includeWeekends: incParam, periodStart: periodStartParam } = await searchParams
  const period: Period = VALID_PERIODS.has(periodParam as Period) ? (periodParam as Period) : 'daily'
  const includeWeekends = incParam === 'true'

  // Resolve periodStart in priority order:
  //   1. valid `periodStart` query param (operator inspecting a historical period)
  //   2. most recent kpi_snapshots row matching period + includeWeekends
  //   3. fall back to today (NotDownloadedYet will render the empty state)
  let periodStart: string
  if (periodStartParam && DATE_RE.test(periodStartParam)) {
    periodStart = resolvePeriodStart(period, new Date(`${periodStartParam}T12:00:00`))
  } else {
    const latest = await getMostRecentSnapshotPeriodStart({ period, includeWeekends })
    periodStart = latest != null
      ? formatDate(latest)
      : resolvePeriodStart(period, new Date())
  }

  const [snapshot, latestPull, finalizedDay] = await Promise.all([
    getSnapshot({ period, periodStart, includeWeekends }),
    getLatestSuccessfulPull(),
    getMostRecentFinalizedDay(),
  ])

  if (!snapshot) {
    return (
      <NotDownloadedYet
        period={period}
        periodStart={periodStart}
        latestPullAt={latestPull?.finished_at ?? null}
        finalizedDay={finalizedDay}
      />
    )
  }

  return (
    <DashboardView
      snapshot={snapshot}
      period={period}
      includeWeekends={includeWeekends}
    />
  )
}
