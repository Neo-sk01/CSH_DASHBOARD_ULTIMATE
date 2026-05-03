import Link from 'next/link'
import type { Period } from '@/lib/utils/dates'

export function WeekendToggle({ current, period }: { current: boolean; period: Period }) {
  const params = new URLSearchParams({ period })
  if (!current) params.set('includeWeekends', 'true')
  const href = `/?${params.toString()}`
  return (
    <Link
      href={href}
      role="switch"
      aria-checked={current}
      className="text-xs text-slate-600"
    >
      Include weekends: {current ? 'on' : 'off'}
    </Link>
  )
}
