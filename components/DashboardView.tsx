import type { SnapshotRow } from '@/lib/warehouse/client'
import type { Period } from '@/lib/utils/dates'
import { KpiCard } from './KpiCard'
import { PeriodToggle } from './PeriodToggle'
import { WeekendToggle } from './WeekendToggle'

export function DashboardView({
  snapshot, period, includeWeekends, latestPullAt,
}: {
  snapshot: SnapshotRow
  period: Period
  includeWeekends: boolean
  latestPullAt: string | null
}) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CSH Call Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">
            Showing snapshot for {snapshot.period_start} ({snapshot.is_finalized ? 'finalized' : 'provisional'})
            {' · '} pulled {latestPullAt ?? '(unknown)'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PeriodToggle current={period} />
          <WeekendToggle current={includeWeekends} />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <KpiCard label="Total Incoming"   value={snapshot.total_incoming} />
        <KpiCard label="English"          value={snapshot.english_calls} />
        <KpiCard label="French"           value={snapshot.french_calls} />
        <KpiCard label="AI"               value={snapshot.ai_calls} />
        <KpiCard label="AI Overflow"      value={snapshot.ai_overflow_calls} />
      </section>
    </main>
  )
}
