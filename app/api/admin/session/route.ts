import { NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionValue,
  verifyAdminToken,
} from '@/lib/admin/session'

async function readToken(req: Request): Promise<string> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null)
    return typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).token === 'string'
      ? String((body as Record<string, unknown>).token)
      : ''
  }

  const form = await req.formData().catch(() => null)
  const token = form?.get('token')
  return typeof token === 'string' ? token : ''
}

export async function POST(req: Request) {
  const token = await readToken(req)
  if (!verifyAdminToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const res = new NextResponse(null, { status: 303, headers: { Location: '/admin' } })
  res.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionValue(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/admin',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  })
  return res
}
