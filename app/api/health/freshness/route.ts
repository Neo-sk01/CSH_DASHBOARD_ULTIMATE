import { NextResponse } from 'next/server'
import { differenceInHours, parseISO } from 'date-fns'
import { getLatestSuccessfulPull } from '@/lib/warehouse/snapshots'

export const dynamic = 'force-dynamic'

const DEFAULT_MAX_AGE_HOURS = 36

function maxAgeHours(): number {
  const env = process.env.FRESHNESS_MAX_AGE_HOURS
  if (!env) return DEFAULT_MAX_AGE_HOURS
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_HOURS
}

export async function GET() {
  const now = new Date()
  const checkedAt = now.toISOString()
  const maxAge = maxAgeHours()
  const pull = await getLatestSuccessfulPull()

  const finishedAt = pull?.finished_at ?? null
  if (!pull || !finishedAt) {
    return NextResponse.json(
      {
        ok: false,
        last_pull_at: null,
        age_hours: null,
        max_age_hours: maxAge,
        checked_at: checkedAt,
        reason: 'no successful pull recorded',
      },
      { status: 503 },
    )
  }

  const finishedDate = finishedAt instanceof Date ? finishedAt : parseISO(finishedAt)
  const ageHours = differenceInHours(now, finishedDate)
  const ok = ageHours <= maxAge

  return NextResponse.json(
    {
      ok,
      last_pull_at: typeof finishedAt === 'string' ? finishedAt : finishedDate.toISOString(),
      age_hours: ageHours,
      max_age_hours: maxAge,
      checked_at: checkedAt,
      ...(ok ? {} : { reason: `last successful pull is ${ageHours}h old (SLO: ${maxAge}h)` }),
    },
    { status: ok ? 200 : 503 },
  )
}
