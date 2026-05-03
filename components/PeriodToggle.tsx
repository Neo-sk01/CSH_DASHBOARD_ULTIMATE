import Link from 'next/link'
import type { Period } from '@/lib/utils/dates'

const PERIODS: Period[] = ['daily', 'weekly', 'monthly']

export function PeriodToggle({ current }: { current: Period }) {
  return (
    <div className="flex gap-2 text-sm">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`/?period=${p}`}
          className={p === current ? 'font-semibold underline' : 'text-slate-500'}
        >
          {p[0].toUpperCase() + p.slice(1)}
        </Link>
      ))}
    </div>
  )
}
