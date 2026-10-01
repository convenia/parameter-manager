import { API, CHANNELS } from '@shared/channels.js'
import { PARAMETER_TIERS, PARAMETER_TYPES, byteLength, tierLimit, validateName } from '@shared/names.js'
import { AppError, CREDENTIAL_ERROR_CODES, toIpcError } from './errors.js'
import { sanitizeConnection } from './store.js'

export function createHandlers({ store, clients, listProfiles, resolvePaths, fake = false, appVersion = '0.0.0' }) {
  const service = (id) => clients.forConnection(id)
  const writable = (id) => {
    const connection = store.getConnection(id)
    if (connection.readOnly) {
      throw new AppError('ReadOnlyConnection', `"${connection.name}" is a read-only connection.`, { hint: 'Edit the connection and turn off read-only to make changes.' })
    }
  }

  return {
    [API.app.info]: () => ({ version: appVersion, fake, warnings: store.warnings.splice(0) }),
    [API.profiles.list]: async () => {
      const paths = resolvePaths(store.getSettings())
      return { ...paths, profiles: await listProfiles(paths) }
    },
    [API.connections.list]: () => store.listConnections(),
    [API.connections.save]: (input) => {
      const saved = store.saveConnection(input)
      clients.invalidate(saved.id)
      return saved
    },
    [API.connections.delete]: (id) => {
      store.deleteConnection(id)
      clients.invalidate(id)
      return { deleted: true }
    },
    [API.connections.test]: (input) => {
      // A draft may not have a name yet; profile and region must still be valid.
      const draft = sanitizeConnection({ ...input, name: 'draft' }, 'draft', '')
      return clients.forDraft(draft).test(draft.pathPrefix)
    },
    [API.settings.get]: () => store.getSettings(),
    [API.settings.save]: (input) => {
      const saved = store.saveSettings(input)
      clients.clear()
      return saved
    },
    [API.ssm.list]: (id) => service(id).list(store.getConnection(id).pathPrefix),
    [API.ssm.get]: (id, name, options) => service(id).get(requireText(name), { decrypt: options?.decrypt === true }),
    [API.ssm.tags]: (id, name) => service(id).tags(requireText(name)),
    [API.ssm.history]: (id, name, options) => service(id).history(requireText(name), { decrypt: options?.decrypt === true }),
    [API.ssm.put]: (id, input) => {
      writable(id)
      return service(id).put(validatePut(input))
    },
    [API.ssm.delete]: (id, name) => {
      writable(id)
      return service(id).delete(requireText(name))
    }
  }
}

function validatePut(input) {
  const src = input && typeof input === 'object' ? input : {}
  const overwrite = src.overwrite === true
  // Strict name rules only for new parameters; existing names are whatever AWS accepted.
  const name = overwrite ? requireText(src.name) : requireValidName(src.name)
  if (typeof src.value !== 'string' || src.value.length === 0) throw new AppError('InvalidInput', 'The value cannot be empty.')
  if (!PARAMETER_TYPES.includes(src.type)) throw new AppError('InvalidInput', `Unknown parameter type "${src.type}".`)
  const tier = src.tier ?? 'Standard'
  if (!PARAMETER_TIERS.includes(tier)) throw new AppError('InvalidInput', `Unknown tier "${tier}".`)
  const bytes = byteLength(src.value)
  if (bytes > tierLimit(tier)) throw new AppError('InvalidInput', `The value is ${bytes} bytes; the ${tier} tier allows ${tierLimit(tier)} bytes.`)
  return {
    name,
    value: src.value,
    type: src.type,
    tier,
    keyId: optionalText(src.keyId),
    description: optionalText(src.description) ?? '',
    dataType: optionalText(src.dataType) ?? 'text',
    allowedPattern: optionalText(src.allowedPattern),
    overwrite,
    expectedVersion: Number.isInteger(src.expectedVersion) ? src.expectedVersion : null
  }
}

function optionalText(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

function requireText(value) {
  if (typeof value !== 'string' || value === '') throw new AppError('InvalidInput', 'A parameter name is required.')
  return value
}

function requireValidName(name) {
  const error = validateName(name)
  if (error) throw new AppError('InvalidInput', error)
  return name
}

function connectionContext(store, id) {
  try {
    const connection = store.getConnection(id)
    return { profile: connection.profile, connectionId: connection.id }
  } catch {
    return {}
  }
}

// What each channel was doing, for readable AccessDenied messages and credential resets.
const CONTEXT = {
  [API.connections.test]: (store, input) => ({ action: 'list parameters', profile: input?.profile }),
  [API.ssm.list]: (store, id) => ({ action: 'list parameters', ...connectionContext(store, id) }),
  [API.ssm.get]: (store, id, name) => ({ action: 'read', name, ...connectionContext(store, id) }),
  [API.ssm.tags]: (store, id, name) => ({ action: 'read the tags of', name, ...connectionContext(store, id) }),
  [API.ssm.history]: (store, id, name) => ({ action: 'read the history of', name, ...connectionContext(store, id) }),
  [API.ssm.put]: (store, id, input) => ({ action: 'write', name: input?.name, ...connectionContext(store, id) }),
  [API.ssm.delete]: (store, id, name) => ({ action: 'delete', name, ...connectionContext(store, id) })
}

export function wrap(handler, { contextOf = () => ({}), onCredentialError = () => {}, log = console.error } = {}) {
  return async (...args) => {
    try {
      return { ok: true, data: await handler(...args) }
    } catch (err) {
      const context = contextOf(...args)
      const error = toIpcError(err, context)
      if (CREDENTIAL_ERROR_CODES.has(error.code) && context.connectionId) onCredentialError(context.connectionId)
      log(`[ipc] ${error.code}${context.name ? ` ${context.name}` : ''}: ${error.message}`)
      return { ok: false, error }
    }
  }
}

export function registerIpc(ipcMain, { handlers, store, clients, log }) {
  for (const channel of CHANNELS) {
    const handler = handlers[channel]
    if (typeof handler !== 'function') throw new Error(`Missing IPC handler for ${channel}`)
    const run = wrap(handler, {
      contextOf: (...args) => CONTEXT[channel]?.(store, ...args) ?? {},
      onCredentialError: (id) => clients.invalidate(id),
      log
    })
    ipcMain.handle(channel, (_event, ...args) => run(...args))
  }
}
