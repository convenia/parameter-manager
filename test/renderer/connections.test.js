// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { renderConnectionsScreen } from '../../src/renderer/views/connections.js'

const saved = [
  { id: 'c1', name: 'Prod', profile: 'default', region: 'sa-east-1', pathPrefix: '/myapp/prod', color: 'red', readOnly: true, createdAt: 'x' },
  { id: 'c2', name: 'Staging', profile: 'staging', region: 'us-east-1', pathPrefix: '', color: 'green', readOnly: false, createdAt: 'y' }
]
const profiles = [
  { name: 'default', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false },
  { name: 'staging', region: 'us-east-1', sources: ['config'], sso: false },
  { name: 'sso-dev', region: 'us-west-2', sources: ['config'], sso: true }
]

function setup({ connections = saved, profileList = profiles } = {}) {
  let store = connections.map((c) => ({ ...c }))
  const api = {
    connections: {
      list: vi.fn(async () => store.map((c) => ({ ...c }))),
      save: vi.fn(async (draft) => {
        const conn = { ...draft, id: draft.id ?? 'c_new', name: draft.name.trim(), createdAt: 'z' }
        store = store.some((c) => c.id === conn.id) ? store.map((c) => (c.id === conn.id ? conn : c)) : [...store, conn]
        return conn
      }),
      delete: vi.fn(async (id) => {
        store = store.filter((c) => c.id !== id)
        return { deleted: true }
      }),
      test: vi.fn(async () => ({ ok: true }))
    },
    profiles: { list: vi.fn(async () => ({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials', profiles: profileList })) }
  }
  const root = document.createElement('div')
  document.body.append(root)
  const onConnect = vi.fn()
  const openSettings = vi.fn()
  renderConnectionsScreen(root, { api, onConnect, openSettings })
  return { api, root, onConnect, openSettings }
}
const items = (root) => [...root.querySelectorAll('.connection-item')]
const input = (root, name) => root.querySelector(`[name="${name}"]`)
const action = (root, id) => root.querySelector(`[data-action="${id}"]`)
const type = (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('input'))
}
const choose = (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('change'))
}
const ready = (root) => vi.waitFor(() => expect(items(root)).toHaveLength(2))

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('renderConnectionsScreen', () => {
  it('lists saved connections and edits the first one', async () => {
    const { root } = setup()
    await ready(root)
    expect(items(root).map((li) => li.querySelector('.connection-item__name').textContent)).toEqual(['Prod', 'Staging'])
    expect(items(root)[0].classList.contains('is-selected')).toBe(true)
    expect(items(root)[0].querySelector('.badge--readonly')).not.toBeNull()
    expect(input(root, 'name').value).toBe('Prod')
    expect(input(root, 'profile').value).toBe('default')
    expect(input(root, 'pathPrefix').value).toBe('/myapp/prod')
    expect(input(root, 'readOnly').checked).toBe(true)
    expect(root.querySelector('h1').textContent).toBe('Edit connection')
  })

  it('starts a new connection with the first profile and its region', async () => {
    const { root } = setup()
    await ready(root)
    action(root, 'new').click()
    expect(root.querySelector('h1').textContent).toBe('New connection')
    expect(input(root, 'name').value).toBe('')
    expect(input(root, 'profile').value).toBe('default')
    expect(input(root, 'region').value).toBe('sa-east-1')
    expect(action(root, 'connect').textContent).toBe('Save & connect')
  })

  it("updates the region when the profile changes, unless the user typed one", async () => {
    const { root } = setup()
    await ready(root)
    action(root, 'new').click()
    choose(input(root, 'profile'), 'sso-dev')
    expect(input(root, 'region').value).toBe('us-west-2')
    type(input(root, 'region'), 'eu-west-1')
    choose(input(root, 'profile'), 'staging')
    expect(input(root, 'region').value).toBe('eu-west-1')
  })

  it('saves edits and keeps the saved connection selected', async () => {
    const { api, root } = setup()
    await ready(root)
    type(input(root, 'name'), 'Production')
    root.querySelector('.color-swatch[data-color="blue"]').click()
    action(root, 'save').click()
    await vi.waitFor(() => expect(items(root)[0].querySelector('.connection-item__name').textContent).toBe('Production'))
    expect(api.connections.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'Production', color: 'blue' }))
    expect(items(root)[0].classList.contains('is-selected')).toBe(true)
  })

  it('connects without saving when nothing changed, and saves first otherwise', async () => {
    const { api, root, onConnect } = setup()
    await ready(root)
    action(root, 'connect').click()
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith(saved[0]))
    expect(api.connections.save).not.toHaveBeenCalled()

    items(root)[1].click()
    type(input(root, 'pathPrefix'), '/billing')
    action(root, 'connect').click()
    await vi.waitFor(() => expect(onConnect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c2', pathPrefix: '/billing' })))
    expect(api.connections.save).toHaveBeenCalledTimes(1)
  })

  it('connects on double click', async () => {
    const { root, onConnect } = setup()
    await ready(root)
    items(root)[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith(saved[1]))
  })

  it('tests the draft connection and reports success', async () => {
    const { api, root } = setup()
    await ready(root)
    action(root, 'test').click()
    await vi.waitFor(() => expect(document.querySelector('.toast--success')).not.toBeNull())
    expect(api.connections.test).toHaveBeenCalledWith(expect.objectContaining({ profile: 'default', region: 'sa-east-1', pathPrefix: '/myapp/prod' }))
  })

  it('deletes a connection after confirmation', async () => {
    const { api, root } = setup()
    await ready(root)
    action(root, 'delete').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="confirm"]').click()
    await vi.waitFor(() => expect(items(root)).toHaveLength(1))
    expect(api.connections.delete).toHaveBeenCalledWith('c1')
  })

  it('warns when no AWS profiles exist and shows the checked paths', async () => {
    const { root } = setup({ connections: [], profileList: [] })
    await vi.waitFor(() => expect(root.querySelector('.callout--warning')).not.toBeNull())
    expect(root.querySelector('.callout--warning').textContent).toContain('/home/u/.aws/credentials')
    expect(root.querySelector('.connection-list').textContent).toContain('No saved connections yet.')
  })

  it('opens settings', async () => {
    const { root, openSettings } = setup()
    await ready(root)
    action(root, 'settings').click()
    expect(openSettings).toHaveBeenCalled()
  })
})
