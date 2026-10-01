import { describe, expect, it } from 'vitest'
import { planSave } from '../../src/renderer/lib/save-plan.js'

describe('planSave', () => {
  it('blocks saving a value that was never decrypted', () => {
    expect(planSave({ original: null, text: 'A=1', tier: 'Standard' })).toEqual({ blocked: true, reason: 'Decrypt the value before saving changes.' })
  })

  it('blocks an empty value', () => {
    expect(planSave({ original: 'A=1', text: '', tier: 'Standard' }).reason).toBe('The value cannot be empty. Parameter Store requires at least one character.')
  })

  it('blocks when nothing changed, ignoring line endings', () => {
    expect(planSave({ original: 'A=1\r\nB=2', text: 'A=1\nB=2', tier: 'Standard' }).reason).toBe('There are no changes to save.')
  })

  it('blocks values over the Advanced limit', () => {
    expect(planSave({ original: 'A=1', text: 'x'.repeat(8193), tier: 'Advanced' }).reason).toBe('The value is 8,193 bytes. The maximum, even on the Advanced tier, is 8,192 bytes.')
  })

  it('asks for a tier upgrade between 4 KB and 8 KB on Standard only', () => {
    expect(planSave({ original: 'A=1', text: 'x'.repeat(5000), tier: 'Standard' })).toEqual({ blocked: false, bytes: 5000, needsUpgrade: true })
    expect(planSave({ original: 'A=1', text: 'x'.repeat(5000), tier: 'Advanced' }).needsUpgrade).toBe(false)
  })

  it('allows a normal save', () => {
    expect(planSave({ original: 'A=1', text: 'A=2', tier: 'Standard' })).toEqual({ blocked: false, bytes: 3, needsUpgrade: false })
  })
})
