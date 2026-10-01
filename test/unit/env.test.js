import { describe, expect, it } from 'vitest'
import { normalizeEol, parseEnv, toMap } from '@shared/env.js'

const entries = (text) => parseEnv(text).entries.map((e) => [e.key, e.value, e.line])

describe('parseEnv', () => {
  it('parses KEY=value lines and skips blank lines and comments', () => {
    expect(entries('# header\n\nA=1\nB=two\n')).toEqual([['A', '1', 3], ['B', 'two', 4]])
  })

  it('accepts an export prefix and whitespace around the key and "="', () => {
    expect(entries('export A=1\n  B  =  2  ')).toEqual([['A', '1', 1], ['B', '2', 2]])
  })

  it('strips inline comments from unquoted values only after whitespace', () => {
    expect(entries('A=value # note\nB=a#b\nC=')).toEqual([['A', 'value', 1], ['B', 'a#b', 2], ['C', '', 3]])
  })

  it('keeps single-quoted values literally', () => {
    expect(entries("A='x # y \\n'")).toEqual([['A', 'x # y \\n', 1]])
  })

  it('expands escapes in double-quoted values and keeps unknown ones', () => {
    expect(entries('A="line1\\nline2 \\"q\\" \\\\ \\x"')).toEqual([['A', 'line1\nline2 "q" \\ \\x', 1]])
  })

  it('lets a double-quoted value span several lines', () => {
    expect(entries('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1')).toEqual([
      ['KEY', '-----BEGIN-----\nabc\n-----END-----', 1],
      ['NEXT', '1', 4]
    ])
  })

  it('warns about an unterminated quote and keeps parsing the following lines', () => {
    const parsed = parseEnv('A="open\nB=2')
    expect(parsed.entries.map((e) => e.key)).toEqual(['B'])
    expect(parsed.warnings).toEqual([{ line: 1, kind: 'unterminated', message: 'Missing closing quote for "A"' }])
  })

  it('warns about lines that are not KEY=value', () => {
    const parsed = parseEnv('A=1\nthis is not valid\n=x\nBAD KEY=1')
    expect(parsed.entries.map((e) => e.key)).toEqual(['A'])
    expect(parsed.warnings.map((w) => [w.line, w.kind, w.message])).toEqual([
      [2, 'invalid', 'Expected KEY=value'],
      [3, 'invalid', 'Missing key before "="'],
      [4, 'invalid', 'Invalid key "BAD KEY"']
    ])
  })

  it('warns about duplicate keys, and toMap keeps the last value', () => {
    const parsed = parseEnv('A=1\nB=2\nA=3')
    expect(parsed.warnings).toEqual([{ line: 3, kind: 'duplicate', message: 'Duplicate key "A" (first defined on line 1)' }])
    expect([...toMap(parsed)]).toEqual([['A', '3'], ['B', '2']])
  })

  it('decides whether the text is .env at all', () => {
    expect(parseEnv('').isEnv).toBe(true)
    expect(parseEnv('# only a comment').isEnv).toBe(true)
    expect(parseEnv('A=1\nnot valid').isEnv).toBe(true)
    expect(parseEnv('{\n  "retries": 3\n}').isEnv).toBe(false)
    expect(parseEnv('just a token').isEnv).toBe(false)
  })

  it('treats CRLF and CR line endings like LF', () => {
    expect(entries('A=1\r\nB=2\rC=3')).toEqual([['A', '1', 1], ['B', '2', 2], ['C', '3', 3]])
  })

  it('treats null and undefined as empty text', () => {
    expect(parseEnv(undefined)).toEqual({ entries: [], warnings: [], isEnv: true })
    expect(parseEnv(null).isEnv).toBe(true)
  })
})

describe('normalizeEol', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })
})
