import '../styles/diff.css'
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { h } from '../lib/dom.js'
import { envSupport } from './env-language.js'
import { icon } from './icons.js'

const MASK = '••••••••'
const KIND_LABEL = { added: 'Added', changed: 'Changed', removed: 'Removed', different: 'Different', onlyA: 'Only A', onlyB: 'Only B', equal: 'Equal' }

export function renderDiff(diff, { masked = true } = {}) {
  return diff.mode === 'keys' ? renderKeyDiff(diff, masked) : renderLineDiff(diff, masked)
}

export function renderCompare(result, { masked = true, labels = ['A', 'B'] } = {}) {
  if (!result.comparable) {
    const sides = [!result.aIsEnv && labels[0], !result.bIsEnv && labels[1]].filter(Boolean)
    return {
      el: h('div', { class: 'empty-state compare-view' }, h('strong', {}, 'These values cannot be compared key by key'), h('span', { class: 'muted' }, `${sides.join(' and ')} ${sides.length > 1 ? 'are' : 'is'} not in .env format.`)),
      destroy() {}
    }
  }

  let showEqual = false
  const rowsFor = () => ['different', 'onlyA', 'onlyB', ...(showEqual ? ['equal'] : [])].flatMap((kind) => result[kind].map((row) => ({ ...row, kind })))
  const table = maskedTable({ rows: rowsFor(), masked, headers: [`A · ${labels[0]}`, `B · ${labels[1]}`], valuesOf: (row) => [row.a, row.b] })
  const equalToggle = h(
    'label',
    { class: 'checkbox checkbox--inline' },
    h('input', {
      type: 'checkbox',
      name: 'showEqual',
      onChange: (event) => {
        showEqual = event.target.checked
        table.setRows(rowsFor())
      }
    }),
    h('span', {}, `Show ${result.equal.length} equal`)
  )
  const identical = result.different.length + result.onlyA.length + result.onlyB.length === 0
  const el = h(
    'div',
    { class: 'diff compare-view' },
    h('div', { class: 'diff__summary' }, chip('different', `${result.different.length} different`), chip('onlyA', `${result.onlyA.length} only in A`), chip('onlyB', `${result.onlyB.length} only in B`), chip('equal', `${result.equal.length} equal`), h('span', { class: 'spacer' }), equalToggle, table.toggle),
    identical ? h('p', { class: 'diff__empty' }, 'Both parameters define the same variables with the same values.') : null,
    table.el
  )
  return { el, destroy() {} }
}

function renderKeyDiff(diff, masked) {
  const rows = [
    ...diff.added.map((r) => ({ kind: 'added', key: r.key, before: null, after: r.value })),
    ...diff.changed.map((r) => ({ kind: 'changed', key: r.key, before: r.oldValue, after: r.newValue })),
    ...diff.removed.map((r) => ({ kind: 'removed', key: r.key, before: r.value, after: null }))
  ]
  const summary = h('div', { class: 'diff__summary' }, chip('added', `+${diff.added.length} added`), chip('changed', `~${diff.changed.length} changed`), chip('removed', `−${diff.removed.length} removed`), h('span', { class: 'diff__unchanged' }, `${diff.unchanged} unchanged`))
  if (rows.length === 0) {
    const message = diff.textChanged ? 'No variable changes — only comments or formatting changed.' : 'No changes.'
    return { el: h('div', { class: 'diff' }, summary, h('p', { class: 'diff__empty' }, message)), destroy() {} }
  }
  const table = maskedTable({ rows, masked, headers: ['Before', 'After'], valuesOf: (row) => [row.before, row.after] })
  if (table.toggle) summary.append(h('span', { class: 'spacer' }), table.toggle)
  return { el: h('div', { class: 'diff' }, summary, table.el), destroy() {} }
}

function renderLineDiff(diff, masked) {
  const note = h('p', { class: 'diff__note' }, 'One of the values is not in .env format, so the change is shown line by line.')
  const el = h('div', { class: 'diff diff--lines' }, note)
  let merge = null
  const mount = () => {
    const host = h('div', { class: 'diff__merge' })
    el.replaceChildren(note, host)
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), envSupport()]
    merge = new MergeView({ a: { doc: diff.oldText ?? '', extensions }, b: { doc: diff.newText ?? '', extensions }, parent: host, highlightChanges: true, gutter: true })
  }
  if (masked) {
    el.append(h('div', { class: 'diff__masked' }, icon('eyeOff', 20), h('span', {}, 'Values are hidden.'), h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'reveal-lines' }, onClick: mount }, icon('eye', 14), 'Reveal')))
  } else {
    mount()
  }
  return { el, destroy: () => merge?.destroy() }
}

// A key/value table whose values can be masked, revealed per row, or revealed all at once.
function maskedTable({ rows, masked, headers, valuesOf }) {
  let current = rows
  let revealAll = !masked
  const revealed = new Set()
  const tbody = h('tbody')
  const toggle = masked
    ? h('button', {
        class: 'btn btn--default btn--sm diff__toggle',
        type: 'button',
        onClick: () => {
          revealAll = !revealAll
          draw()
        }
      })
    : null
  const el = h('table', { class: 'diff__table' }, h('thead', {}, h('tr', {}, h('th', { class: 'diff__kind-col' }), h('th', {}, 'Key'), headers.map((label) => h('th', { title: label }, label)), masked ? h('th', { class: 'diff__eye-col' }) : null)), tbody)
  draw()
  return {
    el,
    toggle,
    setRows(next) {
      current = next
      draw()
    }
  }

  function draw() {
    toggle?.replaceChildren(icon(revealAll ? 'eyeOff' : 'eye', 14), revealAll ? 'Hide values' : 'Reveal values')
    tbody.replaceChildren(
      ...current.map((row) => {
        const show = revealAll || revealed.has(row.key)
        const flip = () => {
          if (show) revealed.delete(row.key)
          else revealed.add(row.key)
          draw()
        }
        return h(
          'tr',
          { class: ['diff__row', `diff__row--${row.kind}`], dataset: { key: row.key, kind: row.kind } },
          h('td', {}, h('span', { class: ['diff-kind', `diff-kind--${row.kind}`] }, KIND_LABEL[row.kind])),
          h('td', { class: 'mono diff__key' }, row.key),
          valuesOf(row).map((value) => h('td', { class: 'mono diff__value' }, value === null ? h('span', { class: 'muted' }, '—') : show ? value : MASK)),
          masked ? h('td', {}, revealAll ? null : h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${show ? 'Hide' : 'Reveal'} ${row.key}`, onClick: flip }, icon(show ? 'eyeOff' : 'eye', 14))) : null
        )
      })
    )
  }
}

function chip(kind, text) {
  return h('span', { class: ['diff-chip', `diff-chip--${kind}`] }, text)
}
