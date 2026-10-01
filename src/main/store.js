import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CONNECTION_COLORS, DEFAULT_SETTINGS, THEMES } from '@shared/settings.js'
import { AppError } from './errors.js'

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/

export function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {}
  const bool = (key) => (typeof src[key] === 'boolean' ? src[key] : DEFAULT_SETTINGS[key])
  const path = (key) => (typeof src[key] === 'string' ? src[key].trim() : DEFAULT_SETTINGS[key])
  return {
    theme: THEMES.includes(src.theme) ? src.theme : DEFAULT_SETTINGS.theme,
    autoDecrypt: bool('autoDecrypt'),
    maskValuesInDiff: bool('maskValuesInDiff'),
    awsConfigFile: path('awsConfigFile'),
    awsCredentialsFile: path('awsCredentialsFile')
  }
}

export function sanitizeConnection(input, id, createdAt) {
  const src = input && typeof input === 'object' ? input : {}
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const connection = {
    id,
    name: text(src.name),
    profile: text(src.profile),
    region: text(src.region),
    pathPrefix: text(src.pathPrefix),
    color: CONNECTION_COLORS.includes(src.color) ? src.color : 'none',
    readOnly: src.readOnly === true,
    createdAt
  }
  if (!connection.name) throw new AppError('InvalidInput', 'Connection name is required.')
  if (!connection.profile) throw new AppError('InvalidInput', 'Choose an AWS profile.')
  if (!connection.region) throw new AppError('InvalidInput', 'Region is required.')
  if (!REGION.test(connection.region)) throw new AppError('InvalidInput', `"${connection.region}" is not a valid AWS region.`)
  return connection
}

export function createStore(dir, { now = () => new Date(), newId = () => `c_${randomBytes(6).toString('hex')}`, seedConnections = [] } = {}) {
  mkdirSync(dir, { recursive: true })
  const settingsFile = join(dir, 'settings.json')
  const connectionsFile = join(dir, 'connections.json')
  const warnings = []

  let settings = sanitizeSettings(readJson(settingsFile, {}))
  const stored = readJson(connectionsFile, null)
  let connections = stored === null ? seed() : load(stored)
  if (stored === null && connections.length > 0) persistConnections()

  return {
    warnings,
    getSettings: () => ({ ...settings }),
    saveSettings(input) {
      settings = sanitizeSettings({ ...settings, ...input })
      writeJsonAtomic(settingsFile, settings)
      return { ...settings }
    },
    listConnections: () => connections.map((c) => ({ ...c })),
    getConnection(id) {
      const found = connections.find((c) => c.id === id)
      if (!found) throw new AppError('InvalidInput', 'That connection no longer exists.')
      return { ...found }
    },
    saveConnection(input) {
      const existing = input?.id ? connections.find((c) => c.id === input.id) : null
      const saved = sanitizeConnection(input, existing?.id ?? newId(), existing?.createdAt ?? now().toISOString())
      connections = existing ? connections.map((c) => (c.id === saved.id ? saved : c)) : [...connections, saved]
      persistConnections()
      return { ...saved }
    },
    deleteConnection(id) {
      connections = connections.filter((c) => c.id !== id)
      persistConnections()
    }
  }

  function seed() {
    return seedConnections.map((c) => sanitizeConnection(c, c.id ?? newId(), c.createdAt ?? now().toISOString()))
  }

  function load(data) {
    const list = Array.isArray(data?.connections) ? data.connections : []
    return list.flatMap((c) => {
      try {
        return [sanitizeConnection(c, typeof c?.id === 'string' ? c.id : newId(), typeof c?.createdAt === 'string' ? c.createdAt : now().toISOString())]
      } catch (err) {
        warnings.push(`Skipped a saved connection that is no longer valid (${err.message})`)
        return []
      }
    })
  }

  function persistConnections() {
    writeJsonAtomic(connectionsFile, { version: 1, connections })
  }

  function readJson(file, fallback) {
    if (!existsSync(file)) return fallback
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      const backup = `${file}.corrupt-${now().getTime()}`
      renameSync(file, backup)
      warnings.push(`${basename(file)} was unreadable and has been reset. The old file was kept as ${basename(backup)}.`)
      return fallback
    }
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
}
