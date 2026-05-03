import Link from 'next/link'
import type { Period } from '@/lib/utils/dates'

const PERIODS: Period[] = ['daily', 'weekly', 'monthly']

export function PeriodToggle({ current, includeWeekends }: { current: Period; includeWeekends: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      {PERIODS.map((p) => {
        const params = new URLSearchParams({ period: p })
        if (includeWeekends) params.set('includeWeekends', 'true')
        const href = `/?${params.toString()}`
        const isActive = p === current
        return (
          <Link
            key={p}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'font-semibold underline' : 'text-slate-500'}
          >
            {p[0].toUpperCase() + p.slice(1)}
          </Link>
        )
      })}
    </div>
  )
}
