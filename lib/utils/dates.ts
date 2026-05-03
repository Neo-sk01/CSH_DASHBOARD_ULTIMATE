import { tz, TZDate } from '@date-fns/tz'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfISOWeek,
  endOfISOWeek,
  addDays,
  isAfter,
  parseISO,
  getDay,
} from 'date-fns'

const TZ = 'America/Toronto'

export type Period = 'daily' | 'weekly' | 'monthly'

export function resolvePeriodStart(period: Period, ref: Date): string {
  switch (period) {
    case 'daily':
      return format(ref, 'yyyy-MM-dd', { in: tz(TZ) })
    case 'weekly':
      return format(startOfISOWeek(ref, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
    case 'monthly':
      return format(startOfMonth(ref, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
  }
}

/**
 * Parse a YYYY-MM-DD string as a Toronto-local date (noon) so that
 * date-fns timezone-aware functions see the correct calendar date.
 */
function parseTZDate(dateStr: string): TZDate {
  return new TZDate(`${dateStr}T12:00:00`, TZ)
}

export function resolvePeriodEnd(period: Period, periodStart: string, includeWeekends: boolean): string {
  if (period === 'daily') return periodStart
  const start = parseTZDate(periodStart)
  if (period === 'monthly') {
    return format(endOfMonth(start, { in: tz(TZ) }), 'yyyy-MM-dd', { in: tz(TZ) })
  }
  // weekly
  const end = includeWeekends
    ? endOfISOWeek(start, { in: tz(TZ) })  // Sunday
    : addDays(start, 4)                     // Friday
  return format(end, 'yyyy-MM-dd', { in: tz(TZ) })
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  let cursor = parseISO(start)
  const last = parseISO(end)
  while (!isAfter(cursor, last)) {
    out.push(format(cursor, 'yyyy-MM-dd'))
    cursor = addDays(cursor, 1)
  }
  return out
}

export function eachBusinessDate(window: { start: string; end: string }): string[] {
  return eachDate(window.start, window.end).filter((d) => !isWeekend(d))
}

export function isWeekend(date: string): boolean {
  const dow = getDay(parseISO(date))
  return dow === 0 || dow === 6
}

export function toTorontoDate(isoTimestamp: string): string {
  return format(parseISO(isoTimestamp), 'yyyy-MM-dd', { in: tz(TZ) })
}

/**
 * Render a Date or ISO string as `YYYY-MM-DD HH:mm UTC` for operator-facing UI.
 * DuckDB returns Date objects for DATE/TIMESTAMP columns regardless of
 * the helper's TS return type, so callers may pass either shape.
 */
export function formatTimestamp(value: Date | string | null | undefined): string {
  if (value == null) return '(unknown)'
  const d = value instanceof Date ? value : parseISO(value)
  return `${format(d, 'yyyy-MM-dd HH:mm', { in: tz('UTC') })} UTC`
}

/**
 * Render a DATE-only value (Date or ISO string) as `YYYY-MM-DD`.
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (value == null) return '(none yet)'
  const d = value instanceof Date ? value : parseISO(value)
  return format(d, 'yyyy-MM-dd')
}
