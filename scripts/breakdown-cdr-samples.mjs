/**
 * Compute expected counts from sanitized CDR fixture.
 *
 * Loads tests/fixtures/real-cdr-samples.ndjson into in-memory DuckDB,
 * runs the production logical-call SQL (inline), counts results.
 * Outputs JSON to stdout and writes tests/fixtures/real-cdr-samples.expected.json.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/breakdown-cdr-samples.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
// Use dynamic import so tsx can handle the .ts extension in ESM context
const { makeTestWarehouse } = await import(path.join(__dirname, '../tests/helpers/test-warehouse.ts'))

const QUEUE_EN = process.env.QUEUE_EN_MAIN ?? process.env.QUEUE_ENGLISH ?? '8020'
const QUEUE_FR = process.env.QUEUE_FR_MAIN ?? process.env.QUEUE_FRENCH ?? '8021'
const QUEUE_AI_EN = process.env.QUEUE_AI_OVERFLOW_EN ?? '8030'
const QUEUE_AI_FR = process.env.QUEUE_AI_OVERFLOW_FR ?? '8031'

const DNIS_PRIMARY = process.env.DNIS_PRIMARY ?? '16135949199'
const DNIS_SECONDARY = process.env.DNIS_SECONDARY ?? '6135949199'

function normalizeDnis(input) {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

const trackedDnisNormalized = [DNIS_PRIMARY, DNIS_SECONDARY]
  .map(normalizeDnis)
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i)

const TORONTO_TZ = 'America/Toronto'

function toTorontoDate(isoTimestamp) {
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

function computeSourceHash(fromCallId, toCallId, startTime) {
  const raw = (fromCallId ?? '') + (toCallId ?? '') + startTime
  return crypto.createHash('sha256').update(raw).digest('hex')
}

const ndjsonPath = path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.ndjson')
console.error(`Loading fixture from ${ndjsonPath}...`)
const ndjsonText = await fs.readFile(ndjsonPath, 'utf8')
const rows = ndjsonText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
console.error(`Loaded ${rows.length} segments`)

// Build in-memory DuckDB with schema
console.error('Building in-memory warehouse...')
const db = await makeTestWarehouse()

// Prepare a fake pull_run_id
const PULL_RUN_ID = 'fixture-breakdown-run'
const pulledAt = new Date().toISOString().replace('T', ' ').replace('Z', '')

// Insert into pull_runs (required FK)
await db.exec(`
  INSERT INTO pull_runs (pull_run_id, triggered_by, triggered_at, status, window_start, window_end)
  VALUES ('${PULL_RUN_ID}', 'manual', CURRENT_TIMESTAMP, 'running', '2026-01-01', '2026-05-03')
`)

// Insert CDR segments
console.error('Inserting segments...')
let inserted = 0
for (const row of rows) {
  const fromCallId = row.from?.call_id ?? ''
  const toCallId = row.to?.call_id ?? null
  const startTime = row.start_time
  const sourceHash = computeSourceHash(fromCallId, toCallId, startTime)
  const callDate = toTorontoDate(startTime)

  const escape = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

  await db.exec(`
    INSERT OR IGNORE INTO raw_cdr_segments (
      source_hash, from_call_id, to_call_id,
      from_id, from_name, from_user, from_domain,
      to_id, to_user, to_domain,
      duration_seconds, start_time, end_time, answer_time,
      call_date, pulled_at, pull_run_id
    ) VALUES (
      ${escape(sourceHash)},
      ${escape(fromCallId)},
      ${escape(toCallId)},
      ${escape(row.from?.id)},
      ${escape(row.from?.name)},
      ${escape(row.from?.user)},
      ${escape(row.from?.domain)},
      ${escape(row.to?.id)},
      ${escape(row.to?.user)},
      ${escape(row.to?.domain)},
      ${row.duration ?? 0},
      ${escape(startTime)},
      ${escape(row.end_time)},
      ${escape(row.answer_time ?? null)},
      ${escape(callDate)},
      ${escape(pulledAt)},
      ${escape(PULL_RUN_ID)}
    )
  `)
  inserted++
}
console.error(`Inserted ${inserted} segments`)

// Run the production logical-call SQL inline
const EN = QUEUE_EN
const FR = QUEUE_FR
const AI_EN = QUEUE_AI_EN
const AI_FR = QUEUE_AI_FR
const DNIS_LIST = trackedDnisNormalized.map((d) => `'${d}'`).join(', ')

const logicalCallsSql = `
  WITH segments AS (
    SELECT * FROM raw_cdr_segments
  ),
  tracked_touch AS (
    SELECT
      from_call_id,
      list(to_user ORDER BY start_time)
        FILTER (WHERE to_user IN ('${EN}', '${FR}', '${AI_EN}', '${AI_FR}'))   AS touched_queues,
      bool_or(to_user IN ('${AI_EN}', '${AI_FR}'))                              AS touched_ai,
      bool_or(
        normalize_dnis(to_id) IN (${DNIS_LIST})
        OR to_user IN ('${EN}', '${FR}', '${AI_EN}', '${AI_FR}')
      )                                                                         AS touched_dnis
    FROM segments
    GROUP BY from_call_id
  ),
  first_tracked AS (
    SELECT from_call_id, to_user AS first_tracked_queue
    FROM (
      SELECT from_call_id, to_user,
             row_number() OVER (
               PARTITION BY from_call_id
               ORDER BY start_time, source_hash
             ) AS rn
      FROM segments
      WHERE to_user IN ('${EN}', '${FR}', '${AI_EN}', '${AI_FR}')
    )
    WHERE rn = 1
  )
  SELECT
    s.from_call_id,
    date_trunc('day', min(s.start_time))::DATE                              AS call_date,
    any_value(s.from_id ORDER BY s.start_time)                              AS caller_id,
    min(s.start_time)                                                       AS start_time,
    max(s.end_time)                                                         AS end_time,
    sum(s.duration_seconds)                                                 AS total_duration_seconds,
    count(*)                                                                AS segment_count,
    any_value(t.touched_dnis)                                               AS touched_dnis,
    any_value(t.touched_queues)                                             AS touched_queues,
    any_value(f.first_tracked_queue)                                        AS first_tracked_queue,
    any_value(t.touched_ai)                                                 AS touched_ai,
    any_value(f.first_tracked_queue) = '${EN}'                              AS is_english,
    any_value(f.first_tracked_queue) = '${FR}'                              AS is_french,
    any_value(t.touched_ai)                                                 AS is_ai,
    any_value(t.touched_ai)
      AND any_value(f.first_tracked_queue) IN ('${EN}', '${FR}')            AS is_ai_overflow
  FROM segments s
  JOIN tracked_touch t USING (from_call_id)
  LEFT JOIN first_tracked f USING (from_call_id)
  GROUP BY s.from_call_id
`

console.error('Running logical-call SQL...')
const logicalCalls = await db.all(logicalCallsSql)
console.error(`Logical calls computed: ${logicalCalls.length}`)

const totalLogicalCalls = logicalCalls.length
const englishCalls = logicalCalls.filter((r) => r.is_english).length
const frenchCalls = logicalCalls.filter((r) => r.is_french).length
const aiCalls = logicalCalls.filter((r) => r.is_ai).length
const aiOverflowCalls = logicalCalls.filter((r) => r.is_ai_overflow).length
const touchedDnis = logicalCalls.filter((r) => r.touched_dnis).length
const notTouchedDnis = logicalCalls.filter((r) => !r.touched_dnis).length

const callDates = [...new Set(rows.map((r) => toTorontoDate(r.start_time)))].sort()

const expected = {
  computedBy: 'scripts/breakdown-cdr-samples.mjs (no manual reconciliation in this run; operator should spot-check before merging)',
  scriptAssistedBreakdown: true,
  sourceDate: callDates.join(', '),
  sourceTimezone: TORONTO_TZ,
  queues: { EN: QUEUE_EN, FR: QUEUE_FR, AI_EN: QUEUE_AI_EN, AI_FR: QUEUE_AI_FR },
  trackedDnisNormalized,
  totalSegments: rows.length,
  totalLogicalCalls,
  englishCalls,
  frenchCalls,
  aiCalls,
  aiOverflowCalls,
  touchedDnis,
  notTouchedDnis,
  note: 'These counts reflect the sanitized fixture subset, not full-day data. The fixture is intentionally diverse but not statistically representative.',
}

const outputPath = path.join(process.cwd(), 'tests/fixtures/real-cdr-samples.expected.json')
await fs.writeFile(outputPath, JSON.stringify(expected, null, 2) + '\n')
console.error(`Written to ${outputPath}`)

console.log(JSON.stringify(expected, null, 2))
