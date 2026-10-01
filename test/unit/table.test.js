import { describe, expect, it } from 'vitest'
import { COLUMNS, filterRows, sortRows } from '@shared/table.js'

const rows = [
  { name: '/b/two', version: 10, lastModifiedDate: '2026-09-02T00:00:00.000Z', description: 'Second' },
  { name: '/a/one', version: 2, lastModifiedDate: '2026-09-10T00:00:00.000Z', description: '' },
  { name: 'legacy', version: 1, lastModifiedDate: null, description: 'Old TOKEN' },
  { name: '/ab/x', version: 3, lastModifiedDate: '2026-09-05T00:00:00.000Z', description: '' }
]
const names = (list) => list.map((r) => r.name)

describe('COLUMNS', () => {
  it('matches the AWS console columns', () => {
    expect(COLUMNS.map((c) => c.label)).toEqual(['Name', 'Tier', 'Type', 'Data type', 'Version', 'Last modified', 'Last modified user', 'Description'])
  })
})

describe('filterRows', () => {
  it('searches name and description case-insensitively', () => {
    expect(names(filterRows(rows, { query: 'token' }))).toEqual(['legacy'])
    expect(names(filterRows(rows, { query: 'ONE' }))).toEqual(['/a/one'])
  })

  it('limits to a folder prefix on segment boundaries', () => {
    expect(names(filterRows(rows, { prefix: '/a' }))).toEqual(['/a/one'])
    expect(names(filterRows(rows, { prefix: '/a/' }))).toEqual(['/a/one'])
  })

  it('returns every row without filters', () => {
    expect(filterRows(rows)).toHaveLength(4)
  })
})

describe('sortRows', () => {
  it('sorts versions numerically', () => {
    expect(sortRows(rows, 'version').map((r) => r.version)).toEqual([1, 2, 3, 10])
    expect(sortRows(rows, 'version', 'desc').map((r) => r.version)).toEqual([10, 3, 2, 1])
  })

  it('sorts dates chronologically and keeps empty values last in both directions', () => {
    expect(names(sortRows(rows, 'lastModifiedDate'))).toEqual(['/b/two', '/ab/x', '/a/one', 'legacy'])
    expect(names(sortRows(rows, 'lastModifiedDate', 'desc'))).toEqual(['/a/one', '/ab/x', '/b/two', 'legacy'])
  })

  it('sorts 20,000 rows by name fast enough to run on every keystroke', () => {
    const big = Array.from({ length: 20000 }, (_, i) => ({ name: `/svc${i % 97}/env${(i * 7919) % 20000}/param-${i}` }))
    const start = performance.now()
    sortRows(big, 'name')
    expect(performance.now() - start).toBeLessThan(300)
  })

  it('sorts text with natural ordering and does not mutate the input', () => {
    const copy = [...rows]
    expect(names(sortRows(rows, 'name'))).toEqual(['/a/one', '/ab/x', '/b/two', 'legacy'])
    expect(rows).toEqual(copy)
  })
})
