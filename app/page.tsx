import { getSnapshot, getLatestSuccessfulPull, getMostRecentFinalizedDay } from '@/lib/warehouse/snapshots'
import { resolvePeriodStart, type Period } from '@/lib/utils/dates'
import { DashboardView } from '@/components/DashboardView'
import { NotDownloadedYet } from '@/components/NotDownloadedYet'

export const dynamic = 'force-dynamic'

const VALID_PERIODS = new Set<Period>(['daily', 'weekly', 'monthly'])

interface PageProps {
  searchParams: Promise<{ period?: string; includeWeekends?: string }>
}

export default async function Page({ searchParams }: PageProps) {
  const { period: periodParam, includeWeekends: incParam } = await searchParams
  const period: Period = VALID_PERIODS.has(periodParam as Period) ? (periodParam as Period) : 'daily'
  const includeWeekends = incParam === 'true'

  const periodStart = resolvePeriodStart(period, new Date())
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
      latestPullAt={latestPull?.finished_at ?? null}
    />
  )
}
