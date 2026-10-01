// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHistoryPanel } from '../../src/renderer/views/history-panel.js'

const entry = (version, value, labels = []) => ({ version, value, type: 'String', tier: 'Standard', keyId: null, description: '', lastModifiedDate: `2026-09-0${version}T00:00:00.000Z`, lastModifiedUser: 'arn:aws:iam::1:user/leo', labels })
const entries = [entry(3, 'A=3'), entry(2, 'A=2\nB=1', ['stable']), entry(1, 'A=1')]

function mount({ current = { version: 3, value: 'A=3' }, canRestore = true, history = vi.fn(async () => entries) } = {}) {
  const api = { ssm: { history } }
  const onRestore = vi.fn()
  const panel = createHistoryPanel({ api, connection: { id: 'c1' }, name: '/a', canRestore, getSettings: () => ({ maskValuesInDiff: false }), getCurrent: () => current, onRestore })
  document.body.append(panel.el)
  return { api, panel, onRestore }
}
const items = (panel) => [...panel.el.querySelectorAll('.history__item')]

afterEach(() => document.body.replaceChildren())

describe('createHistoryPanel', () => {
  it('loads decrypted history, marks the current version, and preselects the previous one', async () => {
    const { api, panel } = mount()
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(api.ssm.history).toHaveBeenCalledWith('c1', '/a', { decrypt: true })
    expect(items(panel)[0].textContent).toContain('Current')
    expect(items(panel)[1].classList.contains('is-selected')).toBe(true)
    expect(items(panel)[1].textContent).toContain('stable')
    expect(panel.el.querySelector('.history__detail h3').textContent).toBe('Changes from version 2 to the current version (3)')
    expect([...panel.el.querySelectorAll('.diff__row')].map((r) => r.dataset.key)).toEqual(['A', 'B'])
  })

  it('restores the selected version through onRestore', async () => {
    const { panel, onRestore } = mount()
    await vi.waitFor(() => expect(panel.el.querySelector('[data-action="restore"]')).not.toBeNull())
    panel.el.querySelector('[data-action="restore"]').click()
    expect(onRestore).toHaveBeenCalledWith(entries[1])
  })

  it('hides restore on read-only connections', async () => {
    const { panel } = mount({ canRestore: false })
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(panel.el.querySelector('[data-action="restore"]')).toBeNull()
  })

  it('explains when the current version is selected', async () => {
    const { panel } = mount()
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    items(panel)[0].click()
    expect(panel.el.querySelector('.history__detail').textContent).toContain('Version 3 is the current version.')
  })

  it('asks to decrypt first while the value is encrypted', async () => {
    const history = vi.fn(async () => entries.map((e) => ({ ...e, value: null })))
    const { panel } = mount({ current: { version: 3, value: null }, history })
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(history).toHaveBeenCalledWith('c1', '/a', { decrypt: false })
    expect(panel.el.querySelector('.history__detail').textContent).toContain('Values are encrypted')
  })

  it('shows load errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { panel } = mount({ history: vi.fn(async () => Promise.reject(Object.assign(new Error('Not allowed to read the history of /a.'), { code: 'AccessDenied' }))) })
    await vi.waitFor(() => expect(panel.el.querySelector('.history__list').textContent).toContain('Not allowed to read the history of /a.'))
  })
})
