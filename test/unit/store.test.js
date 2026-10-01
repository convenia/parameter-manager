import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings.js'
import { createStore } from '../../src/main/store.js'

let dir
let counter = 0
const fixedNow = () => new Date('2026-10-01T12:00:00.000Z')
const open = (options = {}) => createStore(dir, { now: fixedNow, newId: () => `c_${++counter}`, ...options })
const errorOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected an error')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vault-store-'))
})

describe('settings', () => {
  it('starts with the defaults', () => {
    expect(open().getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('saves, drops unknown keys, and survives a reload', () => {
    open().saveSettings({ theme: 'dark', autoDecrypt: false, bogus: 1 })
    expect(open().getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', autoDecrypt: false })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).not.toHaveProperty('bogus')
  })

  it('replaces invalid values with defaults', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'neon', maskValuesInDiff: 'yes', awsConfigFile: 42 }))
    expect(open().getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('moves a corrupt file aside and reports it', () => {
    writeFileSync(join(dir, 'settings.json'), '{ not json')
    const store = open()
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(store.warnings).toHaveLength(1)
    expect(store.warnings[0]).toMatch(/settings\.json was unreadable/)
    expect(readdirSync(dir)).toContain(`settings.json.corrupt-${fixedNow().getTime()}`)
  })

  it('writes atomically without leaving temp files behind', () => {
    open().saveSettings({ theme: 'light' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('connections', () => {
  const input = { name: ' Prod ', profile: 'default', region: 'sa-east-1', pathPrefix: ' /myapp ', color: 'green', readOnly: true }

  it('creates a connection with an id and timestamp, trimming text', () => {
    const saved = open().saveConnection(input)
    expect(saved).toEqual({
      id: expect.stringMatching(/^c_\d+$/),
      name: 'Prod',
      profile: 'default',
      region: 'sa-east-1',
      pathPrefix: '/myapp',
      color: 'green',
      readOnly: true,
      createdAt: '2026-10-01T12:00:00.000Z'
    })
    expect(open().listConnections()).toEqual([saved])
  })

  it('updates an existing connection in place, keeping id and createdAt', () => {
    const store = open()
    const saved = store.saveConnection(input)
    const updated = store.saveConnection({ ...saved, name: 'Production', readOnly: false, createdAt: 'ignored' })
    expect(updated).toEqual({ ...saved, name: 'Production', readOnly: false })
    expect(store.listConnections()).toHaveLength(1)
  })

  it('deletes connections', () => {
    const store = open()
    const saved = store.saveConnection(input)
    store.deleteConnection(saved.id)
    expect(open().listConnections()).toEqual([])
  })

  it('rejects connections without a name, profile, or valid region', () => {
    const store = open()
    expect(errorOf(() => store.saveConnection({ ...input, name: '  ' }))).toMatchObject({ code: 'InvalidInput', message: 'Connection name is required.' })
    expect(errorOf(() => store.saveConnection({ ...input, profile: '' })).message).toBe('Choose an AWS profile.')
    expect(errorOf(() => store.saveConnection({ ...input, region: '' })).message).toBe('Region is required.')
    expect(errorOf(() => store.saveConnection({ ...input, region: 'mars-1' })).message).toBe('"mars-1" is not a valid AWS region.')
  })

  it('normalizes unknown colors and non-boolean readOnly', () => {
    const saved = open().saveConnection({ ...input, color: 'chartreuse', readOnly: 'yes' })
    expect(saved.color).toBe('none')
    expect(saved.readOnly).toBe(false)
  })

  it('throws InvalidInput for unknown ids', () => {
    expect(errorOf(() => open().getConnection('nope'))).toMatchObject({ code: 'InvalidInput', message: 'That connection no longer exists.' })
  })

  it('seeds connections only when no connections file exists yet', () => {
    const seed = [{ id: 'demo', ...input }]
    expect(open({ seedConnections: seed }).listConnections().map((c) => c.id)).toEqual(['demo'])
    open().deleteConnection('demo')
    expect(open({ seedConnections: seed }).listConnections()).toEqual([])
  })

  it('skips invalid stored connections and reports them', () => {
    writeFileSync(join(dir, 'connections.json'), JSON.stringify({ version: 1, connections: [{ id: 'bad', name: '' }, { id: 'ok', ...input }] }))
    const store = open()
    expect(store.listConnections().map((c) => c.id)).toEqual(['ok'])
    expect(store.warnings[0]).toMatch(/Skipped a saved connection/)
  })
})
