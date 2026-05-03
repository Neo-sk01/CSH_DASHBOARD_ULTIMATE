import { pathToFileURL } from 'node:url'

import { openWarehouse } from '@/lib/warehouse/client'
import { log } from '@/lib/utils/logger'

async function main() {
  const webhook = process.env.ALERT_WEBHOOK_URL
  const runUrl = process.env.PULL_RUN_LOG_URL ?? '(not provided)'
  if (!webhook) {
    log.warn('ALERT_WEBHOOK_URL not set; skipping notify')
    return
  }

  let summary = '(no recent pull_runs row)'
  try {
    const w = await openWarehouse({ mode: 'write' })
    const recent = await w.one<{
      status: string
      error_summary: string | null
      window_start: string
      window_end: string
    }>(
      `SELECT status, error_summary, window_start, window_end
       FROM pull_runs ORDER BY triggered_at DESC LIMIT 1`,
    )
    if (recent) {
      summary = `status=${recent.status} window=${recent.window_start}..${recent.window_end} error=${recent.error_summary ?? '(none)'}`
    }
    await w.close()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    summary = `(could not read pull_runs: ${message})`
  }

  const text = `🔴 Versature pull failed\n${summary}\nLog: ${runUrl}`
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error('notify webhook failed', { e: message })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
