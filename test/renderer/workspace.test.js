// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { renderWorkspace } from '../../src/renderer/views/workspace.js'

const connection = { id: 'c1', name: 'Prod', profile: 'prod', region: 'sa-east-1', pathPrefix: '', color: 'green', readOnly: false }
const meta = (name, type = 'String') => ({ name, type, tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: null, lastModifiedUser: null, description: '', keyId: null, allowedPattern: null })
const rows = [meta('/myapp/prod/env', 'SecureString'), meta('/myapp/dev/env')]

const workspaces = []
function setup({ readOnly = false } = {}) {
  const api = {
    ssm: {
      list: vi.fn(async () => rows),
      get: vi.fn(async (_c, name) => ({ name, type: 'String', value: 'A=1', version: 1, lastModifiedDate: null, dataType: 'text', arn: 'arn' })),
      tags: vi.fn(async () => []),
      history: vi.fn(async () => []),
      put: vi.fn(),
      delete: vi.fn()
    },
    connections: { list: vi.fn(async () => [connection]) }
  }
  const root = document.createElement('div')
  document.body.append(root)
  const onDisconnect = vi.fn()
  const openSettings = vi.fn()
  const ws = renderWorkspace(root, { api, connection: { ...connection, readOnly }, getSettings: () => ({ autoDecrypt: true, maskValuesInDiff: true }), openSettings, onDisconnect })
  workspaces.push(ws)
  return { api, root, ws, onDisconnect, openSettings }
}
const titles = (root) => [...root.querySelectorAll('.tab .tab__title')].map((t) => t.textContent)
const loaded = (root) => vi.waitFor(() => expect(root.querySelectorAll('.data-row')).toHaveLength(2))
const openRow = async (root, name) => {
  root.querySelector(`.data-row[data-name="${name}"]`).click()
  await vi.waitFor(() => expect(root.querySelector('.param:not([hidden]) .cm-editor')).not.toBeNull())
}
const edit = (root) => {
  const view = EditorView.findFromDOM(root.querySelector('.param:not([hidden]) .cm-editor'))
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\nB=2' } })
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})
afterEach(() => workspaces.splice(0).forEach((ws) => ws.destroy()))

describe('renderWorkspace', () => {
  it('lists the connection parameters and fills the tree', async () => {
    const { api, root } = setup()
    await loaded(root)
    expect(api.ssm.list).toHaveBeenCalledWith('c1')
    expect(root.querySelector('.sidebar__conn-name').textContent).toBe('Prod')
    expect(root.querySelector('.tree-row--root .tree-row__count').textContent).toBe('2')
    expect(titles(root)).toEqual(['Parameters'])
  })

  it('opens one tab per parameter and reuses it', async () => {
    const { root } = setup()
    await loaded(root)
    await openRow(root, '/myapp/prod/env')
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    expect(root.querySelector('.parameters').hidden).toBe(true)
    root.querySelector('.tab[data-tab="parameters"]').click()
    root.querySelector('.data-row[data-name="/myapp/prod/env"]').click()
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    expect(root.querySelector('.tab.is-active').dataset.tab).toBe('param:/myapp/prod/env')
  })

  it('asks before closing a tab with unsaved changes', async () => {
    const { root, ws } = setup()
    await loaded(root)
    await openRow(root, '/myapp/prod/env')
    edit(root)
    expect(ws.hasUnsavedChanges()).toBe(true)
    await vi.waitFor(() => expect(root.querySelector('.tab.is-dirty')).not.toBeNull())
    root.querySelector('.tab.is-active .tab__close').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="cancel"]').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).toBeNull())
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    root.querySelector('.tab.is-active .tab__close').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="confirm"]').click()
    await vi.waitFor(() => expect(titles(root)).toEqual(['Parameters']))
    expect(ws.hasUnsavedChanges()).toBe(false)
  })

  it('filters the table when a folder is selected in the tree', async () => {
    const { root } = setup()
    await loaded(root)
    root.querySelector('.tree-row[data-path="/myapp"]').click()
    root.querySelector('.tree-row[data-path="/myapp/dev"]').click()
    expect([...root.querySelectorAll('.data-row')].map((r) => r.dataset.name)).toEqual(['/myapp/dev/env'])
  })

  it('hides create actions on read-only connections', async () => {
    const { root } = setup({ readOnly: true })
    await vi.waitFor(() => expect(root.querySelectorAll('.data-row')).toHaveLength(2))
    expect(root.querySelector('[data-action="create"]')).toBeNull()
    expect(root.querySelector('.sidebar .badge--readonly')).not.toBeNull()
  })

  it('opens a compare tab and hands disconnect and settings to the app', async () => {
    const { api, root, onDisconnect, openSettings } = setup()
    await loaded(root)
    root.querySelector('.sidebar [data-action="compare"]').click()
    await vi.waitFor(() => expect(titles(root)).toEqual(['Parameters', 'Compare']))
    expect(api.connections.list).toHaveBeenCalled()
    root.querySelector('[data-action="disconnect"]').click()
    root.querySelector('.tabbar-row [aria-label="Settings"]').click()
    expect(onDisconnect).toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalled()
  })
})
