import { afterEach, beforeEach, expect, it } from 'vitest'
import { POST } from '@/app/api/admin/session/route'

const ORIGINAL_ENV = { ...process.env }

function makeFormRequest(token: string): Request {
  return new Request('http://localhost/api/admin/session', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
}

beforeEach(() => {
  process.env.ADMIN_PULL_TOKEN = 'admin-token'
  process.env.ADMIN_SESSION_SECRET = 'session-secret'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

it('sets an HttpOnly admin session cookie without putting the admin token in the cookie value', async () => {
  const res = await POST(makeFormRequest('admin-token'))

  expect(res.status).toBe(303)
  expect(res.headers.get('location')).toBe('/admin')
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('csh_admin_session=')
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie.toLowerCase()).toContain('samesite=strict')
  expect(setCookie).not.toContain('admin-token')
})

it('rejects a bad admin token without setting a session cookie', async () => {
  const res = await POST(makeFormRequest('wrong-token'))

  expect(res.status).toBe(401)
  expect(res.headers.get('set-cookie')).toBeNull()
})
