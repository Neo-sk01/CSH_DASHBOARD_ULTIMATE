import { createHmac, timingSafeEqual } from 'node:crypto'

export const ADMIN_SESSION_COOKIE = 'csh_admin_session'
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_DASHBOARD_TOKEN || process.env.ADMIN_PULL_TOKEN || ''
}

function sign(payload: string): string {
  const secret = sessionSecret()
  if (!secret) return ''
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function verifyAdminToken(token: string): boolean {
  const expected = process.env.ADMIN_DASHBOARD_TOKEN || process.env.ADMIN_PULL_TOKEN || ''
  return expected !== '' && safeEqual(token, expected)
}

export function createAdminSessionValue(nowMs = Date.now()): string {
  const expiresAt = Math.floor(nowMs / 1000) + ADMIN_SESSION_TTL_SECONDS
  const payload = String(expiresAt)
  return `${payload}.${sign(payload)}`
}

export function isValidAdminSessionValue(value: string | undefined, nowMs = Date.now()): boolean {
  if (!value) return false
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return false

  const expiresAt = Number(payload)
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(nowMs / 1000)) return false

  const expected = sign(payload)
  return expected !== '' && safeEqual(signature, expected)
}
