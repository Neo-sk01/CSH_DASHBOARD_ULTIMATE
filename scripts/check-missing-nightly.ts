import { Database } from 'duckdb-async'

async function postAlert(webhook: string, text: string): Promise<void> {
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

async function main() {
  const token = process.env.MOTHERDUCK_TOKEN_RW
  const database = process.env.MOTHERDUCK_DATABASE
  const webhook = process.env.ALERT_WEBHOOK_URL
  if (!token || !database) {
    throw new Error('check-missing-nightly: MOTHERDUCK_TOKEN_RW and MOTHERDUCK_DATABASE must be set')
  }
  const url = `md:${database}?motherduck_token=${token}`
  const db = await Database.create(url)
  let count = 0
  try {
    const rows = await db.all(
      "SELECT count(*) as c FROM pull_runs WHERE triggered_by='cron' AND status='success' AND triggered_at > now() - INTERVAL 24 HOUR",
    )
    count = Number((rows[0] as { c: number | bigint }).c ?? 0)
  } finally {
    await db.close()
  }

  if (count === 0) {
    if (webhook) {
      await postAlert(
        webhook,
        '⚠️ No successful nightly Versature pull in the last 24h. Check GitHub Actions.',
      )
    }
    console.error('No successful nightly cron pull in the last 24h')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
