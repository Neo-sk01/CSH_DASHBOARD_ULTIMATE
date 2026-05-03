import { describe, it, expect } from 'vitest'
import { normalizeDnis, normalizeDnisList } from '@/lib/utils/dnis'

describe('normalizeDnis', () => {
  it('returns null for null/empty/undefined input', () => {
    expect(normalizeDnis(null)).toBeNull()
    expect(normalizeDnis('')).toBeNull()
    expect(normalizeDnis(undefined)).toBeNull()
  })

  it('strips + and returns 10-digit form', () => {
    expect(normalizeDnis('+16135949199')).toBe('6135949199')
    expect(normalizeDnis('16135949199')).toBe('6135949199')
    expect(normalizeDnis('6135949199')).toBe('6135949199')
  })

  it('handles formatted variants', () => {
    expect(normalizeDnis('+1 (613) 594-9199')).toBe('6135949199')
    expect(normalizeDnis('613-594-9199')).toBe('6135949199')
    expect(normalizeDnis('613.594.9199')).toBe('6135949199')
    expect(normalizeDnis('  613 594 9199  ')).toBe('6135949199')
  })

  it('returns null when result is not 10 digits', () => {
    expect(normalizeDnis('123')).toBeNull()
    expect(normalizeDnis('+44 20 7946 0958')).toBeNull()
    expect(normalizeDnis('abc')).toBeNull()
  })

  it('strips leading 1 from 11-digit form when valid NANP', () => {
    expect(normalizeDnis('16135949199')).toBe('6135949199')
    expect(normalizeDnis('15551234567')).toBe('5551234567')
  })
})

describe('normalizeDnisList', () => {
  it('normalizes and dedupes a comma-separated string', () => {
    expect(normalizeDnisList('+16135949199,6135949199, +1 (613) 594-9199'))
      .toEqual(['6135949199'])
  })

  it('drops invalid entries, keeps valid ones', () => {
    expect(normalizeDnisList('+16135949199,bad,+15551234567'))
      .toEqual(['6135949199', '5551234567'])
  })
})
