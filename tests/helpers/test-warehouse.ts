import { Database } from 'duckdb-async'
import fs from 'node:fs/promises'
import path from 'node:path'
import { NORMALIZE_DNIS_UDF_SQL } from '@/lib/utils/dnis'

export async function makeTestWarehouse(): Promise<Database> {
  const db = await Database.create(':memory:')
  const schemaSql = await fs.readFile(path.join(process.cwd(), 'lib/warehouse/schema.sql'), 'utf8')
  const cleaned = schemaSql.replace(/--.*$/gm, '')
  for (const stmt of cleaned.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await db.exec(stmt + ';')
  }
  await db.exec(NORMALIZE_DNIS_UDF_SQL)
  return db
}
