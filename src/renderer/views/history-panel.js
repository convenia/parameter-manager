import { diffEnv } from '@shared/diff.js'
import { formatDate } from '@shared/format.js'
import { h } from '../lib/dom.js'
import { renderDiff } from '../components/diff-view.js'
import { icon } from '../components/icons.js'
import { toastError } from '../components/toast.js'

export function createHistoryPanel({ api, connection, name, canRestore, getSettings, getCurrent, onRestore }) {
  let entries = []
  let selected = null
  let diffView = null
  const list = h('ol', { class: 'history__list', 'aria-label': 'Versions' })
  const detail = h('div', { class: 'history__detail' })
  const el = h('div', { class: 'history' }, list, detail)
  reload()
  return {
    el,
    reload,
    destroy: () => diffView?.destroy()
  }

  async function reload() {
    list.replaceChildren(h('li', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading history…'))
    detail.replaceChildren()
    try {
      const value = getCurrent()?.value
      entries = await api.ssm.history(connection.id, name, { decrypt: value !== null && value !== undefined })
      selected = entries.find((e) => e.version === selected?.version) ?? entries[1] ?? entries[0] ?? null
      drawList()
      drawDetail()
    } catch (err) {
      list.replaceChildren(h('li', { class: 'empty-state empty-state--error' }, err.message))
      toastError(err, 'Could not load history')
    }
  }

  function drawList() {
    const currentVersion = getCurrent()?.version
    list.replaceChildren(
      ...entries.map((entry) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: ['history__item', entry.version === selected?.version && 'is-selected'],
              type: 'button',
              dataset: { version: String(entry.version) },
              onClick: () => {
                selected = entry
                drawList()
                drawDetail()
              }
            },
            h('span', { class: 'history__version' }, `Version ${entry.version}`, entry.version === currentVersion ? h('span', { class: 'badge badge--current' }, 'Current') : null),
            h('span', { class: 'history__meta' }, formatDate(entry.lastModifiedDate)),
            h('span', { class: 'history__meta mono', title: entry.lastModifiedUser ?? '' }, shortUser(entry.lastModifiedUser)),
            entry.labels.length ? h('span', { class: 'history__labels' }, entry.labels.map((label) => h('span', { class: 'tag' }, label))) : null
          )
        )
      )
    )
  }

  function drawDetail() {
    diffView?.destroy()
    diffView = null
    const current = getCurrent()
    if (!selected) {
      detail.replaceChildren(h('p', { class: 'muted' }, 'This parameter has no history.'))
      return
    }
    if (selected.version === current?.version) {
      detail.replaceChildren(h('div', { class: 'empty-state' }, h('strong', {}, `Version ${selected.version} is the current version.`), h('span', { class: 'muted' }, 'Pick an older version to see what changed since then.')))
      return
    }
    if (selected.value === null || current?.value === null || current?.value === undefined) {
      detail.replaceChildren(h('div', { class: 'empty-state' }, icon('lock', 20), h('strong', {}, 'Values are encrypted'), h('span', { class: 'muted' }, 'Decrypt the value in the Value tab to compare versions.')))
      return
    }
    diffView = renderDiff(diffEnv(selected.value, current.value), { masked: getSettings().maskValuesInDiff })
    const restore = canRestore ? h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'restore' }, onClick: () => onRestore(selected) }, icon('history', 14), 'Restore this version') : null
    detail.replaceChildren(h('div', { class: 'history__detail-header' }, h('h3', {}, `Changes from version ${selected.version} to the current version (${current.version})`), restore), diffView.el)
  }
}

function shortUser(arn) {
  return arn ? arn.split(/[/:]/).pop() : '—'
}
