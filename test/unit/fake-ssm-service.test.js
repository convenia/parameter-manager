import { describe, expect, it } from 'vitest'
import { seedParameters } from '../../src/main/fake-seed.js'
import { FAKE_CONNECTIONS, FAKE_PROFILES, FakeSsmService } from '../../src/main/fake-ssm-service.js'

const now = () => new Date('2026-10-01T12:00:00.000Z')
const create = () => new FakeSsmService({ now })
const base = { type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', dataType: 'text', allowedPattern: null }

describe('seed data', () => {
  it('has 19 parameters covering every type, a root-level name, and a near-limit value', async () => {
    const rows = await create().list()
    expect(rows).toHaveLength(19)
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(['String', 'StringList', 'SecureString']))
    expect(rows.some((r) => !r.name.startsWith('/'))).toBe(true)
    const big = seedParameters().find((s) => s.name === '/myapp/prod/big-env').versions[0]
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(3900)
    expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(4096)
  })

  it('exposes demo profiles and connections', () => {
    expect(FAKE_PROFILES.map((p) => p.name)).toEqual(['demo', 'demo-readonly'])
    expect(FAKE_CONNECTIONS.map((c) => [c.id, c.readOnly, c.pathPrefix])).toEqual([['demo-all', false, ''], ['demo-prod', true, '/myapp/prod']])
  })
})

describe('reads', () => {
  it('lists sorted metadata filtered by prefix', async () => {
    const rows = await create().list('/myapp/prod')
    expect(rows.map((r) => r.name)).toEqual(['/myapp/prod/big-env', '/myapp/prod/config.json', '/myapp/prod/env', '/myapp/prod/feature-flags', '/myapp/prod/quoted-env'])
    expect(rows.find((r) => r.name === '/myapp/prod/env')).toMatchObject({ version: 3, type: 'SecureString', keyId: 'alias/aws/ssm' })
  })

  it('hides SecureString values unless decrypting, and builds an ARN', async () => {
    const fake = create()
    expect((await fake.get('/myapp/prod/env', { decrypt: false })).value).toBeNull()
    const value = await fake.get('/myapp/prod/env', { decrypt: true })
    expect(value.value).toContain('APP_ENV=prod')
    expect(value.arn).toBe('arn:aws:ssm:sa-east-1:000000000000:parameter/myapp/prod/env')
    expect((await fake.get('legacy-api-token', { decrypt: true })).arn).toBe('arn:aws:ssm:sa-east-1:000000000000:parameter/legacy-api-token')
  })

  it('returns tags and history newest first', async () => {
    const fake = create()
    expect(await fake.tags('/myapp/prod/env')).toEqual([{ key: 'team', value: 'platform' }, { key: 'environment', value: 'production' }])
    expect((await fake.history('/myapp/prod/env', { decrypt: true })).map((h) => h.version)).toEqual([3, 2, 1])
  })

  it('throws ParameterNotFound for unknown names', async () => {
    await expect(create().get('/nope')).rejects.toMatchObject({ name: 'ParameterNotFound' })
  })
})

describe('writes', () => {
  it('overwrites with a new version and keeps history', async () => {
    const fake = create()
    expect(await fake.put({ ...base, name: '/myapp/dev/env', value: 'A=1', overwrite: true, expectedVersion: 1 })).toMatchObject({ version: 2, tier: 'Standard', meta: { name: '/myapp/dev/env', version: 2 } })
    const history = await fake.history('/myapp/dev/env', { decrypt: true })
    expect(history.map((h) => [h.version, h.value.slice(0, 3)])).toEqual([[2, 'A=1'], [1, 'APP']])
    expect(history[0].lastModifiedDate).toBe('2026-10-01T12:00:00.000Z')
  })

  it('keeps the stored type, KMS key, and description when an overwrite sends stale metadata', async () => {
    const fake = new FakeSsmService({ now, seed: [{ name: '/x', type: 'SecureString', description: 'Current', versions: ['A=1'] }] })
    const { meta } = await fake.put({ name: '/x', value: 'A=2', type: 'String', tier: 'Standard', keyId: null, description: 'Stale', dataType: 'text', allowedPattern: null, overwrite: true, expectedVersion: 1 })
    expect(meta).toMatchObject({ type: 'SecureString', keyId: 'alias/aws/ssm', description: 'Current', version: 2 })
    expect((await fake.get('/x', { decrypt: false })).value).toBeNull()
  })

  it('keeps the existing description when an overwrite sends an empty one', async () => {
    const fake = create()
    await fake.put({ ...base, name: '/myapp/prod/env', value: 'A=1', overwrite: true })
    expect((await fake.list('/myapp/prod/env'))[0].description).toBe('Production .env for myapp')
  })

  it('creates new parameters and refuses to create over an existing one', async () => {
    const fake = create()
    expect(await fake.put({ ...base, type: 'String', name: '/new/param', value: 'x', overwrite: false })).toMatchObject({ version: 1, tier: 'Standard', meta: { type: 'String', version: 1 } })
    expect((await fake.get('/new/param')).value).toBe('x')
    await expect(fake.put({ ...base, name: '/new/param', value: 'y', overwrite: false })).rejects.toMatchObject({ name: 'ParameterAlreadyExists' })
  })

  it('detects version conflicts', async () => {
    await expect(create().put({ ...base, name: '/myapp/prod/env', value: 'A=1', overwrite: true, expectedVersion: 2 })).rejects.toMatchObject({ code: 'VersionConflict', details: { currentVersion: 3 } })
  })

  it('enforces tier limits and non-empty values like AWS, and never downgrades a tier', async () => {
    const fake = create()
    const big = 'x'.repeat(5000)
    await expect(fake.put({ ...base, name: '/myapp/dev/env', value: big, overwrite: true })).rejects.toMatchObject({ name: 'ValidationException' })
    expect(await fake.put({ ...base, name: '/myapp/dev/env', value: big, tier: 'Advanced', overwrite: true })).toMatchObject({ version: 2, tier: 'Advanced' })
    expect(await fake.put({ ...base, name: '/myapp/dev/env', value: 'A=1', tier: 'Standard', overwrite: true })).toMatchObject({ version: 3, tier: 'Advanced' })
    await expect(fake.put({ ...base, name: '/myapp/dev/env', value: '', tier: 'Advanced', overwrite: true })).rejects.toMatchObject({ name: 'ValidationException' })
  })

  it('deletes parameters', async () => {
    const fake = create()
    expect(await fake.delete('/infra/vpc/id')).toEqual({ deleted: true })
    await expect(fake.get('/infra/vpc/id')).rejects.toMatchObject({ name: 'ParameterNotFound' })
    await expect(fake.delete('/infra/vpc/id')).rejects.toMatchObject({ name: 'ParameterNotFound' })
  })
})
