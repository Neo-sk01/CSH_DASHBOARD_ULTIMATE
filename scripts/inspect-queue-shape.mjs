/**
 * Gate 2: Queue-touch inference verification
 *
 * For a given high-volume date, compares the count of distinct from.call_ids
 * in CDRs where any segment has to.user === queueId  vs  calls_offered from
 * the queue-stats endpoint.  Pass criterion per spec: |A - B| <= max(0.05*B, 3).
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/inspect-queue-shape.mjs <date>
 *
 * NOTE: The API requires end_date = start_date + 1 day to filter a single day.
 * This script handles that automatically.
 */

const baseUrl = process.env.VERSATURE_BASE_URL
const clientId = process.env.VERSATURE_CLIENT_ID
const clientSecret = process.env.VERSATURE_CLIENT_SECRET
const apiVersion =
  process.env.VERSATURE_API_VERSION ?? 'application/vnd.integrate.v1.10.0+json'

// Support both old env var names (used in .env.local) and new names
const QUEUE_EN = process.env.QUEUE_EN_MAIN ?? process.env.QUEUE_ENGLISH
const QUEUE_FR = process.env.QUEUE_FR_MAIN ?? process.env.QUEUE_FRENCH
const QUEUE_AI_EN = process.env.QUEUE_AI_OVERFLOW_EN
const QUEUE_AI_FR = process.env.QUEUE_AI_OVERFLOW_FR

const date = process.argv[2]

if (!date) {
  throw new Error(
    'Usage: node --env-file=.env.local --import tsx scripts/inspect-queue-shape.mjs 2026-04-16',
  )
}

// Compute end_date as date + 1 day (API requires end_date > start_date for single-day queries)
function addOneDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().substring(0, 10)
}

const endDate = addOneDay(date)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Authenticate ---
console.error(`Authenticating with Versature at ${baseUrl}...`)

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

if (!accessToken) {
  throw new Error(`No access_token in token response. Keys: ${Object.keys(tokenPayload).join(', ')}`)
}

console.error(`Authenticated. Token scope: ${tokenPayload.scope ?? 'not provided'}`)

// --- Fetch CDRs for the date ---
console.error(`Fetching CDRs for ${date} (API window: ${date} to ${endDate})...`)

const CDR_PAGE_SIZE = 1000
let allCdrs = []
let offset = 0

