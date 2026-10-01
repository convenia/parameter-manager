import { describe, expect, it } from 'vitest'
import { envDiagnostics } from '../../src/renderer/components/env-lint.js'

describe('envDiagnostics', () => {
  it('returns nothing for valid .env', () => {
    expect(envDiagnostics('A=1\n# c\nB=2')).toEqual([])
  })

  it('marks invalid lines and duplicate keys across the whole line', () => {
    expect(envDiagnostics('A=1\nnot valid\nA=2')).toEqual([
      { from: 4, to: 13, severity: 'warning', message: 'Expected KEY=value' },
      { from: 14, to: 17, severity: 'warning', message: 'Duplicate key "A" (first defined on line 1)' }
    ])
  })

  it('stays quiet for text that is not .env at all', () => {
    expect(envDiagnostics('{"json": true}')).toEqual([])
  })
})
