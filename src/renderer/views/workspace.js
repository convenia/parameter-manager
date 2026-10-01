import '../styles/workspace.css'
import { clear, h } from '../lib/dom.js'
import { createTabModel } from '../tabs.js'
import { readOnlyBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'
import { confirmDialog } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'
import { createCompareTab } from './compare.js'
import { openCreateParameter } from './create-parameter.js'
import { createParameterTab } from './parameter.js'
import { createParametersTab } from './parameters.js'
import { createSidebarTree } from './sidebar-tree.js'

const PARAMETERS_TAB = 'parameters'

export function renderWorkspace(root, { api, connection, getSettings, openSettings, onDisconnect }) {
  const canWrite = !connection.readOnly
  const tabs = createTabModel([{ id: PARAMETERS_TAB, title: 'Parameters', icon: 'folder', closable: false }])
  const panels = new Map() // tab id → controller with { el, isDirty?, destroy? }
  let rows = []
  let compareCount = 0

  const parametersTab = createParametersTab({
    canWrite,
    onOpen: (row) => openParameter(row.name),
    onRefresh: () => reload(),
    onCreate: (prefix) => create(prefix),
    onClearPrefix: () => tree.setSelectedFolder('')
  })
  const tree = createSidebarTree({
    onSelectFolder: (path) => {
      parametersTab.setPrefix(path)
      tree.setSelectedFolder(path)
      tabs.activate(PARAMETERS_TAB)
    },
    onOpenLeaf: (name) => openParameter(name)
  })
  const tabBar = h('div', { class: 'tabbar', role: 'tablist' })
  const panelHost = h('div', { class: 'tabpanels' })
  addPanel(PARAMETERS_TAB, parametersTab)

  const layout = h(
    'div',
    { class: 'workspace' },
    h(
      'aside',
      { class: 'sidebar' },
      h(
        'div',
        { class: 'sidebar__connection', style: { '--conn-color': `var(--conn-${connection.color})` } },
        h(
          'div',
          { class: 'sidebar__conn-text' },
          h('span', { class: 'sidebar__conn-name', title: connection.name }, connection.name),
          h('span', { class: 'sidebar__conn-meta' }, `${connection.profile} · ${connection.region}`),
          connection.pathPrefix ? h('span', { class: 'sidebar__conn-meta mono', title: 'Path prefix' }, connection.pathPrefix) : null
        ),
        connection.readOnly ? readOnlyBadge() : null,
        h('button', { class: 'icon-btn icon-btn--sidebar', type: 'button', title: 'Disconnect', 'aria-label': 'Disconnect', dataset: { action: 'disconnect' }, onClick: () => onDisconnect() }, icon('logout'))
      ),
      h(
        'div',
        { class: 'sidebar__actions' },
        h('button', { class: 'btn btn--sidebar', type: 'button', dataset: { action: 'compare' }, onClick: () => openCompare() }, icon('compare', 14), 'Compare'),
        canWrite ? h('button', { class: 'btn btn--sidebar', type: 'button', dataset: { action: 'create' }, onClick: () => create('') }, icon('plus', 14), 'Create') : null
      ),
      h('div', { class: 'sidebar__filter' }, h('input', { class: 'input input--sidebar', type: 'search', placeholder: 'Filter parameters', 'aria-label': 'Filter parameters', onInput: (event) => tree.setQuery(event.target.value) })),
      tree.el
    ),
    h(
      'section',
      { class: 'workspace__main' },
      h('div', { class: 'tabbar-row' }, tabBar, h('button', { class: 'icon-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onClick: () => openSettings() }, icon('settings'))),
      panelHost
    )
  )

  clear(root).append(layout)
  const unsubscribe = tabs.subscribe(drawTabs)
  document.addEventListener('keydown', onKeydown)
  drawTabs()
  reload()

  return { reload, hasUnsavedChanges, destroy }

  function addPanel(id, controller) {
    panels.set(id, controller)
    panelHost.append(controller.el)
  }

  function removePanel(id) {
    const panel = panels.get(id)
    if (!panel) return
    panel.destroy?.()
    panel.el.remove()
    panels.delete(id)
  }

  function drawTabs() {
    tabBar.replaceChildren(...tabs.list().map(renderTab))
    for (const [id, panel] of panels) panel.el.hidden = id !== tabs.activeId
    const active = tabs.get(tabs.activeId)
    tree.setActiveLeaf(active?.kind === 'parameter' ? active.name : null)
  }

  function renderTab(tab) {
    const active = tab.id === tabs.activeId
    const dirty = panels.get(tab.id)?.isDirty?.() === true
    const close = (event) => {
      event.stopPropagation()
      closeTab(tab.id)
    }
    return h(
      'div',
      {
        class: ['tab', active && 'is-active', dirty && 'is-dirty'],
        role: 'tab',
        'aria-selected': String(active),
        title: tab.title,
        dataset: { tab: tab.id },
        onClick: () => tabs.activate(tab.id),
        onAuxclick: (event) => event.button === 1 && closeTab(tab.id)
      },
      tab.icon ? icon(tab.icon, 13) : null,
      h('span', { class: 'tab__title' }, tab.label ?? tab.title),
      dirty ? h('span', { class: 'tab__dirty', title: 'Unsaved changes' }) : null,
      tab.closable ? h('button', { class: 'tab__close', type: 'button', 'aria-label': `Close ${tab.title}`, onClick: close }, icon('close', 12)) : null
    )
  }

  function openParameter(name) {
    const id = `param:${name}`
    const meta = rows.find((r) => r.name === name)
    if (!panels.has(id)) {
      if (!meta) {
        toast({ kind: 'warning', message: `${name} is no longer in the list. Refreshing…` })
        reload()
        return
      }
      addPanel(id, createParameterTab({ api, connection, meta, getSettings, onDirtyChange: () => drawTabs(), onChanged: (event) => onParameterChanged(id, event) }))
    }
    tabs.open({ id, kind: 'parameter', name, title: name, label: shortLabel(name), icon: meta?.type === 'SecureString' ? 'lock' : 'file' })
  }

  async function onParameterChanged(id, event) {
    if (event.type === 'saved' && event.meta) {
      // Spec §5.4: refresh just the saved row. Re-listing costs one DescribeParameters call
      // per 50 parameters and flashes the table on large accounts.
      rows = rows.map((row) => (row.name === event.name ? { ...row, ...event.meta } : row))
      parametersTab.setRows(rows)
      tree.setRows(rows)
      return
    }
    // A parameter deleted elsewhere keeps its tab while it holds unsaved text, so nothing is lost.
    const keepOpen = event.type === 'missing' && panels.get(id)?.isDirty?.()
    if (keepOpen) toast({ kind: 'warning', message: `${event.name} no longer exists. Your unsaved text is still in its tab.`, timeout: 0 })
    if ((event.type === 'deleted' || event.type === 'missing') && !keepOpen) {
      tabs.close(id)
      removePanel(id)
      drawTabs()
    }
    await reload()
  }

  async function closeTab(id) {
    const tab = tabs.get(id)
    if (!tab?.closable) return
    if (panels.get(id)?.isDirty?.()) {
      const discard = await confirmDialog({ title: 'Discard unsaved changes?', message: `${tab.title} has changes that are not saved.`, confirmLabel: 'Discard changes', kind: 'danger' })
      if (!discard) return
    }
    tabs.close(id)
    removePanel(id)
    drawTabs()
  }

  async function reload() {
    parametersTab.setLoading(true)
    try {
      rows = await api.ssm.list(connection.id)
      parametersTab.setRows(rows)
      tree.setRows(rows)
    } catch (err) {
      parametersTab.setError(err)
      toastError(err, 'Could not list parameters')
    }
  }

  function create(prefix) {
    openCreateParameter({
      api,
      connection,
      prefix: prefix || connection.pathPrefix,
      onCreated: async (name) => {
        await reload()
        openParameter(name)
      }
    })
  }

  async function openCompare() {
    let connections
    try {
      connections = await api.connections.list()
    } catch (err) {
      toastError(err, 'Could not load connections')
      return
    }
    compareCount += 1
    const id = `compare:${compareCount}`
    const active = tabs.get(tabs.activeId)
    const initial = { a: { connectionId: connection.id, name: active?.kind === 'parameter' ? active.name : '' }, b: { connectionId: connection.id, name: '' } }
    addPanel(id, createCompareTab({ api, connections, getSettings, initial }))
    tabs.open({ id, kind: 'compare', title: compareCount === 1 ? 'Compare' : `Compare ${compareCount}`, icon: 'compare' })
  }

  function hasUnsavedChanges() {
    return [...panels.values()].some((panel) => panel.isDirty?.() === true)
  }

  function onKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
      event.preventDefault()
      closeTab(tabs.activeId)
    }
  }

  function destroy() {
    unsubscribe()
    document.removeEventListener('keydown', onKeydown)
    for (const id of [...panels.keys()]) removePanel(id)
  }
}

function shortLabel(name) {
  return name.split('/').filter(Boolean).slice(-2).join('/') || name
}