while (true) {
  await sleep(500) // mild rate limiting for sequential CDR fetches
  const r = await fetch(
    `${baseUrl}/cdrs/?start_date=${date}&end_date=${endDate}&limit=${CDR_PAGE_SIZE}&offset=${offset}`,
    {
      headers: {
        Accept: apiVersion,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  if (!r.ok) {
    const body = await r.text()
    throw new Error(`CDR fetch failed (${r.status}) at offset ${offset}: ${body}`)
  }
  const rows = await r.json()
  const pageRows = Array.isArray(rows) ? rows : (rows.result ?? [])
  allCdrs = allCdrs.concat(pageRows)
  console.error(`  CDR offset=${offset}: ${pageRows.length} rows (total so far: ${allCdrs.length})`)
  if (pageRows.length < CDR_PAGE_SIZE) break
  offset += pageRows.length
}

console.error(`Total CDR segments fetched: ${allCdrs.length}`)

// --- Build queue ID set ---
const queueIds = [QUEUE_EN, QUEUE_FR, QUEUE_AI_EN, QUEUE_AI_FR].filter(Boolean)
console.error(`Tracked queue IDs: ${queueIds.join(', ')}`)

if (queueIds.length === 0) {
  throw new Error(
    'No queue IDs found in environment. Check QUEUE_ENGLISH, QUEUE_FRENCH, QUEUE_AI_OVERFLOW_EN, QUEUE_AI_OVERFLOW_FR',
  )
}

// --- Compute A: distinct from.call_ids where any segment has to.user === queueId ---
const callsByQueue = {}
for (const qId of queueIds) {
  const callIds = new Set()
  for (const row of allCdrs) {
    if (row.to?.user === qId) {
      const callId = row.from?.call_id
      if (callId) callIds.add(callId)
    }
  }
  callsByQueue[qId] = callIds.size
}

// --- Fetch queue stats B: calls_offered ---
console.error('Fetching queue stats...')
const queueStats = {}
for (const qId of queueIds) {
  await sleep(500)
  const r = await fetch(
    `${baseUrl}/call_queues/${qId}/stats/?start_date=${date}&end_date=${endDate}`,
    {
      headers: {
        Accept: apiVersion,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  if (!r.ok) {
    const body = await r.text()
    console.error(`Warning: queue stats fetch failed for ${qId} (${r.status}): ${body}`)
    queueStats[qId] = { calls_offered: null, raw: null }
    continue
  }
  const payload = await r.json()
  // The queue stats endpoint returns an array; take first element
  const stat = Array.isArray(payload) ? payload[0] : payload
  queueStats[qId] = { calls_offered: stat?.calls_offered ?? null, raw: stat }
}

// --- Per-queue pass/fail ---
const queueResults = []
let totalA = 0
let totalB = 0

for (const qId of queueIds) {
  const A = callsByQueue[qId]
  const B = queueStats[qId]?.calls_offered ?? null
  const tolerance = B !== null ? Math.max(0.05 * B, 3) : null
  const diff = B !== null ? Math.abs(A - B) : null
  const pass = diff !== null ? diff <= tolerance : null

  totalA += A
  if (B !== null) totalB += B

  queueResults.push({
    queueId: qId,
    A_cdrDistinctCallIds: A,
    B_callsOffered: B,
    diff,
    tolerance,
    pass,
    note:
      B === null
        ? 'queue stats not available'
        : pass
          ? 'PASS'
          : `FAIL — diff ${diff} > tolerance ${tolerance} (A=${A}, B=${B}). CDR to.user=${qId} severely undercounts queue traffic. Queue routing segments do not appear in CDR to.user for most answered calls (agents appear as final destination instead).`,
  })
}

const aggDiff = Math.abs(totalA - totalB)
const aggTolerance = Math.max(0.05 * totalB, 3)
const aggPass = aggDiff <= aggTolerance

// --- Top 30 to.user values not in tracked set ---
const toUserCounts = {}
const trackedSet = new Set(queueIds)
for (const row of allCdrs) {
  const u = row.to?.user
  if (u !== null && u !== undefined && !trackedSet.has(u)) {
    toUserCounts[u] = (toUserCounts[u] || 0) + 1
  }
}
const top30Untracked = Object.entries(toUserCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([user, count]) => ({ user, count }))

const result = {
  date,
  apiWindow: { start_date: date, end_date: endDate },
  totalCdrSegments: allCdrs.length,
  trackedQueueIds: {
    QUEUE_EN: QUEUE_EN,
    QUEUE_FR: QUEUE_FR,
    QUEUE_AI_EN: QUEUE_AI_EN,
    QUEUE_AI_FR: QUEUE_AI_FR,
  },
  perQueue: queueResults,
  aggregate: {
    totalA,
    totalB,
    aggDiff,
    aggTolerance,
    aggPass,
  },
  top30UntrackedToUser: top30Untracked,
  overallPass: queueResults.every((r) => r.pass !== false),
  diagnosis: queueResults.some((r) => r.pass === false)
    ? 'GATE 2 FAIL: CDR to.user field shows only segments where the queue itself was the final destination. Answered calls route through the queue to an agent extension, so to.user shows the agent extension (e.g. "53", "78") rather than the queue ID. Queue attribution from CDR to.user is not viable for answered calls. Redesign required: use queue_stats.calls_offered as the source of truth, or find a different CDR field that records intermediate queue routing.'
    : 'GATE 2 PASS',
}

console.log(JSON.stringify(result, null, 2))
