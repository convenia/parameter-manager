// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { openSettings } from '../../src/renderer/views/settings.js'

const settings = { theme: 'system', autoDecrypt: true, maskValuesInDiff: true, awsConfigFile: '', awsCredentialsFile: '' }
const q = (selector) => document.querySelector(`.modal ${selector}`)
function makeApi(save = vi.fn(async (draft) => draft)) {
  return {
    settings: { get: vi.fn(async () => ({ ...settings })), save },
    profiles: { list: vi.fn(async () => ({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials', profiles: [] })) }
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('openSettings', () => {
  it('shows the current settings with the default AWS paths as placeholders', async () => {
    await openSettings({ api: makeApi() })
    expect(q('select[name="theme"]').value).toBe('system')
    expect(q('input[name="autoDecrypt"]').checked).toBe(true)
    expect(q('input[name="maskValuesInDiff"]').checked).toBe(true)
    expect(q('input[name="awsConfigFile"]').placeholder).toBe('/home/u/.aws/config')
  })

  it('saves the edited settings and reports them', async () => {
    const api = makeApi()
    const onSaved = vi.fn()
    await openSettings({ api, onSaved })
    const theme = q('select[name="theme"]')
    theme.value = 'dark'
    theme.dispatchEvent(new Event('change'))
    const auto = q('input[name="autoDecrypt"]')
    auto.checked = false
    auto.dispatchEvent(new Event('change'))
    const config = q('input[name="awsConfigFile"]')
    config.value = ' /tmp/aws-config '
    config.dispatchEvent(new Event('input'))
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.settings.save).toHaveBeenCalledWith({ ...settings, theme: 'dark', autoDecrypt: false, awsConfigFile: '/tmp/aws-config' })
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('stays open when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await openSettings({ api: makeApi(vi.fn(async () => Promise.reject(new Error('disk full')))) })
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(document.querySelector('.toast--error')).not.toBeNull())
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('returns null and toasts when settings cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = makeApi()
    api.settings.get = vi.fn(async () => Promise.reject(new Error('IPC closed')))
    expect(await openSettings({ api })).toBeNull()
    expect(document.querySelector('.toast--error').textContent).toContain('IPC closed')
  })
})
