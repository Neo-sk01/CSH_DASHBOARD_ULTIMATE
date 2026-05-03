/**
 * Gate 4: from_call_id uniqueness over 30 days
 *
 * Checks whether the same from.call_id appears across multiple calendar dates.
 * Schema PK assumption: each from.call_id belongs to exactly one call_date.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/check-call-id-uniqueness.mjs
 *
 * Saves all fetched CDRs to /tmp/cdr-30day-raw.json for reuse by other scripts.
 * Outputs JSON to stdout.
 *
 * NOTE: The CDR API requires end_date = start_date + 1 day for single-day queries.
 * Timestamps in CDR are UTC; this script converts to Toronto local date for call_date.
 */

import fs from 'node:fs/promises'

const baseUrl = process.env.VERSATURE_BASE_URL
const clientId = process.env.VERSATURE_CLIENT_ID
const clientSecret = process.env.VERSATURE_CLIENT_SECRET
const apiVersion =
  process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.10.0+json'

const TORONTO_TZ = 'America/Toronto'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().substring(0, 10)
}

function toTorontoDate(isoTimestamp) {
  // Convert a UTC ISO timestamp string to Toronto local YYYY-MM-DD
  const d = new Date(isoTimestamp)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year').value
  const m = parts.find((p) => p.type === 'month').value
  const day = parts.find((p) => p.type === 'day').value
  return `${y}-${m}-${day}`
}

// Build 30 most recent calendar dates ending today (2026-05-03)
// Dates in descending order: 2026-05-03, 2026-05-02, ..., 2026-04-04
const TODAY = '2026-05-03'
const dates = []
{
  const base = new Date(TODAY + 'T00:00:00Z')
  for (let i = 0; i < 30; i++) {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(d.toISOString().substring(0, 10))
  }
}

console.error(`Authenticating with Versature...`)

const tokenResponse = await fetch(`${baseUrl}/oauth/token/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }),
})
if (!tokenResponse.ok) {
  const body = await tokenResponse.text()
  throw new Error(`OAuth token request failed (${tokenResponse.status}): ${body}`)
}
const tokenPayload = await tokenResponse.json()
const accessToken = tokenPayload.access_token
console.error(`Authenticated. Fetching CDRs for 30 days (${dates[29]} to ${dates[0]})...`)

const CDR_PAGE_SIZE = 1000
let allCdrs = []
let totalPages = 0
let totalApiRequests = 0

for (const date of dates) {
  const endDate = addOneDay(date)
  let offset = 0
  let pageCount = 0

  while (true) {
    await sleep(600) // ~100 req/min ceiling, well below 12/min CDR limit per rate-limiter
    const r = await fetch(
      `${baseUrl}/cdrs/?start_date=${date}&end_date=${endDate}&limit=${CDR_PAGE_SIZE}&offset=${offset}`,
      {
        headers: {
          Accept: apiVersion,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )
    totalApiRequests++

    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after') ?? 30)
      const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000
      console.error(`  429 rate limit on ${date}, waiting ${waitMs}ms...`)
      await sleep(waitMs)
      continue
    }

    if (!r.ok) {
      const body = await r.text()
      throw new Error(`CDR fetch failed for ${date} (${r.status}): ${body}`)
    }

    const payload = await r.json()
    const pageRows = Array.isArray(payload) ? payload : (payload.result ?? [])
    allCdrs = allCdrs.concat(pageRows)
    pageCount++
    totalPages++

    if (pageRows.length < CDR_PAGE_SIZE) {
      console.error(`  ${date}: ${offset + pageRows.length} rows (${pageCount} pages)`)
      break
    }
    offset += pageRows.length
  }
}

console.error(`Total CDR segments: ${allCdrs.length} (${totalApiRequests} API requests, ${totalPages} pages)`)

// Save raw CDRs for reuse by other scripts
const RAW_CDR_FILE = '/tmp/cdr-30day-raw.json'
await fs.writeFile(RAW_CDR_FILE, JSON.stringify(allCdrs))
console.error(`Raw CDRs saved to ${RAW_CDR_FILE}`)

// Compute call_date for each segment using Toronto timezone
// Accumulate Map<from.call_id, Set<call_date>>
const callIdDates = new Map()

for (const row of allCdrs) {
  const callId = row.from?.call_id
  if (!callId) continue
  const callDate = toTorontoDate(row.start_time)
  const existing = callIdDates.get(callId)
  if (!existing) {
    callIdDates.set(callId, new Set([callDate]))
  } else {
    existing.add(callDate)
  }
}

// Find duplicates (Set size > 1)
const duplicates = []
for (const [callId, dateSet] of callIdDates.entries()) {
  if (dateSet.size > 1) {
    duplicates.push({ callId, dates: [...dateSet].sort() })
  }
}

const duplicateCount = duplicates.length
const sample = duplicates.slice(0, 20)

// Classify duplicates (attempt to categorize)
let timezoneSpillover = 0
let paginationDuplication = 0
let trueCrossDateReuse = 0

for (const dup of duplicates) {
  // Timezone spillover: dates are consecutive and differ by 1 day
  const sortedDates = dup.dates.slice().sort()
  const isConsecutive = sortedDates.every((d, i) => {
    if (i === 0) return true
    const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z')
    const curr = new Date(d + 'T00:00:00Z')
    return (curr - prev) / 86400000 === 1
  })
  if (isConsecutive) {
    timezoneSpillover++
  } else {
    trueCrossDateReuse++
  }
}

const result = {
  dateRange: { start: dates[29], end: dates[0] },
  totalDates: dates.length,
  totalCdrSegments: allCdrs.length,
  totalApiRequests,
  totalPages,
  distinctCallIds: callIdDates.size,
  duplicateCount,
  duplicateBreakdown: {
    timezoneSpillover,
    paginationDuplication,
    trueCrossDateReuse,
    note: 'timezoneSpillover = dates are consecutive (likely midnight-boundary CDR recorded in UTC vs. Toronto local); trueCrossDateReuse = same call_id on non-consecutive dates',
  },
  first20Duplicates: sample,
  verdict:
    duplicateCount === 0
      ? 'PASS: all from.call_ids are unique per call_date over 30 days'
      : `INVESTIGATE: ${duplicateCount} from.call_ids span multiple dates. See breakdown and sample. Spec says: if duplicates exist, do NOT change schema PK — diagnose first.`,
}

console.log(JSON.stringify(result, null, 2))
