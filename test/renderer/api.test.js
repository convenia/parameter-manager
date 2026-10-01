import { describe, expect, it, vi } from 'vitest'
import { API } from '@shared/channels.js'
import { ApiError, createApi } from '../../src/renderer/api.js'

const makeBridge = (overrides = {}) =>
  Object.fromEntries(
    Object.entries(API).map(([group, methods]) => [
      group,
      Object.fromEntries(Object.keys(methods).map((m) => [m, overrides[`${group}.${m}`] ?? vi.fn(async () => ({ ok: true, data: null }))]))
    ])
  )

describe('createApi', () => {
  it('resolves with data and passes arguments through', async () => {
    const get = vi.fn(async () => ({ ok: true, data: { value: 'A=1' } }))
    const api = createApi(makeBridge({ 'ssm.get': get }))
    expect(await api.ssm.get('c1', '/a', { decrypt: true })).toEqual({ value: 'A=1' })
    expect(get).toHaveBeenCalledWith('c1', '/a', { decrypt: true })
  })

  it('throws ApiError with the error fields on ok: false', async () => {
    const api = createApi(makeBridge({ 'ssm.put': async () => ({ ok: false, error: { code: 'VersionConflict', message: 'changed', hint: 'reload', details: { currentVersion: 3 } } }) }))
    const err = await api.ssm.put('c1', {}).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'VersionConflict', message: 'changed', hint: 'reload', details: { currentVersion: 3 } })
  })

  it('wraps transport failures and malformed responses', async () => {
    const api = createApi(
      makeBridge({
        'app.info': async () => {
          throw new Error('IPC closed')
        },
        'settings.get': async () => 'nope'
      })
    )
    await expect(api.app.info()).rejects.toMatchObject({ code: 'Unknown', message: 'IPC closed' })
    await expect(api.settings.get()).rejects.toMatchObject({ code: 'Unknown', message: 'Unexpected response from settings.get.' })
  })

  it('fails fast when the bridge is missing or incomplete', () => {
    expect(() => createApi(undefined)).toThrow('window.vault is missing')
    const bridge = makeBridge()
    delete bridge.ssm.delete
    expect(() => createApi(bridge)).toThrow('window.vault.ssm.delete is missing')
  })
})
