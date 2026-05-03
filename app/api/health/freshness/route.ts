import { NextResponse } from 'next/server'
import { differenceInHours, parseISO } from 'date-fns'
import { getMostRecentFinalizedDay } from '@/lib/warehouse/snapshots'
import { formatDate } from '@/lib/utils/dates'

export const dynamic = 'force-dynamic'

export async function GET() {
  const finalized = await getMostRecentFinalizedDay()
  if (!finalized) {
    return NextResponse.json({ mostRecentFinalizedDay: null, age_hours: null })
  }
  const dateStr = formatDate(finalized)
  const ageHours = differenceInHours(new Date(), parseISO(`${dateStr}T00:00:00Z`))
  return NextResponse.json({ mostRecentFinalizedDay: dateStr, age_hours: ageHours })
}
