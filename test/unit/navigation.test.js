import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from '../../src/main/navigation.js'

describe('isAllowedNavigation', () => {
  it('blocks every navigation in production', () => {
    expect(isAllowedNavigation('file:///tmp/other.html', undefined)).toBe(false)
    expect(isAllowedNavigation('https://example.com', undefined)).toBe(false)
  })

  it('allows only the dev server origin in development', () => {
    const dev = 'http://localhost:5173'
    expect(isAllowedNavigation('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isAllowedNavigation('http://localhost:5174/', dev)).toBe(false)
    expect(isAllowedNavigation('https://evil.example', dev)).toBe(false)
  })

  it('treats malformed URLs as blocked', () => {
    expect(isAllowedNavigation('not a url', 'http://localhost:5173')).toBe(false)
  })
})
