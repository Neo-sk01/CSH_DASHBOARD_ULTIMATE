/**
 * Gate 3: Splits rate calibration
 *
 * Issues 30 sequential GETs to /call_queues/8020/reports/splits/ in a 60-second
 * window with no artificial delays.  Captures status codes and Retry-After headers.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/probe-splits-rate.mjs <date>
 *
 * NOTE: The API requires end_date = start_date + 1 day for single-day queries.
 *
 * Decision rule (per spec):
 *   - 0 of 30 returned 429 → safe to raise queue_splits.perMinute to 24
 *   - first 429 at request N where N ≤ 12 → lower budget below N
 *   - first 429 at 13 ≤ N ≤ 30 → keep 12/min
 */

const baseUrl = process.env.VERSATURE_BASE_URL
const clientId = process.env.VERSATURE_CLIENT_ID
const clientSecret = process.env.VERSATURE_CLIENT_SECRET
const apiVersion =
  process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.10.0+json'

const date = process.argv[2] ?? '2026-04-16'

function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().substring(0, 10)
}
const endDate = addOneDay(date)

// Use QUEUE_ENGLISH as the target queue for probe (same as spec: 8020)
const QUEUE_EN = process.env.QUEUE_EN_MAIN ?? process.env.QUEUE_ENGLISH ?? '8020'

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
console.error(`Authenticated. Starting 30-request probe for queue ${QUEUE_EN}...`)

const totalRequests = 30
const statuses = []
let status429Count = 0
let firstRetryAfterAt = null
let firstRetryAfterValue = null
const windowStart = Date.now()

for (let i = 1; i <= totalRequests; i++) {
  const reqStart = Date.now()
  const r = await fetch(
    `${baseUrl}/call_queues/${QUEUE_EN}/reports/splits/?start_date=${date}&end_date=${endDate}&period=day`,
    {
      headers: {
        Accept: apiVersion,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  const elapsed = Date.now() - windowStart
  const retryAfter = r.headers.get('retry-after')
  const status = r.status

  statuses.push({
    requestN: i,
    status,
    elapsedMs: elapsed,
    retryAfter: retryAfter ?? null,
  })

  if (status === 429) {
    status429Count++
    if (firstRetryAfterAt === null) {
      firstRetryAfterAt = i
      firstRetryAfterValue = retryAfter
    }
    console.error(`  Request ${i}: 429 at ${elapsed}ms elapsed, Retry-After=${retryAfter}`)
  } else {
    console.error(`  Request ${i}: ${status} at ${elapsed}ms elapsed`)
  }

  // Consume the body to avoid connection leaks
  await r.text()
}

const windowEnd = Date.now()
const windowDurationMs = windowEnd - windowStart

// Determine decision
let decision
let ceiling
if (status429Count === 0) {
  decision = 'No 429s observed in 30 requests within 60s. Safe to raise queue_splits.perMinute to 24.'
  ceiling = '>30/min'
} else if (firstRetryAfterAt !== null && firstRetryAfterAt <= 12) {
  decision = `First 429 at request N=${firstRetryAfterAt} (≤12). Lower budget to ${firstRetryAfterAt - 1}/min.`
  ceiling = `~${firstRetryAfterAt - 1}/min`
} else {
  decision = `First 429 at request N=${firstRetryAfterAt} (13≤N≤30). Keep conservative 12/min budget.`
  ceiling = `~${firstRetryAfterAt}/min`
}

const result = {
  date,
  apiWindow: { start_date: date, end_date: endDate },
  probeQueueId: QUEUE_EN,
  totalRequests,
  windowDurationMs,
  status429Count,
  firstRetryAfterAt,
  firstRetryAfterValue,
  ceiling,
  decision,
  statuses,
}

console.log(JSON.stringify(result, null, 2))
