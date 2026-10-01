import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const KEY_THEN_EQUALS = /^[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/
const EXPORT_THEN_KEY = /^export(?=\s+[A-Za-z_][A-Za-z0-9_.-]*\s*=)/

// Follows the parse rules in @shared/env.js. Token names double as @lezer/highlight tags.
export const envStreamParser = {
  name: 'env',
  startState: () => ({ phase: 'start', inQuote: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.inQuote) return readQuoted(stream, state)
    if (stream.sol()) state.phase = 'start'
    if (stream.eatSpace()) return null

    switch (state.phase) {
      case 'start':
        if (stream.peek() === '#') {
          stream.skipToEnd()
          return 'comment'
        }
        if (stream.match(EXPORT_THEN_KEY)) {
          state.phase = 'key'
          return 'keyword'
        }
      // falls through
      case 'key':
        if (stream.match(KEY_THEN_EQUALS)) {
          state.phase = 'equals'
          return 'propertyName'
        }
        stream.skipToEnd()
        return 'invalid'
      case 'equals':
        stream.next()
        state.phase = 'value'
        return 'operator'
      case 'value':
        if (stream.peek() === '"') {
          stream.next()
          state.inQuote = true
          return 'string'
        }
        state.phase = 'after'
        if (stream.match(/^'[^']*'?/)) return 'string'
        stream.match(/^.*?(?=\s+#|$)/)
        return 'content'
      default:
        if (stream.peek() === '#') {
          stream.skipToEnd()
          return 'comment'
        }
        stream.skipToEnd()
        return null
    }
  }
}

function readQuoted(stream, state) {
  if (stream.match(/^\\./)) return 'escape'
  if (stream.match(/^[^"\\]+/)) return 'string'
  if (stream.eat('"')) {
    state.inQuote = false
    state.phase = 'after'
    return 'string'
  }
  stream.next()
  return 'string'
}

export const envLanguage = StreamLanguage.define(envStreamParser)

export const envHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: t.propertyName, color: 'var(--code-key)', fontWeight: '600' },
  { tag: t.operator, color: 'var(--code-operator)' },
  { tag: t.content, color: 'var(--code-value)' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.escape, color: 'var(--code-escape)' },
  { tag: t.invalid, color: 'var(--code-invalid)', textDecoration: 'underline wavy' }
])

// Colors come from CSS variables, so a theme switch needs no editor reconfiguration.
export const envTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text)', backgroundColor: 'var(--editor-bg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-gutter-bg)', color: 'var(--text-subtle)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--tint-yellow-bg)', outline: '1px solid var(--yellow-base)' }
})

export function envSupport() {
  return [envLanguage, syntaxHighlighting(envHighlightStyle), envTheme]
}
