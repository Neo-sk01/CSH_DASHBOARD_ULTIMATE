import { getRecentPullRuns } from '@/lib/warehouse/snapshots'
import { formatDate } from '@/lib/utils/dates'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function AdminPage({ searchParams }: Props) {
  const { token } = await searchParams
  if (!token || token !== process.env.ADMIN_PULL_TOKEN) {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-4 text-sm text-slate-600">Append <code>?token=YOUR_ADMIN_PULL_TOKEN</code> to access.</p>
      </main>
    )
  }

  const runs = await getRecentPullRuns(20)

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Admin · Pull Operations</h1>

      <h2 className="mt-8 text-lg font-semibold">Recent pull runs</h2>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="border-b text-left text-slate-500">
          <th className="py-2">Run ID</th><th>Status</th><th>Window</th><th>Trigger</th><th>Counts</th>
        </tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.pull_run_id} className="border-b">
              <td className="py-2 font-mono text-xs">{r.pull_run_id.slice(-8)}</td>
              <td>{r.status}</td>
              <td>{formatDate(r.window_start)} → {formatDate(r.window_end)}</td>
              <td>{r.triggered_by}</td>
              <td className="text-xs">cdr={r.cdr_segments_count} / lc={r.logical_calls_built} / snap={r.snapshots_built}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 text-lg font-semibold">Rebuild a period</h2>
      <p className="mt-2 text-sm text-slate-600">
        Submit via the admin pull route. Use the <code>/api/admin/pull</code> endpoint with a Bearer token (90-day cap).
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-slate-100 p-3 text-xs">{`curl -X POST https://YOUR_DASHBOARD_HOST/api/admin/pull \\
  -H "Authorization: Bearer $ADMIN_PULL_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"windowStart":"2026-04-01","windowEnd":"2026-04-30","reason":"backfill","forceFinalize":false}'`}</pre>
    </main>
  )
}
