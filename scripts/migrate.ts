import { Database } from 'duckdb-async'
import fs from 'node:fs/promises'
import path from 'node:path'

const token = process.env.MOTHERDUCK_TOKEN_RW
const dbName = process.env.MOTHERDUCK_DATABASE
if (!token) throw new Error('MOTHERDUCK_TOKEN_RW is required')
if (!dbName) throw new Error('MOTHERDUCK_DATABASE is required')

const db = await Database.create(`md:${dbName}?motherduck_token=${token}`)
const sql = await fs.readFile(path.join(process.cwd(), 'lib/warehouse/schema.sql'), 'utf8')

// Strip line comments, then split on `;` at statement end
const cleaned = sql.replace(/--.*$/gm, '')
const statements = cleaned.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)

for (const stmt of statements) {
  const preview = stmt.split('\n')[0].slice(0, 80)
  console.log(`> ${preview}...`)
  await db.exec(stmt + ';')
}

console.log('Migration complete.')
await db.close()
