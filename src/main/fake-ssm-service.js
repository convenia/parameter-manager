import { byteLength, tierLimit } from '@shared/names.js'
import { versionConflictError } from './errors.js'
import { seedParameters } from './fake-seed.js'

const ACCOUNT = '000000000000'
const DEMO_USER = `arn:aws:iam::${ACCOUNT}:user/demo`
const SEED_START = Date.UTC(2026, 8, 1, 12, 0, 0)
const DAY = 86_400_000

export const FAKE_PROFILES = Object.freeze([
  { name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false },
  { name: 'demo-readonly', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false }
])

export const FAKE_CONNECTIONS = Object.freeze([
  { id: 'demo-all', name: 'Demo — all parameters', profile: 'demo', region: 'sa-east-1', pathPrefix: '', color: 'green', readOnly: false },
  { id: 'demo-prod', name: 'Demo — production (read-only)', profile: 'demo-readonly', region: 'sa-east-1', pathPrefix: '/myapp/prod', color: 'red', readOnly: true }
])

// Errors carry the AWS SDK error names so errors.js maps them exactly like real ones.
const awsError = (name, message) => Object.assign(new Error(message), { name })

export class FakeSsmService {
  #params = new Map()
  #now
  #delayMs
  #region

  constructor({ seed = seedParameters(), now = () => new Date(), delayMs = 0, region = 'sa-east-1' } = {}) {
    this.#now = now
    this.#delayMs = delayMs
    this.#region = region
    seed.forEach((s, index) => {
      this.#params.set(s.name, {
        name: s.name,
        type: s.type,
        tier: s.tier ?? 'Standard',
        dataType: 'text',
        keyId: s.type === 'SecureString' ? 'alias/aws/ssm' : null,
        description: s.description ?? '',
        allowedPattern: null,
        tags: s.tags ?? [],
        versions: s.versions.map((value, v) => ({
          version: v + 1,
          value,
          lastModifiedDate: new Date(SEED_START + (index * 3 + v) * DAY).toISOString(),
          lastModifiedUser: DEMO_USER,
          labels: []
        }))
      })
    })
  }

  async test() {
    await this.#wait()
    return { ok: true }
  }

  async list(prefix = '') {
    await this.#wait()
    return [...this.#params.values()]
      .filter((p) => p.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => this.#meta(p))
  }

  async get(name, { decrypt = false } = {}) {
    await this.#wait()
    const p = this.#require(name)
    const latest = p.versions.at(-1)
    return { name, type: p.type, value: visible(p.type, latest.value, decrypt), version: latest.version, lastModifiedDate: latest.lastModifiedDate, dataType: p.dataType, arn: this.#arn(name) }
  }

  async tags(name) {
    await this.#wait()
    return this.#require(name).tags.map((t) => ({ ...t }))
  }

  async history(name, { decrypt = false } = {}) {
    await this.#wait()
    const p = this.#require(name)
    return p.versions
      .map((v) => ({ version: v.version, value: visible(p.type, v.value, decrypt), type: p.type, tier: p.tier, keyId: p.keyId, description: p.description, lastModifiedDate: v.lastModifiedDate, lastModifiedUser: v.lastModifiedUser, labels: [...v.labels] }))
      .reverse()
  }

  async put({ name, value, type, tier = 'Standard', keyId, description, dataType, allowedPattern, overwrite, expectedVersion }) {
    await this.#wait()
    const existing = this.#params.get(name)
    if (existing && !overwrite) {
      throw awsError('ParameterAlreadyExists', 'The parameter already exists. To overwrite this value, set the overwrite option in the request to true.')
    }
    const current = existing?.versions.at(-1)
    if (existing && expectedVersion != null && current.version !== expectedVersion) throw versionConflictError(name, current.version, expectedVersion)
    if (!value) throw awsError('ValidationException', "1 validation error detected: Value at 'value' failed to satisfy constraint: Member must have length greater than or equal to 1")
    // Same contract as SsmService: an overwrite keeps the stored metadata and never lowers the tier.
    const writtenTier = existing && (existing.tier === 'Advanced' || tier === 'Advanced') ? 'Advanced' : tier
    if (byteLength(value) > tierLimit(writtenTier)) throw awsError('ValidationException', `Parameter value exceeds the maximum size for the ${writtenTier} tier (${tierLimit(writtenTier)} bytes).`)

    const record = existing ?? {
      name,
      tags: [],
      type,
      dataType: dataType || 'text',
      keyId: type === 'SecureString' ? keyId || 'alias/aws/ssm' : null,
      description: description || '',
      allowedPattern: allowedPattern ?? null,
      versions: []
    }
    record.tier = writtenTier
    const version = (current?.version ?? 0) + 1
    record.versions.push({ version, value, lastModifiedDate: this.#now().toISOString(), lastModifiedUser: DEMO_USER, labels: [] })
    this.#params.set(name, record)
    return { version, tier: writtenTier, meta: this.#meta(record) }
  }

  async delete(name) {
    await this.#wait()
    this.#require(name)
    this.#params.delete(name)
    return { deleted: true }
  }

  #meta(p) {
    const latest = p.versions.at(-1)
    return { name: p.name, type: p.type, tier: p.tier, dataType: p.dataType, version: latest.version, lastModifiedDate: latest.lastModifiedDate, lastModifiedUser: latest.lastModifiedUser, description: p.description, keyId: p.keyId, allowedPattern: p.allowedPattern }
  }

  #require(name) {
    const p = this.#params.get(name)
    if (!p) throw awsError('ParameterNotFound', `Parameter ${name} not found.`)
    return p
  }

  #arn(name) {
    return `arn:aws:ssm:${this.#region}:${ACCOUNT}:parameter${name.startsWith('/') ? '' : '/'}${name}`
  }

  async #wait() {
    if (this.#delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#delayMs))
  }
}

function visible(type, value, decrypt) {
  return type === 'SecureString' && !decrypt ? null : value
}
