import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { envLanguage } from '../../src/renderer/components/env-language.js'

// StreamLanguage merges adjacent tokens of the same type into one node.
function tokens(doc) {
  const state = EditorState.create({ doc, extensions: [envLanguage] })
  const out = []
  ensureSyntaxTree(state, state.doc.length, 5000).iterate({
    enter: (node) => {
      if (node.name !== 'Document') out.push([doc.slice(node.from, node.to), node.name])
    }
  })
  return out
}

describe('envLanguage', () => {
  it('tokenizes comments, keys, operators, values, and trailing comments', () => {
    expect(tokens('# note\nA=1 # c')).toEqual([['# note', 'comment'], ['A', 'propertyName'], ['=', 'operator'], ['1', 'content'], ['# c', 'comment']])
  })

  it('tokenizes export, double-quoted strings with escapes, and single quotes', () => {
    expect(tokens('export B="x\\ny"\nC=\'q # z\'')).toEqual([
      ['export', 'keyword'],
      ['B', 'propertyName'],
      ['=', 'operator'],
      ['"x', 'string'],
      ['\\n', 'escape'],
      ['y"', 'string'],
      ['C', 'propertyName'],
      ['=', 'operator'],
      ["'q # z'", 'string']
    ])
  })

  it('carries a double-quoted value across lines', () => {
    expect(tokens('K="multi\nline"\nN=2')).toEqual([['K', 'propertyName'], ['=', 'operator'], ['"multi', 'string'], ['line"', 'string'], ['N', 'propertyName'], ['=', 'operator'], ['2', 'content']])
  })

  it('marks lines that are not KEY=value as invalid', () => {
    expect(tokens('bad line\n=x')).toEqual([['bad line', 'invalid'], ['=x', 'invalid']])
  })

  it('handles spaces around "=" and empty values', () => {
    expect(tokens('A=\nB = 2')).toEqual([['A', 'propertyName'], ['=', 'operator'], ['B', 'propertyName'], ['=', 'operator'], ['2', 'content']])
  })
})
