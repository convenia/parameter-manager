// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, icon } from '../../src/renderer/components/icons.js'
import { readOnlyBadge, tierBadge, typeBadge } from '../../src/renderer/components/badges.js'

describe('icon', () => {
  it('renders every icon as an SVG with paths', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name, 12)
      expect(svg.tagName.toLowerCase()).toBe('svg')
      expect(svg.getAttribute('width')).toBe('12')
      expect(svg.getAttribute('class')).toBe(`icon icon--${name}`)
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
    }
  })

  it('throws for unknown names', () => {
    expect(() => icon('nope')).toThrow('Unknown icon "nope"')
  })
})

describe('badges', () => {
  it('styles parameter types, tiers, and read-only', () => {
    expect(typeBadge('SecureString').className).toBe('badge badge--secure')
    expect(typeBadge('SecureString').querySelector('.icon--lock')).not.toBeNull()
    expect(typeBadge('StringList').className).toBe('badge badge--list')
    expect(typeBadge('String').textContent).toBe('String')
    expect(tierBadge('Advanced').className).toBe('badge badge--advanced')
    expect(tierBadge('Standard').className).toBe('badge badge--muted')
    expect(readOnlyBadge().textContent).toBe('Read-only')
  })
})
