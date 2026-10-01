import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { API, CHANNELS } from '@shared/channels.js'
import { createClients } from '../../src/main/clients.js'
import { AppError } from '../../src/main/errors.js'
import { FakeSsmService } from '../../src/main/fake-ssm-service.js'
import { createHandlers, registerIpc, wrap } from '../../src/main/ipc.js'
import { createStore } from '../../src/main/store.js'

const quiet = () => {}

function setup({ readOnly = false, pathPrefix = '' } = {}) {
  const store = createStore(mkdtempSync(join(tmpdir(), 'vault-ipc-')))
  const conn = store.saveConnection({ name: 'Demo', profile: 'demo', region: 'sa-east-1', readOnly, pathPrefix })
  const fake = new FakeSsmService()
  const clients = createClients({ store, fakeService: fake })
  vi.spyOn(clients, 'clear')
  vi.spyOn(clients, 'invalidate')
  const handlers = createHandlers({
    store,
    clients,
    fake: true,
    appVersion: '1.2.3',
    resolvePaths: () => ({ configPath: '/c', credentialsPath: '/k' }),
    listProfiles: async () => [{ name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false }]
  })
  const call = (channel, ...args) => wrap(handlers[channel], { log: quiet })(...args)
  return { store, conn, fake, clients, call }
}

