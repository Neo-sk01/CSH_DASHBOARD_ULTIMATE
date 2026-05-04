import { NextResponse } from 'next/server'
import { parseISO, isAfter, isValid, differenceInDays } from 'date-fns'

const MAX_WINDOW_DAYS = 90
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface ValidatedBody {
  windowStart: string
  windowEnd: string
  reason: string
  forceFinalize: boolean
}

function validateBody(body: unknown): { ok: true; value: ValidatedBody } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'request body must be a JSON object' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.windowStart !== 'string' || !DATE_RE.test(b.windowStart) || !isValid(parseISO(b.windowStart))) {
    return { ok: false, error: 'windowStart must be a valid YYYY-MM-DD date string' }
  }
  if (typeof b.windowEnd !== 'string' || !DATE_RE.test(b.windowEnd) || !isValid(parseISO(b.windowEnd))) {
    return { ok: false, error: 'windowEnd must be a valid YYYY-MM-DD date string' }
  }
  if (b.forceFinalize !== undefined && b.forceFinalize !== true && b.forceFinalize !== false) {
    return { ok: false, error: 'forceFinalize must be a real boolean (true or false), not a string or number' }
  }
  if (b.reason !== undefined && typeof b.reason !== 'string') {
    return { ok: false, error: 'reason must be a string when provided' }
  }

  return {
    ok: true,
    value: {
      windowStart: b.windowStart,
      windowEnd: b.windowEnd,
      reason: typeof b.reason === 'string' ? b.reason : 'admin',
      forceFinalize: b.forceFinalize === true,
    },
  }
}

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

  const raw = await req.json().catch(() => null)
  const validated = validateBody(raw)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }
  const { windowStart, windowEnd, reason, forceFinalize } = validated.value

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
      client_payload: { windowStart, windowEnd, reason, forceFinalize },
    }),
  })

  if (!dispatchRes.ok) {
    const txt = await dispatchRes.text()
    return NextResponse.json({ error: 'GitHub dispatch failed', detail: txt }, { status: 502 })
  }

  return NextResponse.json({ status: 'queued', windowStart, windowEnd, forceFinalize })
}
