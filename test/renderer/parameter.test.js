// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { createParameterTab } from '../../src/renderer/views/parameter.js'

const NAME = '/myapp/prod/env'
const ARN = 'arn:aws:ssm:sa-east-1:1:parameter/myapp/prod/env'
const meta = { name: NAME, type: 'SecureString', tier: 'Standard', dataType: 'text', version: 3, lastModifiedDate: '2026-09-03T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: 'Prod env', keyId: 'alias/aws/ssm', allowedPattern: null }
const historyEntry = (version, value) => ({ version, value, type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', lastModifiedDate: '2026-09-03T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', labels: [] })

// A tiny stateful backend: put bumps the version, get returns the latest value.
function backend(overrides = {}) {
  const stored = { value: 'A=1\nB=2', version: 3 }
  return {
    get: vi.fn(async (_c, _name, { decrypt }) => ({ name: NAME, type: 'SecureString', value: decrypt ? stored.value : null, version: stored.version, lastModifiedDate: '2026-09-03T00:00:00.000Z', dataType: 'text', arn: ARN })),
    tags: vi.fn(async () => [{ key: 'team', value: 'platform' }]),
    put: vi.fn(async (_c, input) => {
      stored.value = input.value
      stored.version += 1
      return { version: stored.version, tier: input.tier }
    }),
    delete: vi.fn(async () => ({ deleted: true })),
    history: vi.fn(async () => [historyEntry(3, 'A=1\nB=2'), historyEntry(2, 'A=0')]),
    ...overrides
  }
}

function setup({ readOnly = false, autoDecrypt = true, ...overrides } = {}) {
  const api = { ssm: backend(overrides) }
  const onChanged = vi.fn()
  const onDirtyChange = vi.fn()
  const tab = createParameterTab({ api, connection: { id: 'c1', name: 'Prod', readOnly }, meta, getSettings: () => ({ autoDecrypt, maskValuesInDiff: false }), onChanged, onDirtyChange })
  document.body.append(tab.el)
  tabs.push(tab)
  return { api, tab, onChanged, onDirtyChange }
}

const tabs = []
const view = (tab) => EditorView.findFromDOM(tab.el.querySelector('.cm-editor'))
const setText = (tab, text) => view(tab).dispatch({ changes: { from: 0, to: view(tab).state.doc.length, insert: text } })
const ready = (tab) => vi.waitFor(() => expect(tab.el.querySelector('.cm-editor')).not.toBeNull())
const modal = () => document.querySelector('.modal')
const inModal = (action) => document.querySelector(`.modal [data-action="${action}"]`)
const ctrlS = (tab) => view(tab).contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }))

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})
afterEach(() => tabs.splice(0).forEach((t) => t.destroy()))

describe('loading', () => {
  it('loads the decrypted value, tags, and overview', async () => {
    const { api, tab } = setup()
    await ready(tab)
    expect(api.ssm.get).toHaveBeenCalledWith('c1', NAME, { decrypt: true })
    expect(view(tab).state.doc.toString()).toBe('A=1\nB=2')
    expect(tab.el.querySelector('.overview').textContent).toContain(ARN)
    expect(tab.el.querySelector('.overview').textContent).toContain('team = platform')
    expect(tab.el.querySelector('.param__version').textContent).toBe('Version 3')
    expect(tab.isDirty()).toBe(false)
  })

  it('keeps an encrypted value hidden until "Decrypt & show"', async () => {
    const { api, tab } = setup({ autoDecrypt: false })
    await vi.waitFor(() => expect(tab.el.querySelector('[data-action="decrypt"]')).not.toBeNull())
    expect(tab.el.querySelector('.cm-editor')).toBeNull()
    expect(tab.el.querySelector('[data-action="save"]').disabled).toBe(true)
    tab.el.querySelector('[data-action="decrypt"]').click()
    await ready(tab)
    expect(api.ssm.get).toHaveBeenLastCalledWith('c1', NAME, { decrypt: true })
  })

  it('gives read-only connections no write actions and a read-only editor', async () => {
    const { tab } = setup({ readOnly: true })
    await ready(tab)
    expect(tab.el.querySelector('[data-action="save"]')).toBeNull()
    expect(tab.el.querySelector('[data-action="delete"]')).toBeNull()
    expect(view(tab).state.readOnly).toBe(true)
  })

  it('still loads when reading tags is not allowed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tags = vi.fn(async () => Promise.reject(Object.assign(new Error('Not allowed to read the tags of /myapp/prod/env.'), { code: 'AccessDenied' })))
    const { tab } = setup({ tags })
    await ready(tab)
    expect(document.querySelector('.toast--error').textContent).toContain('Could not load tags')
  })
})

