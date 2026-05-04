import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() })
})

async function lintAs(virtualPath: string, source: string): Promise<ESLint.LintResult[]> {
  return eslint.lintText(source, { filePath: path.resolve(process.cwd(), virtualPath) })
}

function violationMessages(results: ESLint.LintResult[]): string[] {
  return results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => m.message))
}

describe('architecture eslint gate', () => {
  it('rejects app/** importing @/lib/versature/* (direct dashboard violation)', async () => {
    const results = await lintAs('app/test-fixture.ts', `import { x } from '@/lib/versature/client'\nexport const _ = x\n`)
    const msgs = violationMessages(results)
    expect(msgs.some((m) => /lib\/versature|lib\/pipeline/.test(m))).toBe(true)
  })

  it('rejects components/** importing @/lib/pipeline/* (direct dashboard violation)', async () => {
    const results = await lintAs('components/test-fixture.tsx', `import { y } from '@/lib/pipeline/build-snapshots'\nexport const _ = y\n`)
    const msgs = violationMessages(results)
    expect(msgs.some((m) => /lib\/pipeline/.test(m))).toBe(true)
  })

  it('rejects lib/warehouse/** importing @/lib/versature/* (indirect-via-reader violation)', async () => {
    const results = await lintAs('lib/warehouse/test-fixture.ts', `import { foo } from '@/lib/versature/client'\nexport const _ = foo\n`)
    const msgs = violationMessages(results)
    expect(msgs.some((m) => /warehouse|versature|pipeline/i.test(m))).toBe(true)
  })

  it('rejects lib/warehouse/** importing @/lib/pipeline/* (indirect-via-reader violation)', async () => {
    const results = await lintAs('lib/warehouse/test-fixture.ts', `import { bar } from '@/lib/pipeline/build-snapshots'\nexport const _ = bar\n`)
    const msgs = violationMessages(results)
    expect(msgs.some((m) => /warehouse|versature|pipeline/i.test(m))).toBe(true)
  })

  it('allows lib/warehouse/** to import its own modules', async () => {
    const results = await lintAs('lib/warehouse/test-fixture.ts', `import { wrap } from '@/lib/warehouse/client'\nexport const _ = wrap\n`)
    expect(violationMessages(results)).toEqual([])
  })

  it('allows lib/pipeline/** to import lib/warehouse and lib/versature (it is the orchestrator layer)', async () => {
    const results = await lintAs('lib/pipeline/test-fixture.ts',
      `import { wrap } from '@/lib/warehouse/client'\nimport { request } from '@/lib/versature/client'\nexport const _ = { wrap, request }\n`)
    expect(violationMessages(results)).toEqual([])
  })
})
