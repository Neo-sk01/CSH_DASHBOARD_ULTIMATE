import { Database } from 'duckdb-async'

async function main() {
  const token = process.env.MOTHERDUCK_TOKEN_RW
  const database = process.env.MOTHERDUCK_DATABASE
  if (!token || !database) {
    throw new Error('assert-smoke-success: MOTHERDUCK_TOKEN_RW and MOTHERDUCK_DATABASE must be set')
  }
  const url = `md:${database}?motherduck_token=${token}`
  const db = await Database.create(url)
  try {
    const snapRows = await db.all('SELECT * FROM kpi_snapshots LIMIT 1')
    if (snapRows.length === 0) throw new Error('No snapshot row produced')
    const runRows = await db.all(
      "SELECT * FROM pull_runs WHERE status='success' ORDER BY finished_at DESC LIMIT 1",
    )
    if (runRows.length === 0) throw new Error('No successful pull_runs row')
  } finally {
    await db.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
