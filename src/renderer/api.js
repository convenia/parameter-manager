import { API } from '@shared/channels.js'

export class ApiError extends Error {
  constructor({ code = 'Unknown', message = 'Something went wrong.', hint = null, details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
    this.details = details
  }
}

// Mirrors window.vault, but resolves to `data` and throws ApiError for { ok: false }.
export function createApi(bridge) {
  if (!bridge) throw new Error('window.vault is missing. Is the preload script loaded?')
  return Object.fromEntries(
    Object.entries(API).map(([group, methods]) => [
      group,
      Object.fromEntries(Object.keys(methods).map((method) => [method, unwrap(bridge, group, method)]))
    ])
  )
}

function unwrap(bridge, group, method) {
  const fn = bridge[group]?.[method]
  if (typeof fn !== 'function') throw new Error(`window.vault.${group}.${method} is missing`)
  return async (...args) => {
    let result
    try {
      result = await fn(...args)
    } catch (err) {
      throw new ApiError({ code: 'Unknown', message: err?.message ?? String(err) })
    }
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new ApiError({ code: 'Unknown', message: `Unexpected response from ${group}.${method}.` })
    }
    if (result.ok) return result.data
    throw new ApiError(result.error)
  }
}
