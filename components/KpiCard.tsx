export function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
