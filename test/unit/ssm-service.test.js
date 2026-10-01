import {
  DeleteParameterCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  ListTagsForResourceCommand,
  PutParameterCommand,
  SSMClient
} from '@aws-sdk/client-ssm'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { SsmService, createSsmClient } from '../../src/main/ssm-service.js'

const client = new SSMClient({ region: 'sa-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const ssm = mockClient(client)
const service = new SsmService(client)
const inputs = (Command) => ssm.commandCalls(Command).map((call) => call.args[0].input)

beforeEach(() => ssm.reset())

describe('list', () => {
  it('follows NextToken through every page and maps the console fields', async () => {
    ssm
      .on(DescribeParametersCommand)
      .resolvesOnce({
        Parameters: [
          {
            Name: '/a',
            Type: 'SecureString',
            Tier: 'Standard',
            DataType: 'text',
            Version: 3,
            LastModifiedDate: new Date('2026-09-01T10:00:00Z'),
            LastModifiedUser: 'arn:aws:iam::1:user/leo',
            Description: 'A',
            KeyId: 'alias/aws/ssm'
          }
        ],
        NextToken: 'page-2'
      })
      .resolvesOnce({ Parameters: [{ Name: '/b', Type: 'String', Version: 1 }] })

    expect(await service.list('')).toEqual([
      { name: '/a', type: 'SecureString', tier: 'Standard', dataType: 'text', version: 3, lastModifiedDate: '2026-09-01T10:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: 'A', keyId: 'alias/aws/ssm', allowedPattern: null },
      { name: '/b', type: 'String', tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: null, lastModifiedUser: null, description: '', keyId: null, allowedPattern: null }
    ])
    expect(inputs(DescribeParametersCommand)).toEqual([
      { MaxResults: 50, ParameterFilters: undefined, NextToken: undefined },
      { MaxResults: 50, ParameterFilters: undefined, NextToken: 'page-2' }
    ])
  })

  it('filters by the connection path prefix', async () => {
    ssm.on(DescribeParametersCommand).resolves({ Parameters: [] })
    await service.list('/myapp')
    expect(inputs(DescribeParametersCommand)[0].ParameterFilters).toEqual([{ Key: 'Name', Option: 'BeginsWith', Values: ['/myapp'] }])
  })
})

describe('get', () => {
  it('returns the decrypted value and ARN when asked to decrypt', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Value: 'A=1', Version: 2, LastModifiedDate: new Date('2026-09-01T10:00:00Z'), DataType: 'text', ARN: 'arn:aws:ssm:sa-east-1:1:parameter/a' } })
    expect(await service.get('/a', { decrypt: true })).toEqual({ name: '/a', type: 'SecureString', value: 'A=1', version: 2, lastModifiedDate: '2026-09-01T10:00:00.000Z', dataType: 'text', arn: 'arn:aws:ssm:sa-east-1:1:parameter/a' })
    expect(inputs(GetParameterCommand)).toEqual([{ Name: '/a', WithDecryption: true }])
  })

  it('hides the ciphertext of a SecureString read without decryption', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Value: 'AQICAHh...', Version: 2 } })
    expect((await service.get('/a', { decrypt: false })).value).toBeNull()
  })
})

describe('tags and history', () => {
  it('lists tags for the parameter resource', async () => {
    ssm.on(ListTagsForResourceCommand).resolves({ TagList: [{ Key: 'team', Value: 'platform' }] })
    expect(await service.tags('/a')).toEqual([{ key: 'team', value: 'platform' }])
    expect(inputs(ListTagsForResourceCommand)).toEqual([{ ResourceType: 'Parameter', ResourceId: '/a' }])
  })

  it('pages through history, newest first, hiding undecrypted SecureString values', async () => {
    ssm
      .on(GetParameterHistoryCommand)
      .resolvesOnce({ Parameters: [{ Version: 1, Type: 'SecureString', Value: 'c1', Labels: ['old'] }], NextToken: 'n' })
      .resolvesOnce({ Parameters: [{ Version: 2, Type: 'SecureString', Value: 'c2', LastModifiedUser: 'arn:aws:iam::1:user/leo' }] })
    const history = await service.history('/a', { decrypt: false })
    expect(history.map((h) => [h.version, h.value, h.labels])).toEqual([[2, null, []], [1, null, ['old']]])
    expect(history[0].lastModifiedUser).toBe('arn:aws:iam::1:user/leo')
    expect(inputs(GetParameterHistoryCommand).map((i) => i.NextToken)).toEqual([undefined, 'n'])
  })
})

