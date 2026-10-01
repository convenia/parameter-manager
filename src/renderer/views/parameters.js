import '../styles/parameters.css'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'
import { COLUMNS, filterRows, sortRows } from '@shared/table.js'
import { h } from '../lib/dom.js'
import { tierBadge, typeBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'

// Rendering thousands of rows at once freezes the window; search and sort still use every row.
export const PAGE_SIZE = 500

export function createParametersTab({ canWrite, onOpen, onRefresh, onCreate, onClearPrefix = () => {} }) {
  const state = { rows: [], loading: true, error: null, query: '', prefix: '', sort: { column: 'name', direction: 'asc' }, limit: PAGE_SIZE }

  const searchInput = h('input', {
    class: 'input input--search',
    type: 'search',
    placeholder: 'Search name or description',
    'aria-label': 'Search parameters',
    onInput: (event) => {
      state.query = event.target.value
      state.limit = PAGE_SIZE
      draw()
    }
  })
  const prefixChip = h('span', { class: 'prefix-chip', hidden: true })
  const count = h('span', { class: 'parameters__count muted' })
  const thead = h('thead')
  const tbody = h('tbody')
  const footer = h('div', { class: 'parameters__footer' })
  const el = h(
    'section',
    { class: 'parameters' },
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { class: 'toolbar__title' }, 'Parameters'),
      prefixChip,
      count,
      h('span', { class: 'spacer' }),
      h('div', { class: 'search-box' }, icon('search', 14), searchInput),
      h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'refresh' }, onClick: () => onRefresh() }, icon('refresh', 14), 'Refresh'),
      canWrite ? h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'create' }, onClick: () => onCreate(state.prefix) }, icon('plus', 14), 'Create parameter') : null
    ),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, thead, tbody)),
    footer
  )
  draw()

  return {
    el,
    setRows(rows) {
      Object.assign(state, { rows, loading: false, error: null })
      draw()
    },
    setLoading(loading) {
      state.loading = loading
      draw()
    },
    setError(error) {
      Object.assign(state, { error, loading: false })
      draw()
    },
    setPrefix(prefix) {
      Object.assign(state, { prefix, limit: PAGE_SIZE })
      draw()
    },
    focusSearch: () => searchInput.focus()
  }

  function draw() {
    drawHeader()
    drawPrefixChip()
    footer.replaceChildren()
    if (state.loading) {
      count.textContent = ''
      tbody.replaceChildren(...skeletonRows())
      return
    }
    if (state.error) {
      count.textContent = ''
      tbody.replaceChildren(emptyRow(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load parameters'), h('span', {}, state.error.message), state.error.hint ? h('span', { class: 'muted' }, state.error.hint) : null)))
      return
    }

    const filtered = sortRows(filterRows(state.rows, { query: state.query, prefix: state.prefix }), state.sort.column, state.sort.direction)
    count.textContent = filtered.length === state.rows.length ? formatCount(state.rows.length, 'parameter') : `${formatCount(filtered.length, 'match', 'matches')} of ${formatNumber(state.rows.length)}`
    if (filtered.length === 0) {
      const none = state.rows.length === 0
      tbody.replaceChildren(
        emptyRow(h('div', { class: 'empty-state' }, h('strong', {}, none ? 'No parameters in this connection' : 'No parameters match'), h('span', { class: 'muted' }, none ? 'Check the connection path prefix, or create a parameter.' : 'Try another search or clear the folder filter.')))
      )
      return
    }

    tbody.replaceChildren(...filtered.slice(0, state.limit).map(renderRow))
    const remaining = filtered.length - state.limit
    if (remaining > 0) {
      footer.append(
        h(
          'button',
          {
            class: 'btn btn--default',
            type: 'button',
            onClick: () => {
              state.limit += PAGE_SIZE
              draw()
            }
          },
          `Show ${formatNumber(Math.min(PAGE_SIZE, remaining))} more (${formatNumber(remaining)} remaining)`
        )
      )
    }
  }

  function drawHeader() {
    thead.replaceChildren(
      h(
        'tr',
        {},
        COLUMNS.map((column) => {
          const active = state.sort.column === column.key
          const direction = active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
          return h(
            'th',
            { scope: 'col', class: [`col-${column.key}`, active && 'is-sorted'], 'aria-sort': direction },
            h('button', { class: 'th-sort', type: 'button', onClick: () => toggleSort(column.key) }, column.label, active ? icon(state.sort.direction === 'asc' ? 'chevronUp' : 'chevronDown', 12) : null)
          )
        })
      )
    )
  }

  function drawPrefixChip() {
    prefixChip.hidden = !state.prefix
    prefixChip.replaceChildren(
      icon('folder', 12),
      h('span', { class: 'mono' }, state.prefix),
      h(
        'button',
        {
          class: 'prefix-chip__clear',
          type: 'button',
          'aria-label': 'Clear folder filter',
          dataset: { action: 'clear-prefix' },
          onClick: () => {
            state.prefix = ''
            draw()
            onClearPrefix()
          }
        },
        icon('close', 12)
      )
    )
  }

  function toggleSort(column) {
    const direction = state.sort.column === column && state.sort.direction === 'asc' ? 'desc' : 'asc'
    state.sort = { column, direction }
    draw()
  }

  function renderRow(row) {
    return h(
      'tr',
      { class: 'data-row', tabindex: '0', dataset: { name: row.name }, onClick: () => onOpen(row), onKeydown: (event) => event.key === 'Enter' && onOpen(row) },
      h('td', { class: 'col-name mono', title: row.name }, row.name),
      h('td', {}, tierBadge(row.tier)),
      h('td', {}, typeBadge(row.type)),
      h('td', { class: 'muted' }, row.dataType),
      h('td', { class: 'num' }, String(row.version)),
      h('td', { class: 'nowrap' }, formatDate(row.lastModifiedDate)),
      h('td', { class: 'ellipsis muted', title: row.lastModifiedUser ?? '' }, row.lastModifiedUser ?? '—'),
      h('td', { class: 'ellipsis', title: row.description }, row.description || h('span', { class: 'muted' }, '—'))
    )
  }
}

function emptyRow(content) {
  return h('tr', { class: 'empty-row' }, h('td', { colspan: String(COLUMNS.length) }, content))
}

function skeletonRows() {
  return Array.from({ length: 6 }, () => h('tr', { class: 'skeleton-row' }, COLUMNS.map(() => h('td', {}, h('span', { class: 'skeleton' })))))
}
