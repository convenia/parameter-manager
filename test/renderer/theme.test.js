import { describe, expect, it } from 'vitest'
import { applyTheme, resolveTheme } from '../../src/renderer/theme.js'

const fakeMedia = (matches) => {
  const listeners = new Set()
  return { matches, listeners, addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) }
}

describe('theme', () => {
  it('resolves explicit and system themes', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('applies an explicit theme without listening to the OS', () => {
    const root = { dataset: {} }
    const media = fakeMedia(true)
    applyTheme('light', root, media)
    expect(root.dataset.theme).toBe('light')
    expect(media.listeners.size).toBe(0)
  })

  it('follows the OS for "system" until disposed', () => {
    const root = { dataset: {} }
    const media = fakeMedia(false)
    const dispose = applyTheme('system', root, media)
    expect(root.dataset.theme).toBe('light')
    media.matches = true
    media.listeners.forEach((fn) => fn())
    expect(root.dataset.theme).toBe('dark')
    dispose()
    expect(media.listeners.size).toBe(0)
  })
})
