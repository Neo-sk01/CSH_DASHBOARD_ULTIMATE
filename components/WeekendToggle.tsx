import Link from 'next/link'

export function WeekendToggle({ current }: { current: boolean }) {
  return (
    <Link
      href={current ? '/?includeWeekends=false' : '/?includeWeekends=true'}
      className="text-xs text-slate-500"
    >
      Include weekends: {current ? 'on' : 'off'}
    </Link>
  )
}
