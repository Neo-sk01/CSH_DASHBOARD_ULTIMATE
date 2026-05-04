import { pathToFileURL } from 'node:url'

import { openWarehouse } from '@/lib/warehouse/client'

interface CountsRow {
  logical_calls: number
  touched_dnis_calls: number
}

interface QueueOfferedRow {
  queue_id: string
  total_offered: number | null
}

interface SampleRow {
  from_call_id: string
  caller_id: string | null
  start_time: Date | string
  total_duration_seconds: number
  segment_count: number
  touched_dnis: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseDateArg(): string {
  const dateArg = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1]
  if (!dateArg) {
    console.error('Usage: npm run audit -- --date=YYYY-MM-DD')
    process.exit(1)
  }
  if (!DATE_RE.test(dateArg)) {
    console.error(`Invalid --date value: "${dateArg}". Expected YYYY-MM-DD.`)
    process.exit(1)
  }
  return dateArg
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

async function main(): Promise<void> {
  const dateArg = parseDateArg()

  const queueEn = process.env.QUEUE_EN_MAIN ?? process.env.QUEUE_ENGLISH ?? null
  const queueFr = process.env.QUEUE_FR_MAIN ?? process.env.QUEUE_FRENCH ?? null
  const queueAiEn = process.env.QUEUE_AI_OVERFLOW_EN ?? null
  const queueAiFr = process.env.QUEUE_AI_OVERFLOW_FR ?? null

  const w = await openWarehouse({ mode: 'read' })
  try {
    const counts = await w.one<CountsRow>(
      `SELECT count(*)                              AS logical_calls,
              count(*) FILTER (WHERE touched_dnis)  AS touched_dnis_calls
       FROM logical_calls
       WHERE call_date = ?`,
      [dateArg],
    )

    const queueRows = await w.all<QueueOfferedRow>(
      `SELECT queue_id, sum(calls_offered) AS total_offered
       FROM raw_queue_stats
       WHERE business_date = ?
       GROUP BY queue_id
       ORDER BY queue_id`,
      [dateArg],
    )

    const offeredById = new Map<string, number>()
    let totalOffered = 0
    for (const r of queueRows) {
      const v = Number(r.total_offered ?? 0)
      offeredById.set(r.queue_id, v)
      totalOffered += v
    }

    const englishOffered = queueEn ? offeredById.get(queueEn) ?? 0 : null
    const frenchOffered = queueFr ? offeredById.get(queueFr) ?? 0 : null
    const aiOffered =
      queueAiEn != null && queueAiFr != null
        ? (offeredById.get(queueAiEn) ?? 0) + (offeredById.get(queueAiFr) ?? 0)
        : null

    const samples = await w.all<SampleRow>(
      `SELECT from_call_id, caller_id, start_time,
              total_duration_seconds, segment_count, touched_dnis
       FROM logical_calls
       WHERE call_date = ?
       ORDER BY start_time
       LIMIT 5`,
      [dateArg],
    )

    const touchedDnis = Number(counts?.touched_dnis_calls ?? 0)
    const drift =
      totalOffered > 0
        ? ((touchedDnis - totalOffered) / totalOffered) * 100
        : null

    console.log(`\n=== Audit for ${dateArg} ===\n`)
    console.log(`Logical calls (all rows):       ${Number(counts?.logical_calls ?? 0)}`)
    console.log(`  touched_dnis = true:          ${touchedDnis}`)
    console.log(``)
    console.log(`Queue offered (raw_queue_stats):`)
    if (englishOffered !== null) {
      console.log(`  ${pad(`English (${queueEn}):`, 30)}${englishOffered}`)
    }
    if (frenchOffered !== null) {
      console.log(`  ${pad(`French  (${queueFr}):`, 30)}${frenchOffered}`)
    }
    if (aiOffered !== null) {
      console.log(`  ${pad(`AI total (${queueAiEn}+${queueAiFr}):`, 30)}${aiOffered}`)
    }
    console.log(`  ${pad(`All queues sum:`, 30)}${totalOffered}`)
    console.log(``)
    if (drift !== null) {
      console.log(`Drift (touched_dnis vs all queues): ${drift.toFixed(2)}%`)
      console.log(`  (positive => more logical calls than queue offers; expect within ±2% on a healthy day)`)
    } else {
      console.log(`Drift: n/a (no raw_queue_stats rows for ${dateArg})`)
    }
    console.log(``)
    console.log(`Samples (up to 5 logical calls, earliest first):`)
    if (samples.length === 0) {
      console.log(`  (no logical calls on this date)`)
    } else {
      for (const s of samples) {
        const start = s.start_time instanceof Date ? s.start_time.toISOString() : String(s.start_time)
        console.log(
          `  ${s.from_call_id}  caller=${s.caller_id ?? '(null)'}  start=${start}  dur=${s.total_duration_seconds}s  segs=${s.segment_count}  touched_dnis=${s.touched_dnis}`,
        )
      }
    }
    console.log(``)
  } finally {
    await w.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
