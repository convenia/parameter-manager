import '../styles/editor.css'
import { minimalSetup } from 'codemirror'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { normalizeEol, parseEnv } from '@shared/env.js'
import { formatNumber } from '@shared/format.js'
import { byteLength, tierLimit } from '@shared/names.js'
import { h } from '../lib/dom.js'
import { envSupport } from './env-language.js'
import { envLint } from './env-lint.js'

export function createEnvEditor({ value = '', tier = 'Standard', readOnly = false, onChange = () => {}, onSave = () => {} } = {}) {
  let original = normalizeEol(value)
  let currentTier = tier
  let silent = false
  const editable = new Compartment()

  const notice = h('div', { class: 'editor-notice', hidden: true }, 'Not in .env format — editing as plain text.')
  const lines = h('span', { class: 'editor-status__lines' })
  const bytes = h('span', { class: 'editor-status__bytes' })
  const host = h('div', { class: 'editor-host' })
  const el = h('div', { class: 'env-editor' }, notice, host, h('div', { class: 'editor-status' }, lines, bytes))

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: original,
      extensions: [
        minimalSetup,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...lintKeymap]),
        envSupport(),
        envLint(),
        editable.of(readOnlyExtensions(readOnly)),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSave()
                return true
              }
            }
          ])
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || silent) return
          changed()
        })
      ]
    })
  })

  const editor = {
    el,
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => view.state.doc.toString() !== original,
    setValue(text, { markClean = true } = {}) {
      const next = normalizeEol(text)
      if (markClean) original = next
      silent = true
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
      } finally {
        silent = false
      }
      changed()
    },
    setTier(nextTier) {
      currentTier = nextTier
      refresh()
    },
    setReadOnly(flag) {
      view.dispatch({ effects: editable.reconfigure(readOnlyExtensions(flag)) })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy()
  }
  refresh()
  return editor

  function changed() {
    refresh()
    onChange(editor.isDirty(), editor.getValue())
  }

  function refresh() {
    const text = view.state.doc.toString()
    const size = byteLength(text)
    const limit = tierLimit(currentTier)
    const count = view.state.doc.lines
    notice.hidden = text.trim() === '' || parseEnv(text).isEnv
    lines.textContent = `${formatNumber(count)} ${count === 1 ? 'line' : 'lines'}`
    bytes.textContent = `${formatNumber(size)} / ${formatNumber(limit)} bytes (${currentTier})`
    bytes.classList.toggle('is-over', size > limit)
  }
}

function readOnlyExtensions(readOnly) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}
