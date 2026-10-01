import {
  DeleteParameterCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  ListTagsForResourceCommand,
  PutParameterCommand,
  SSMClient
} from '@aws-sdk/client-ssm'
import { fromIni } from '@aws-sdk/credential-providers'
import { versionConflictError } from './errors.js'

export function createSsmClient({ profile, region, configFile = '', credentialsFile = '' }) {
  return new SSMClient({
    region,
    maxAttempts: 6,
    retryMode: 'adaptive',
    credentials: fromIni({ profile, configFilepath: configFile || undefined, filepath: credentialsFile || undefined, ignoreCache: true })
  })
}

const iso = (date) => (date ? new Date(date).toISOString() : null)
const nameFilter = (prefix) => (prefix ? [{ Key: 'Name', Option: 'BeginsWith', Values: [prefix] }] : undefined)
const visible = (type, value, decrypt) => (type === 'SecureString' && !decrypt ? null : value)

export class SsmService {
  constructor(client) {
    this.client = client
  }

  async test(prefix = '') {
    await this.client.send(new DescribeParametersCommand({ MaxResults: 1, ParameterFilters: nameFilter(prefix) }))
    return { ok: true }
  }

  async list(prefix = '') {
    const rows = []
    let token
    do {
      // A fresh input object per page: the SDK paginators mutate theirs.
      const page = await this.client.send(new DescribeParametersCommand({ MaxResults: 50, ParameterFilters: nameFilter(prefix), NextToken: token }))
      for (const p of page.Parameters ?? []) rows.push(toMeta(p))
      token = page.NextToken
    } while (token)
    return rows
  }

  async get(name, { decrypt = false } = {}) {
    const { Parameter: p } = await this.client.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }))
    return {
      name: p.Name,
      type: p.Type,
      value: visible(p.Type, p.Value, decrypt),
      version: p.Version,
      lastModifiedDate: iso(p.LastModifiedDate),
      dataType: p.DataType ?? 'text',
      arn: p.ARN ?? null
    }
  }

  async tags(name) {
    const { TagList } = await this.client.send(new ListTagsForResourceCommand({ ResourceType: 'Parameter', ResourceId: name }))
    return (TagList ?? []).map((t) => ({ key: t.Key, value: t.Value }))
  }

  async history(name, { decrypt = false } = {}) {
    const entries = []
    let token
    do {
      const page = await this.client.send(new GetParameterHistoryCommand({ Name: name, WithDecryption: decrypt, MaxResults: 50, NextToken: token }))
      for (const h of page.Parameters ?? []) {
        entries.push({
          version: h.Version,
          value: visible(h.Type, h.Value, decrypt),
          type: h.Type,
          tier: h.Tier ?? 'Standard',
          keyId: h.KeyId ?? null,
          description: h.Description ?? '',
          lastModifiedDate: iso(h.LastModifiedDate),
          lastModifiedUser: h.LastModifiedUser ?? null,
          labels: h.Labels ?? []
        })
      }
      token = page.NextToken
    } while (token)
    return entries.sort((a, b) => b.version - a.version)
  }

  async put({ name, value, type, tier, keyId, description, dataType, allowedPattern, overwrite, expectedVersion }) {
    if (overwrite && expectedVersion != null) {
      const { Parameter } = await this.client.send(new GetParameterCommand({ Name: name, WithDecryption: false }))
      if (Parameter.Version !== expectedVersion) throw versionConflictError(name, Parameter.Version, expectedVersion)
    }
    // Pass KeyId/Description/DataType/AllowedPattern explicitly: an overwrite that omits
    // KeyId re-encrypts with the default key instead of the parameter's own.
    const res = await this.client.send(
      new PutParameterCommand({
        Name: name,
        Value: value,
        Type: type,
        Tier: tier,
        Overwrite: Boolean(overwrite),
        ...(type === 'SecureString' && keyId ? { KeyId: keyId } : {}),
        ...(description ? { Description: description } : {}),
        ...(dataType ? { DataType: dataType } : {}),
        ...(allowedPattern ? { AllowedPattern: allowedPattern } : {})
      })
    )
    return { version: res.Version, tier: res.Tier ?? tier }
  }

  async delete(name) {
    await this.client.send(new DeleteParameterCommand({ Name: name }))
    return { deleted: true }
  }
}

function toMeta(p) {
  return {
    name: p.Name,
    type: p.Type,
    tier: p.Tier ?? 'Standard',
    dataType: p.DataType ?? 'text',
    version: p.Version,
    lastModifiedDate: iso(p.LastModifiedDate),
    lastModifiedUser: p.LastModifiedUser ?? null,
    description: p.Description ?? '',
    keyId: p.KeyId ?? null,
    allowedPattern: p.AllowedPattern ?? null
  }
}