describe('saving', () => {
  it('saves through the diff dialog with the loaded version and the metadata', async () => {
    const { api, tab, onChanged, onDirtyChange } = setup()
    await ready(tab)
    setText(tab, 'A=1\nB=3')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(modal()).not.toBeNull())
    expect([...modal().querySelectorAll('.diff__row')].map((r) => r.dataset.key)).toEqual(['B'])
    inModal('confirm').click()
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith({ type: 'saved', name: NAME, version: 4 }))
    expect(api.ssm.put).toHaveBeenCalledWith('c1', { name: NAME, value: 'A=1\nB=3', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: 'Prod env', dataType: 'text', allowedPattern: null, overwrite: true, expectedVersion: 3 })
    expect(tab.el.querySelector('.param__version').textContent).toBe('Version 4')
    expect(tab.isDirty()).toBe(false)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('opens one dialog and writes once, however often save is triggered', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, 'A=1\nB=3')
    ctrlS(tab)
    ctrlS(tab)
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(modal()).not.toBeNull())
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    inModal('confirm').click()
    await vi.waitFor(() => expect(tab.el.querySelector('.param__version').textContent).toBe('Version 4'))
    expect(api.ssm.put).toHaveBeenCalledTimes(1)
  })

  it('blocks an empty value before any dialog or AWS call', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, '')
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(document.querySelector('.toast').textContent).toContain('cannot be empty'))
    expect(modal()).toBeNull()
    expect(api.ssm.put).not.toHaveBeenCalled()
  })

  it('offers to overwrite after a version conflict', async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error(`${NAME} changed since you opened it: it is now at version 4, and you loaded version 3.`), { code: 'VersionConflict' }))
      .mockResolvedValueOnce({ version: 5, tier: 'Standard' })
    const { tab } = setup({ put })
    await ready(tab)
    setText(tab, 'A=9')
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(inModal('confirm')).not.toBeNull())
    inModal('confirm').click()
    await vi.waitFor(() => expect(inModal('overwrite')).not.toBeNull())
    inModal('overwrite').click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls[0][1].expectedVersion).toBe(3)
    expect(put.mock.calls[1][1]).not.toHaveProperty('expectedVersion')
  })

  it('requires an explicit tier upgrade for values over 4 KB on Standard', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, 'x'.repeat(5000))
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(inModal('confirm')).not.toBeNull())
    expect(inModal('confirm').disabled).toBe(true)
    const box = modal().querySelector('input[name="upgrade"]')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(inModal('confirm').disabled).toBe(false)
    inModal('confirm').click()
    await vi.waitFor(() => expect(api.ssm.put).toHaveBeenCalled())
    expect(api.ssm.put.mock.calls[0][1].tier).toBe('Advanced')
  })
})

describe('delete and restore', () => {
  it('deletes after typing the full name', async () => {
    const { api, tab, onChanged } = setup()
    await ready(tab)
    tab.el.querySelector('[data-action="delete"]').click()
    const input = await vi.waitFor(() => {
      const el = document.querySelector('.modal input')
      expect(el).not.toBeNull()
      return el
    })
    input.value = NAME
    input.dispatchEvent(new Event('input'))
    inModal('confirm').click()
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith({ type: 'deleted', name: NAME }))
    expect(api.ssm.delete).toHaveBeenCalledWith('c1', NAME)
  })

  it('restores an old version into the editor as unsaved changes', async () => {
    const { tab } = setup()
    await ready(tab)
    tab.el.querySelector('[data-subtab="history"]').click()
    await vi.waitFor(() => expect(tab.el.querySelector('[data-action="restore"]')).not.toBeNull())
    tab.el.querySelector('[data-action="restore"]').click()
    expect(view(tab).state.doc.toString()).toBe('A=0')
    expect(tab.isDirty()).toBe(true)
    expect(tab.el.querySelector('[data-subtab="value"]').classList.contains('is-active')).toBe(true)
  })
})