const putInput = (overrides = {}) => ({ name: '/myapp/dev/env', value: 'A=1', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', dataType: 'text', overwrite: true, expectedVersion: 1, ...overrides })

describe('wrap', () => {
  it('returns ok envelopes and normalized errors', async () => {
    expect(await wrap(async () => 42, { log: quiet })()).toEqual({ ok: true, data: 42 })
    const failed = await wrap(() => {
      throw Object.assign(new Error('x'), { name: 'ThrottlingException' })
    }, { log: quiet })()
    expect(failed).toEqual({ ok: false, error: expect.objectContaining({ code: 'Throttled' }) })
  })

  it('reports credential errors for the connection so its client is rebuilt', async () => {
    const onCredentialError = vi.fn()
    const run = wrap(
      () => {
        throw Object.assign(new Error('expired'), { name: 'ExpiredTokenException' })
      },
      { contextOf: () => ({ connectionId: 'c1', profile: 'p' }), onCredentialError, log: quiet }
    )
    expect((await run()).error.code).toBe('ExpiredCredentials')
    expect(onCredentialError).toHaveBeenCalledWith('c1')
  })

  it('logs the code and name but never the value', async () => {
    const log = vi.fn()
    await wrap(() => {
      throw new AppError('InvalidInput', 'bad')
    }, { contextOf: () => ({ name: '/a' }), log })('secret-value')
    expect(log).toHaveBeenCalledWith('[ipc] InvalidInput /a: bad')
  })
})

describe('handlers', () => {
  it('app:info reports the version, fake flag, and load warnings once', async () => {
    const { store, call } = setup()
    store.warnings.push('settings.json was unreadable')
    expect((await call(API.app.info)).data).toEqual({ version: '1.2.3', fake: true, warnings: ['settings.json was unreadable'] })
    expect((await call(API.app.info)).data.warnings).toEqual([])
  })

  it('profiles:list returns the resolved paths with the profiles', async () => {
    const { call } = setup()
    expect((await call(API.profiles.list)).data).toEqual({ configPath: '/c', credentialsPath: '/k', profiles: [{ name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false }] })
  })

  it('ssm:list applies the connection path prefix', async () => {
    const { conn, call } = setup({ pathPrefix: '/billing' })
    const { data } = await call(API.ssm.list, conn.id)
    expect(data.length).toBeGreaterThan(0)
    expect(data.every((r) => r.name.startsWith('/billing'))).toBe(true)
  })

  it('ssm:get passes decrypt through as a strict boolean', async () => {
    const { conn, call } = setup()
    expect((await call(API.ssm.get, conn.id, '/myapp/dev/env', { decrypt: 'yes' })).data.value).toBeNull()
    expect((await call(API.ssm.get, conn.id, '/myapp/dev/env', { decrypt: true })).data.value).toContain('APP_ENV=dev')
  })

  it('ssm:put writes through and returns the new version', async () => {
    const { conn, call } = setup()
    expect(await call(API.ssm.put, conn.id, putInput())).toEqual({ ok: true, data: { version: 2, tier: 'Standard' } })
  })

  it('refuses writes on read-only connections and leaves data untouched', async () => {
    const { conn, fake, call } = setup({ readOnly: true })
    expect((await call(API.ssm.put, conn.id, putInput())).error.code).toBe('ReadOnlyConnection')
    expect((await call(API.ssm.delete, conn.id, '/myapp/dev/env')).error.code).toBe('ReadOnlyConnection')
    expect((await fake.get('/myapp/dev/env')).version).toBe(1)
  })

  it('validates put input before calling AWS', async () => {
    const { conn, call } = setup()
    const code = async (input) => (await call(API.ssm.put, conn.id, input)).error
    expect(await code(putInput({ value: '' }))).toMatchObject({ code: 'InvalidInput', message: 'The value cannot be empty.' })
    expect(await code(putInput({ type: 'Binary' }))).toMatchObject({ code: 'InvalidInput', message: 'Unknown parameter type "Binary".' })
    expect(await code(putInput({ tier: 'Gold' }))).toMatchObject({ code: 'InvalidInput', message: 'Unknown tier "Gold".' })
    expect(await code(putInput({ value: 'x'.repeat(4097) }))).toMatchObject({ code: 'InvalidInput', message: 'The value is 4097 bytes; the Standard tier allows 4096 bytes.' })
    expect(await code(putInput({ name: 'bad name', overwrite: false }))).toMatchObject({ code: 'InvalidInput', message: 'Only letters, numbers, and _ . - / are allowed' })
  })

  it('connections:test validates the draft first', async () => {
    const { call } = setup()
    expect((await call(API.connections.test, { name: 'x', profile: '', region: 'sa-east-1' })).error.message).toBe('Choose an AWS profile.')
    expect(await call(API.connections.test, { name: 'x', profile: 'demo', region: 'sa-east-1' })).toEqual({ ok: true, data: { ok: true } })
  })

  it('accepts a test draft without a name', async () => {
    const { call } = setup()
    expect((await call(API.connections.test, { profile: 'demo', region: 'sa-east-1' })).ok).toBe(true)
  })

  it('invalidates cached clients when connections or settings change', async () => {
    const { conn, clients, call } = setup()
    await call(API.connections.save, { ...conn, region: 'us-east-1' })
    expect(clients.invalidate).toHaveBeenCalledWith(conn.id)
    await call(API.settings.save, { theme: 'dark' })
    expect(clients.clear).toHaveBeenCalled()
  })

  it('rejects unknown connection ids', async () => {
    const { call } = setup()
    expect((await call(API.ssm.get, 'missing', '/a', {})).error).toMatchObject({ code: 'InvalidInput', message: 'That connection no longer exists.' })
  })
})

describe('registerIpc', () => {
  it('registers every channel and fails fast when a handler is missing', async () => {
    const { store, clients } = setup()
    const ipcMain = { handle: vi.fn() }
    const handlers = Object.fromEntries(CHANNELS.map((c) => [c, async () => c]))
    registerIpc(ipcMain, { handlers, store, clients, log: quiet })
    expect(ipcMain.handle.mock.calls.map(([channel]) => channel)).toEqual([...CHANNELS])
    const [, listener] = ipcMain.handle.mock.calls[0]
    expect(await listener({}, 'arg')).toEqual({ ok: true, data: CHANNELS[0] })

    delete handlers[API.ssm.put]
    expect(() => registerIpc({ handle: vi.fn() }, { handlers, store, clients })).toThrow('Missing IPC handler for ssm:put')
  })
})
