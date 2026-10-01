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
    let fields = { type, tier, keyId, description, dataType, allowedPattern }
    if (overwrite) {
      // The caller's metadata may come from a list loaded before someone changed the
      // parameter, so the stored metadata wins: an overwrite only ever changes the value
      // (and may raise the tier to Advanced).
      const stored = await describeOne(this.client, name)
      if (!stored) throw Object.assign(new Error(`Parameter ${name} not found.`), { name: 'ParameterNotFound' })
      if (expectedVersion != null && stored.version !== expectedVersion) throw versionConflictError(name, stored.version, expectedVersion)
      fields = { ...stored, tier: stored.tier === 'Advanced' || tier === 'Advanced' ? 'Advanced' : 'Standard' }
    }
    // Pass KeyId/Description/DataType/AllowedPattern explicitly: an overwrite that omits
    // KeyId re-encrypts with the default key instead of the parameter's own.
    const res = await this.client.send(
      new PutParameterCommand({
        Name: name,
        Value: value,
        Type: fields.type,
        Tier: fields.tier,
        Overwrite: Boolean(overwrite),
        ...(fields.type === 'SecureString' && fields.keyId ? { KeyId: fields.keyId } : {}),
        ...(fields.description ? { Description: fields.description } : {}),
        ...(fields.dataType ? { DataType: fields.dataType } : {}),
        ...(fields.allowedPattern ? { AllowedPattern: fields.allowedPattern } : {})
      })
    )
    const version = res.Version
    const writtenTier = res.Tier ?? fields.tier
    // Fresh metadata for the list row; DescribeParameters can briefly lag behind the write.
    const after = await describeOne(this.client, name)
    const meta = after && after.version >= version ? after : { ...toMeta({ Name: name, Type: fields.type, Tier: writtenTier, DataType: fields.dataType, KeyId: fields.keyId, Description: fields.description, AllowedPattern: fields.allowedPattern }), ...after, version, tier: writtenTier }
    return { version, tier: writtenTier, meta }
  }

  async delete(name) {
    await this.client.send(new DeleteParameterCommand({ Name: name }))
    return { deleted: true }
  }
}

// DescribeParameters with a Name/Equals filter can still return empty pages with a NextToken.
async function describeOne(client, name) {
  let token
  do {
    const page = await client.send(new DescribeParametersCommand({ MaxResults: 50, ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: [name] }], NextToken: token }))
    const found = (page.Parameters ?? []).find((p) => p.Name === name)
    if (found) return toMeta(found)
    token = page.NextToken
  } while (token)
  return null
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
