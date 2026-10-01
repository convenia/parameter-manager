import { normalizeEol } from '@shared/env.js'
import { formatNumber } from '@shared/format.js'
import { TIER_LIMITS, byteLength } from '@shared/names.js'

// Decides, before any dialog or AWS call, whether the editor text can be saved.
export function planSave({ original, text, tier }) {
  if (original === null || original === undefined) return { blocked: true, reason: 'Decrypt the value before saving changes.' }
  if (text.length === 0) return { blocked: true, reason: 'The value cannot be empty. Parameter Store requires at least one character.' }
  if (normalizeEol(text) === normalizeEol(original)) return { blocked: true, reason: 'There are no changes to save.' }
  const bytes = byteLength(text)
  if (bytes > TIER_LIMITS.Advanced) {
    return { blocked: true, reason: `The value is ${formatNumber(bytes)} bytes. The maximum, even on the Advanced tier, is ${formatNumber(TIER_LIMITS.Advanced)} bytes.` }
  }
  return { blocked: false, bytes, needsUpgrade: tier !== 'Advanced' && bytes > TIER_LIMITS.Standard }
}
