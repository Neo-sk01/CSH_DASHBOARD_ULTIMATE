import { NextResponse } from 'next/server'
import { parseISO, isAfter, differenceInDays } from 'date-fns'

const MAX_WINDOW_DAYS = 90

export async function POST(req: Request) {
  const adminToken = process.env.ADMIN_PULL_TOKEN
  const ghToken = process.env.GH_DISPATCH_TOKEN
  const ghRepo = process.env.GH_REPO
  if (!adminToken || !ghToken || !ghRepo) {
    return NextResponse.json({ error: 'admin pull route not configured' }, { status: 500 })
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${adminToken}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { windowStart, windowEnd, reason, forceFinalize } = body as {
    windowStart?: string
    windowEnd?: string
    reason?: string
    forceFinalize?: boolean
  }
  if (!windowStart || !windowEnd) {
    return NextResponse.json({ error: 'windowStart and windowEnd are required' }, { status: 400 })
  }
  const start = parseISO(windowStart)
  const end = parseISO(windowEnd)
  if (isAfter(start, end)) {
    return NextResponse.json({ error: 'windowStart must be <= windowEnd' }, { status: 400 })
  }
  if (isAfter(end, new Date())) {
    return NextResponse.json({ error: 'window cannot include future dates' }, { status: 400 })
  }
  if (differenceInDays(end, start) + 1 > MAX_WINDOW_DAYS) {
    return NextResponse.json({ error: `window exceeds ${MAX_WINDOW_DAYS} days` }, { status: 400 })
  }

  const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'admin-pull',
      client_payload: { windowStart, windowEnd, reason: reason ?? 'admin', forceFinalize: Boolean(forceFinalize) },
    }),
  })

  if (!dispatchRes.ok) {
    const txt = await dispatchRes.text()
    return NextResponse.json({ error: 'GitHub dispatch failed', detail: txt }, { status: 502 })
  }

  return NextResponse.json({ status: 'queued', windowStart, windowEnd, forceFinalize: Boolean(forceFinalize) })
}
