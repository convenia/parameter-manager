import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createClients } from '../../src/main/clients.js'
import { createStore } from '../../src/main/store.js'

function setup() {
  const store = createStore(mkdtempSync(join(tmpdir(), 'vault-clients-')))
  store.saveSettings({ awsConfigFile: '/cfg', awsCredentialsFile: '/creds' })
  const conn = store.saveConnection({ name: 'Prod', profile: 'prod', region: 'sa-east-1' })
  const makeService = vi.fn((options) => ({ options }))
  return { store, conn, makeService, clients: createClients({ store, makeService }) }
}

describe('createClients', () => {
  it('builds one service per connection from its profile, region, and the AWS file settings', () => {
    const { conn, makeService, clients } = setup()
    const first = clients.forConnection(conn.id)
    expect(clients.forConnection(conn.id)).toBe(first)
    expect(makeService).toHaveBeenCalledTimes(1)
    expect(makeService).toHaveBeenCalledWith({ profile: 'prod', region: 'sa-east-1', configFile: '/cfg', credentialsFile: '/creds' })
  })

  it('drops cached services on invalidate and clear', () => {
    const { conn, makeService, clients } = setup()
    clients.forConnection(conn.id)
    clients.invalidate(conn.id)
    clients.forConnection(conn.id)
    clients.clear()
    clients.forConnection(conn.id)
    expect(makeService).toHaveBeenCalledTimes(3)
  })

  it('never caches draft services', () => {
    const { makeService, clients } = setup()
    clients.forDraft({ profile: 'p', region: 'us-east-1' })
    clients.forDraft({ profile: 'p', region: 'us-east-1' })
    expect(makeService).toHaveBeenCalledTimes(2)
  })

  it('returns the fake service for every connection in fake mode', () => {
    const { store, conn } = setup()
    const fakeService = { fake: true }
    const clients = createClients({ store, fakeService })
    expect(clients.forConnection(conn.id)).toBe(fakeService)
    expect(clients.forDraft({ profile: 'x', region: 'us-east-1' })).toBe(fakeService)
  })

  it('throws InvalidInput for an unknown connection', () => {
    expect(() => setup().clients.forConnection('missing')).toThrow('That connection no longer exists.')
  })
})
