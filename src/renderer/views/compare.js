import '../styles/compare.css'
import { compareEnv } from '@shared/diff.js'
import { h } from '../lib/dom.js'
import { renderCompare } from '../components/diff-view.js'
import { icon } from '../components/icons.js'
import { toastError } from '../components/toast.js'

let pickerCount = 0

export function createCompareTab({ api, connections, getSettings, initial }) {
  const names = new Map() // connection id → Promise<string[]>
  const sides = { a: { ...initial.a }, b: { ...initial.b } }
  const result = h('div', { class: 'compare__result' }, h('p', { class: 'muted' }, 'Pick two parameters and press Compare.'))
  const compareButton = h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'compare' }, onClick: () => run() }, icon('compare', 14), 'Compare')
  const el = h('section', { class: 'compare' }, h('div', { class: 'compare__pickers' }, picker('a', 'A'), h('span', { class: 'compare__vs' }, 'vs'), picker('b', 'B'), compareButton), result)
  return { el, isDirty: () => false, destroy() {} }

  function picker(side, label) {
    const datalist = h('datalist', { id: `compare-names-${++pickerCount}` })
    const connectionSelect = h(
      'select',
      {
        class: 'input',
        'aria-label': `Connection ${label}`,
        onChange: (event) => {
          sides[side].connectionId = event.target.value
          loadNames(side, datalist)
        }
      },
      connections.map((c) => h('option', { value: c.id }, c.name))
    )
    connectionSelect.value = sides[side].connectionId
    const nameInput = h('input', {
      class: 'input mono',
      list: datalist.id,
      value: sides[side].name,
      placeholder: 'Parameter name',
      spellcheck: 'false',
      'aria-label': `Parameter ${label}`,
      onInput: (event) => (sides[side].name = event.target.value.trim()),
      onKeydown: (event) => event.key === 'Enter' && run()
    })
    loadNames(side, datalist)
    return h('div', { class: 'compare__picker' }, h('span', { class: 'compare__label' }, label), connectionSelect, nameInput, datalist)
  }

  function loadNames(side, datalist) {
    const id = sides[side].connectionId
    if (!names.has(id)) {
      names.set(
        id,
        api.ssm
          .list(id)
          .then((rows) => rows.map((r) => r.name))
          .catch((err) => {
            names.delete(id)
            toastError(err, 'Could not list parameters')
            return []
          })
      )
    }
    names.get(id).then((list) => {
      if (sides[side].connectionId === id) datalist.replaceChildren(...list.map((name) => h('option', { value: name })))
    })
  }

  async function run() {
    const { a, b } = sides
    if (!a.name || !b.name) {
      result.replaceChildren(h('p', { class: 'muted' }, 'Pick a parameter on both sides.'))
      return
    }
    compareButton.disabled = true
    result.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading values…'))
    try {
      const [va, vb] = await Promise.all([api.ssm.get(a.connectionId, a.name, { decrypt: true }), api.ssm.get(b.connectionId, b.name, { decrypt: true })])
      result.replaceChildren(renderCompare(compareEnv(va.value, vb.value), { masked: getSettings().maskValuesInDiff, labels: [describe(a), describe(b)] }).el)
    } catch (err) {
      result.replaceChildren(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load both values'), h('span', {}, err.message)))
      toastError(err, 'Compare failed')
    } finally {
      compareButton.disabled = false
    }
  }

  function describe(side) {
    const connection = connections.find((c) => c.id === side.connectionId)
    return `${side.name} (${connection?.name ?? 'unknown connection'})`
  }
}