describe('put', () => {
  const update = { name: '/a', value: 'A=2', type: 'SecureString', tier: 'Standard', keyId: 'alias/custom', description: 'Prod env', dataType: 'text', allowedPattern: null, overwrite: true, expectedVersion: 4 }

  it('checks the version, then overwrites, keeping type, KMS key, and description', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Version: 4 } })
    ssm.on(PutParameterCommand).resolves({ Version: 5, Tier: 'Standard' })
    expect(await service.put(update)).toEqual({ version: 5, tier: 'Standard' })
    expect(inputs(GetParameterCommand)).toEqual([{ Name: '/a', WithDecryption: false }])
    expect(inputs(PutParameterCommand)).toEqual([{ Name: '/a', Value: 'A=2', Type: 'SecureString', Tier: 'Standard', Overwrite: true, KeyId: 'alias/custom', Description: 'Prod env', DataType: 'text' }])
  })

  it('throws VersionConflict without writing when the version moved', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Version: 5 } })
    await expect(service.put(update)).rejects.toMatchObject({ code: 'VersionConflict', details: { currentVersion: 5 } })
    expect(inputs(PutParameterCommand)).toEqual([])
  })

  it('creates without a version check and omits empty optional fields', async () => {
    ssm.on(PutParameterCommand).resolves({ Version: 1 })
    await service.put({ name: '/new', value: 'x', type: 'String', tier: 'Standard', keyId: 'alias/ignored', description: '', dataType: 'text', allowedPattern: null, overwrite: false, expectedVersion: null })
    expect(inputs(GetParameterCommand)).toEqual([])
    expect(inputs(PutParameterCommand)).toEqual([{ Name: '/new', Value: 'x', Type: 'String', Tier: 'Standard', Overwrite: false, DataType: 'text' }])
  })

  it('keeps an allowed pattern on overwrite', async () => {
    ssm.on(PutParameterCommand).resolves({ Version: 2 })
    await service.put({ ...update, type: 'String', allowedPattern: '^[a-z]+$', expectedVersion: null })
    expect(inputs(PutParameterCommand)[0].AllowedPattern).toBe('^[a-z]+$')
  })
})

describe('delete and test', () => {
  it('deletes by name', async () => {
    ssm.on(DeleteParameterCommand).resolves({})
    expect(await service.delete('/a')).toEqual({ deleted: true })
    expect(inputs(DeleteParameterCommand)).toEqual([{ Name: '/a' }])
  })

  it('tests access with a one-item DescribeParameters', async () => {
    ssm.on(DescribeParametersCommand).resolves({ Parameters: [] })
    expect(await service.test('/myapp')).toEqual({ ok: true })
    expect(inputs(DescribeParametersCommand)[0]).toMatchObject({ MaxResults: 1, ParameterFilters: [{ Key: 'Name', Option: 'BeginsWith', Values: ['/myapp'] }] })
  })
})

describe('createSsmClient', () => {
  it('builds a client for the region with adaptive retries', async () => {
    const value = (v) => (typeof v === 'function' ? v() : v)
    const created = createSsmClient({ profile: 'prod', region: 'eu-west-1' })
    expect(await value(created.config.region)).toBe('eu-west-1')
    expect(await value(created.config.maxAttempts)).toBe(6)
    expect(await value(created.config.retryMode)).toBe('adaptive')
  })
})
