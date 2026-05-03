export function normalizeDnis(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

export function normalizeDnisList(csv: string): string[] {
  const seen = new Set<string>()
  for (const raw of csv.split(',')) {
    const n = normalizeDnis(raw.trim())
    if (n) seen.add(n)
  }
  return [...seen]
}

// SQL body for the DuckDB scalar UDF — registered by lib/warehouse/client.ts.
// Implemented as a MACRO so it lives entirely in DuckDB without needing a UDF host.
export const NORMALIZE_DNIS_UDF_SQL = `
CREATE OR REPLACE MACRO normalize_dnis(s) AS (
  CASE
    WHEN s IS NULL THEN NULL
    WHEN length(regexp_replace(s, '\\D', '', 'g')) = 11
         AND regexp_replace(s, '\\D', '', 'g') LIKE '1%'
      THEN substr(regexp_replace(s, '\\D', '', 'g'), 2, 10)
    WHEN length(regexp_replace(s, '\\D', '', 'g')) = 10
      THEN regexp_replace(s, '\\D', '', 'g')
    ELSE NULL
  END
);
`
