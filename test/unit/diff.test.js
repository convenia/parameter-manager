import { describe, expect, it } from 'vitest'
import { compareEnv, diffEnv } from '@shared/diff.js'

describe('diffEnv', () => {
  it('reports added, changed, removed, and unchanged keys', () => {
    expect(diffEnv('A=1\nB=2\nC=3', 'A=1\nB=20\nD=4')).toEqual({
      mode: 'keys',
      added: [{ key: 'D', value: '4' }],
      changed: [{ key: 'B', oldValue: '2', newValue: '20' }],
      removed: [{ key: 'C', value: '3' }],
      unchanged: 1,
      textChanged: true
    })
  })

  it('notices text changes that touch no key', () => {
    const diff = diffEnv('A=1', '# comment\nA=1')
    expect(diff.mode).toBe('keys')
    expect(diff.added.length + diff.changed.length + diff.removed.length).toBe(0)
    expect(diff.textChanged).toBe(true)
  })

  it('ignores line-ending differences', () => {
    const diff = diffEnv('A=1\r\nB=2', 'A=1\nB=2')
    expect(diff.textChanged).toBe(false)
    expect(diff.unchanged).toBe(2)
  })

  it('falls back to line mode when either side is not .env', () => {
    expect(diffEnv('{"a":1}', 'A=1')).toEqual({ mode: 'lines', oldText: '{"a":1}', newText: 'A=1', textChanged: true })
    expect(diffEnv('A=1', 'plain text').mode).toBe('lines')
  })

  it('treats an empty old value as .env, so every key shows as added', () => {
    expect(diffEnv('', 'A=1').added).toEqual([{ key: 'A', value: '1' }])
  })
})

describe('compareEnv', () => {
  it('sorts keys into onlyA, onlyB, different, and equal, alphabetically', () => {
    expect(compareEnv('B=1\nA=1\nX=same', 'A=2\nC=3\nX=same')).toEqual({
      comparable: true,
      aIsEnv: true,
      bIsEnv: true,
      onlyA: [{ key: 'B', a: '1', b: null }],
      onlyB: [{ key: 'C', a: null, b: '3' }],
      different: [{ key: 'A', a: '1', b: '2' }],
      equal: [{ key: 'X', a: 'same', b: 'same' }]
    })
  })

  it('refuses to compare values that are not .env', () => {
    const result = compareEnv('A=1', '{"json":true}')
    expect(result.comparable).toBe(false)
    expect(result.aIsEnv).toBe(true)
    expect(result.bIsEnv).toBe(false)
    expect(result.onlyA).toEqual([])
  })
})
