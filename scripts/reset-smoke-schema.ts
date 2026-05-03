import { Database } from 'duckdb-async'

async function main() {
  const token = process.env.MOTHERDUCK_TOKEN_RW
  const database = process.env.MOTHERDUCK_DATABASE
  if (!token || !database) {
    throw new Error('reset-smoke-schema: MOTHERDUCK_TOKEN_RW and MOTHERDUCK_DATABASE must be set')
  }
  const url = `md:${database}?motherduck_token=${token}`
  const db = await Database.create(url)
  await db.run('DROP SCHEMA IF EXISTS main CASCADE')
  await db.run('CREATE SCHEMA main')
  await db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
