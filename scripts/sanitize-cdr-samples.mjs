/**
 * Sanitize CDR samples for use as test fixtures.
 *
 * Reads raw CDR JSON from a file argument (or stdin with -).
 * Selects 50-100 segments across ~25 distinct from.call_ids with mixed routing.
 * Applies the redaction policy from the spec (section "Fixture privacy").
 * Outputs NDJSON to stdout.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/sanitize-cdr-samples.mjs <raw-cdr-file>
 *   node --env-file=.env.local --import tsx scripts/sanitize-cdr-samples.mjs <raw-cdr-file> > tests/fixtures/real-cdr-samples.ndjson
 */

import fs from 'node:fs/promises'
import crypto from 'node:crypto'

const rawFile = process.argv[2]
if (!rawFile) {
  throw new Error('Usage: node --env-file=.env.local --import tsx scripts/sanitize-cdr-samples.mjs <raw-cdr-file>')
}

// Queue IDs (preserve exact to.user values)
const QUEUE_EN = process.env.QUEUE_EN_MAIN ?? process.env.QUEUE_ENGLISH ?? '8020'
const QUEUE_FR = process.env.QUEUE_FR_MAIN ?? process.env.QUEUE_FRENCH ?? '8021'
const QUEUE_AI_EN = process.env.QUEUE_AI_OVERFLOW_EN ?? '8030'
const QUEUE_AI_FR = process.env.QUEUE_AI_OVERFLOW_FR ?? '8031'
const TRACKED_QUEUES = new Set([QUEUE_EN, QUEUE_FR, QUEUE_AI_EN, QUEUE_AI_FR])

// Tracked DNIS values — preserve as-is
const DNIS_PRIMARY = process.env.DNIS_PRIMARY ?? '16135949199'
const DNIS_SECONDARY = process.env.DNIS_SECONDARY ?? '6135949199'
const TRACKED_DNIS_NORMALIZED = new Set()

function normalizeDnis(input) {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

// Build set of normalized tracked DNIS
for (const raw of [DNIS_PRIMARY, DNIS_SECONDARY]) {
  const n = normalizeDnis(raw)
  if (n) TRACKED_DNIS_NORMALIZED.add(n)
}

// Deterministic phone pool: +15555550100..+15555550199
const PHONE_POOL_SIZE = 100
const PHONE_POOL_BASE = 15555550100n

// Deterministic mapping: sha256(input) -> slot in pool
const phoneMap = new Map()
function redactPhone(value) {
  if (!value) return value
  // Check if it's a tracked DNIS
  const normalized = normalizeDnis(value)
  if (normalized && TRACKED_DNIS_NORMALIZED.has(normalized)) {
    // Preserve the original form
    return value
  }
  // Check if it's a SIP or internal value
  if (value.startsWith('sip:') || /^\d{1,9}$/.test(value)) {
    return value // preserve short extensions, queue IDs, SIP
  }
  // External phone number — deterministic replacement
  if (phoneMap.has(value)) return phoneMap.get(value)
  const slot = Number(BigInt('0x' + crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)) % BigInt(PHONE_POOL_SIZE))
  const replacement = '+' + (PHONE_POOL_BASE + BigInt(slot)).toString()
  phoneMap.set(value, replacement)
  return replacement
}

// Deterministic call_id replacement
const callIdMap = new Map()
function redactCallId(value) {
  if (!value) return value
  if (callIdMap.has(value)) return callIdMap.get(value)
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)
  const replacement = `sbc-syn-${hex}`
  callIdMap.set(value, replacement)
  return replacement
}

// Read raw CDR data
console.error(`Reading raw CDR data from ${rawFile}...`)
const rawData = await fs.readFile(rawFile, 'utf8')
let allRows = JSON.parse(rawData)
if (!Array.isArray(allRows)) {
  // Handle nested format
  allRows = allRows.result ?? Object.values(allRows).find(Array.isArray) ?? []
}
console.error(`Total rows in raw file: ${allRows.length}`)

// Select 50-100 segments across ~25 distinct from.call_ids with routing diversity
// Categorize rows by routing pattern
const tracked_queue_rows = allRows.filter(r => TRACKED_QUEUES.has(r.to?.user))
const abandoned_rows = allRows.filter(r => !r.answer_time && !TRACKED_QUEUES.has(r.to?.user))
const answered_rows = allRows.filter(r => r.answer_time && !TRACKED_QUEUES.has(r.to?.user))

console.error(`Routing breakdown: tracked_queue=${tracked_queue_rows.length}, abandoned=${abandoned_rows.length}, answered=${answered_rows.length}`)

// Find multi-segment calls (from.call_id appears more than once)
const callIdCount = {}
for (const row of allRows) {
  const id = row.from?.call_id
  if (id) callIdCount[id] = (callIdCount[id] || 0) + 1
}
const multiSegmentCallIds = new Set(Object.entries(callIdCount).filter(([, c]) => c > 1).map(([id]) => id))

// Select ~25 diverse from.call_ids
const selectedCallIds = new Set()

// Priority 1: multi-segment calls touching tracked queues
for (const row of tracked_queue_rows) {
  const id = row.from?.call_id
  if (id && multiSegmentCallIds.has(id) && selectedCallIds.size < 8) {
    selectedCallIds.add(id)
  }
}

// Priority 2: single-segment calls touching tracked queues
for (const row of tracked_queue_rows) {
  const id = row.from?.call_id
  if (id && selectedCallIds.size < 14) {
    selectedCallIds.add(id)
  }
}

// Priority 3: abandoned calls
for (const row of abandoned_rows) {
  const id = row.from?.call_id
  if (id && selectedCallIds.size < 20) {
    selectedCallIds.add(id)
  }
}

// Priority 4: answered calls (agent direct)
for (const row of answered_rows) {
  const id = row.from?.call_id
  if (id && selectedCallIds.size < 25) {
    selectedCallIds.add(id)
  }
}

console.error(`Selected ${selectedCallIds.size} distinct from.call_ids`)

// Collect all segments for selected call IDs
const selectedRows = allRows.filter(r => selectedCallIds.has(r.from?.call_id))
console.error(`Total segments in selection: ${selectedRows.length}`)

// Apply redaction
let outputCount = 0
for (const row of selectedRows) {
  const redacted = {
    duration: row.duration,
    answer_time: row.answer_time,   // timestamps preserved as-is per spec
    start_time: row.start_time,
    end_time: row.end_time,
    from: {
      call_id: redactCallId(row.from?.call_id),
      name: null,  // always null for privacy (name field not needed in fixtures)
      id: redactPhone(row.from?.id),
      user: row.from?.user,  // agent extension or null — not sensitive, preserve
      domain: row.from?.domain,
    },
    to: {
      call_id: redactCallId(row.to?.call_id),
      id: redactPhone(row.to?.id),
      user: row.to?.user,   // preserve exactly (queue IDs and internal extensions)
      domain: row.to?.domain,
    },
  }
  process.stdout.write(JSON.stringify(redacted) + '\n')
  outputCount++
}

console.error(`Output ${outputCount} redacted segments as NDJSON`)
