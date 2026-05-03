import { formatDate, formatTimestamp, type Period } from '@/lib/utils/dates'

export function NotDownloadedYet({
  period, periodStart, latestPullAt, finalizedDay,
}: {
  period: Period
  periodStart: string
  latestPullAt: Date | string | null
  finalizedDay: Date | string | null
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-8">
        <h1 className="text-xl font-semibold">Data not downloaded yet</h1>
        <p className="mt-2 text-slate-600">
          We don&apos;t have a snapshot for <strong>{period}</strong> {periodStart} yet.
          The next nightly pull runs at 08:00 UTC (≈03:00–04:00 ET, depending on DST).
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-600">Last successful pull</dt>
          <dd>{formatTimestamp(latestPullAt)}</dd>
          <dt className="text-slate-600">Most recent finalized day</dt>
          <dd>{formatDate(finalizedDay)}</dd>
        </dl>
      </div>
    </main>
  )
}
