import '../styles/connections.css'
import { CONNECTION_COLORS } from '@shared/settings.js'
import { clear, h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { AWS_REGIONS } from '../lib/regions.js'
import { readOnlyBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'
import { confirmDialog } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

const FIELDS = ['name', 'profile', 'region', 'pathPrefix', 'color', 'readOnly']
const blank = () => ({ id: null, name: '', profile: '', region: '', pathPrefix: '', color: 'none', readOnly: false })

export function renderConnectionsScreen(root, { api, onConnect, openSettings }) {
  const state = { connections: [], profiles: [], paths: null, selectedId: null, draft: blank(), busy: false }
  const list = h('ul', { class: 'connection-list', role: 'listbox', 'aria-label': 'Saved connections' })
  const formHost = h('div', { class: 'connection-form' })

  clear(root).append(
    h(
      'div',
      { class: 'connections-screen' },
      h(
        'aside',
        { class: 'connections-sidebar' },
        h('div', { class: 'brand' }, h('span', { class: 'brand__mark' }, icon('key', 18)), h('span', { class: 'brand__name' }, 'Parameter Manager')),
        h('button', { class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'new' }, onClick: () => select(null) }, icon('plus', 14), 'New connection'),
        h('h3', { class: 'sidebar-heading' }, 'Saved connections'),
        list
      ),
      h('main', { class: 'connections-main' }, h('div', { class: 'connections-main__top' }, h('button', { class: 'icon-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', dataset: { action: 'settings' }, onClick: () => openSettings() }, icon('settings'))), formHost)
    )
  )
  load()
  return { reload: () => load() }

  async function load(selectId = state.selectedId) {
    try {
      const [connections, profileInfo] = await Promise.all([api.connections.list(), api.profiles.list()])
      Object.assign(state, { connections, profiles: profileInfo.profiles, paths: profileInfo })
      const target = connections.find((c) => c.id === selectId) ?? connections[0] ?? null
      select(target?.id ?? null)
    } catch (err) {
      toastError(err, 'Could not load connections')
      draw()
    }
  }

  function select(id) {
    const connection = state.connections.find((c) => c.id === id) ?? null
    state.selectedId = connection?.id ?? null
    state.draft = connection ? { ...connection } : { ...blank(), profile: state.profiles[0]?.name ?? '', region: state.profiles[0]?.region ?? '' }
    draw()
  }

  function draw() {
    drawList()
    drawForm()
  }

  function drawList() {
    if (state.connections.length === 0) {
      list.replaceChildren(h('li', { class: 'connection-list__empty' }, 'No saved connections yet.'))
      return
    }
    list.replaceChildren(
      ...state.connections.map((connection) => {
        const selected = connection.id === state.selectedId
        const stop = (fn) => (event) => {
          event.stopPropagation()
          fn(connection)
        }
        return h(
          'li',
          {
            class: ['connection-item', selected && 'is-selected'],
            role: 'option',
            'aria-selected': String(selected),
            tabindex: '0',
            dataset: { id: connection.id },
            onClick: () => select(connection.id),
            onDblclick: () => connect(connection),
            onKeydown: (event) => event.key === 'Enter' && connect(connection)
          },
          h('span', { class: 'color-dot', style: { background: `var(--conn-${connection.color})` } }),
          h('span', { class: 'connection-item__text' }, h('span', { class: 'connection-item__name' }, connection.name), h('span', { class: 'connection-item__meta' }, `${connection.profile} · ${connection.region}`)),
          connection.readOnly ? readOnlyBadge() : null,
          h(
            'span',
            { class: 'connection-item__actions' },
            h('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate ${connection.name}`, onClick: stop(duplicate) }, icon('copy', 14)),
            h('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Delete', 'aria-label': `Delete ${connection.name}`, onClick: stop(remove) }, icon('trash', 14))
          )
        )
      })
    )
  }

  function drawForm() {
    const d = state.draft
    const isNew = !d.id
    const set = (key) => (event) => {
      state.draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }

    const profileSelect = h(
      'select',
      { class: 'input', name: 'profile', onChange: (event) => changeProfile(event.target.value) },
      h('option', { value: '', disabled: true }, state.profiles.length ? 'Choose a profile' : 'No profiles found'),
      state.profiles.map((p) => h('option', { value: p.name }, `${p.name}${p.sso ? ' (SSO)' : ''}${p.region ? ` — ${p.region}` : ''}`))
    )
    profileSelect.value = d.profile

    const swatches = h(
      'div',
      { class: 'color-picker', role: 'radiogroup', 'aria-label': 'Color' },
      CONNECTION_COLORS.map((color) =>
        h('button', {
          class: ['color-swatch', `color-swatch--${color}`, d.color === color && 'is-selected'],
          type: 'button',
          role: 'radio',
          'aria-checked': String(d.color === color),
          'aria-label': color,
          title: color,
          dataset: { color },
          style: { background: color === 'none' ? 'transparent' : `var(--conn-${color})` },
          onClick: () => {
            state.draft.color = color
            drawForm()
          }
        })
      )
    )

    const banner =
      state.paths && state.profiles.length === 0
        ? h(
            'div',
            { class: 'callout callout--warning' },
            icon('warning', 16),
            h('div', {}, h('strong', {}, 'No AWS profiles found. '), 'Checked ', h('code', {}, state.paths.configPath), ' and ', h('code', {}, state.paths.credentialsPath), '. Configure the AWS CLI, or set custom paths in Settings.')
          )
        : null

    formHost.replaceChildren(
      h(
        'form',
        {
          class: 'card connection-card',
          onSubmit: (event) => {
            event.preventDefault()
            connect()
          }
        },
        h('header', { class: 'connection-card__header' }, h('h1', {}, isNew ? 'New connection' : 'Edit connection'), h('p', { class: 'muted' }, 'Connections use the AWS profiles on this machine. Parameter Manager never stores credentials.')),
        banner,
        field('Name', h('input', { class: 'input', name: 'name', value: d.name, placeholder: 'e.g. Production', autocomplete: 'off', onInput: set('name') })),
        h(
          'div',
          { class: 'field-row' },
          field('AWS profile', profileSelect),
          field('Region', h('div', {}, h('input', { class: 'input', name: 'region', value: d.region, list: 'aws-regions', placeholder: 'sa-east-1', spellcheck: 'false', autocomplete: 'off', onInput: set('region') }), h('datalist', { id: 'aws-regions' }, AWS_REGIONS.map((r) => h('option', { value: r })))))
        ),
        field('Path prefix', h('input', { class: 'input mono', name: 'pathPrefix', value: d.pathPrefix, placeholder: '/myapp/prod', spellcheck: 'false', autocomplete: 'off', onInput: set('pathPrefix') }), 'Optional. Only parameters whose name starts with this text are listed.'),
        field('Color', swatches),
        h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', name: 'readOnly', checked: d.readOnly, onChange: set('readOnly') }), h('span', {}, h('strong', {}, 'Read-only'), h('span', { class: 'field__help' }, 'Hide every action that changes parameters. Recommended for production.'))),
        h(
          'footer',
          { class: 'connection-card__footer' },
          isNew ? null : h('button', { class: 'btn btn--ghost-danger', type: 'button', dataset: { action: 'delete' }, onClick: () => remove(state.connections.find((c) => c.id === d.id)) }, icon('trash', 14), 'Delete'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'test' }, onClick: () => test() }, 'Test connection'),
          h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'save' }, onClick: () => save() }, 'Save'),
          h('button', { class: 'btn btn--primary', type: 'submit', dataset: { action: 'connect' } }, isNew ? 'Save & connect' : 'Connect')
        )
      )
    )
  }

  function changeProfile(name) {
    const previous = state.profiles.find((p) => p.name === state.draft.profile)
    const next = state.profiles.find((p) => p.name === name)
    // Follow the profile's default region unless the user typed a different one.
    if (!state.draft.region || state.draft.region === previous?.region) state.draft.region = next?.region ?? state.draft.region
    state.draft.profile = name
    drawForm()
  }

  async function save({ quiet = false } = {}) {
    if (state.busy) return null
    state.busy = true
    try {
      const saved = await api.connections.save(state.draft)
      state.connections = await api.connections.list()
      state.selectedId = saved.id
      state.draft = { ...saved }
      draw()
      if (!quiet) toast({ kind: 'success', message: `Saved "${saved.name}".` })
      return saved
    } catch (err) {
      toastError(err, 'Could not save the connection')
      return null
    } finally {
      state.busy = false
    }
  }

  async function connect(connection = null) {
    const stored = state.connections.find((c) => c.id === state.draft.id)
    const unchanged = stored && FIELDS.every((key) => stored[key] === state.draft[key])
    const target = connection ?? (unchanged ? stored : await save({ quiet: true }))
    if (target) onConnect(target)
  }

  async function test() {
    const button = formHost.querySelector('[data-action="test"]')
    button.disabled = true
    button.textContent = 'Testing…'
    try {
      await api.connections.test(state.draft)
      toast({ kind: 'success', title: 'Connection works', message: `Profile "${state.draft.profile}" can list parameters in ${state.draft.region}.` })
    } catch (err) {
      toastError(err, 'Connection failed')
    } finally {
      button.disabled = false
      button.textContent = 'Test connection'
    }
  }

  function duplicate(connection) {
    state.selectedId = null
    state.draft = { ...connection, id: null, name: `${connection.name} (copy)` }
    draw()
  }

  async function remove(connection) {
    if (!connection) return
    const confirmed = await confirmDialog({ title: 'Delete connection?', message: `"${connection.name}" will be removed from Parameter Manager. Your AWS profile and parameters are not touched.`, confirmLabel: 'Delete', kind: 'danger' })
    if (!confirmed) return
    try {
      await api.connections.delete(connection.id)
      toast({ kind: 'success', message: `Deleted "${connection.name}".` })
      await load(state.selectedId === connection.id ? null : state.selectedId)
    } catch (err) {
      toastError(err, 'Could not delete the connection')
    }
  }
}
