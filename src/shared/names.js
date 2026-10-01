export const TIER_LIMITS = Object.freeze({ Standard: 4096, Advanced: 8192 })
export const MAX_NAME_LENGTH = 1011
export const MAX_HIERARCHY_DEPTH = 15
export const PARAMETER_TYPES = Object.freeze(['String', 'StringList', 'SecureString'])
export const PARAMETER_TIERS = Object.freeze(['Standard', 'Advanced'])

const ALLOWED = /^[A-Za-z0-9_.\-/]+$/
const encoder = new TextEncoder()

/** @returns {string | null} an error message, or null when the name is valid */
export function validateName(name) {
  const value = typeof name === 'string' ? name : ''
  if (value === '') return 'Name is required'
  if (value.length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters`
  if (!ALLOWED.test(value)) return 'Only letters, numbers, and _ . - / are allowed'
  if (value.includes('/')) {
    if (!value.startsWith('/')) return 'Hierarchical names must start with "/"'
    if (value.endsWith('/')) return 'Name cannot end with "/"'
    if (value.includes('//')) return 'Name cannot contain empty path segments'
  }
  const segments = value.split('/').filter(Boolean)
  if (segments.length > MAX_HIERARCHY_DEPTH) return `Names can have at most ${MAX_HIERARCHY_DEPTH} hierarchy levels`
  if (/^(aws|ssm)/i.test(segments[0])) return 'Names cannot begin with "aws" or "ssm"'
  return null
}

export function byteLength(value) {
  return encoder.encode(String(value ?? '')).length
}

export function tierLimit(tier) {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.Standard
}
