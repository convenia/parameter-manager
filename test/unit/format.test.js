import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'

describe('formatDate', () => {
  it('formats ISO dates in the given locale and time zone', () => {
    const text = formatDate('2026-10-01T12:30:00.000Z', { locale: 'en-US', timeZone: 'UTC' })
    // ICU uses a narrow no-break space before AM/PM; normalize whitespace for the assertion.
    expect(text.replace(/\s/g, ' ')).toBe('Oct 1, 2026, 12:30 PM')
  })

  it('returns an em dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })
})

describe('formatNumber and formatCount', () => {
  it('groups thousands', () => {
    expect(formatNumber(4096)).toBe('4,096')
  })

  it('pluralizes', () => {
    expect(formatCount(1, 'parameter')).toBe('1 parameter')
    expect(formatCount(1234, 'parameter')).toBe('1,234 parameters')
    expect(formatCount(2, 'match', 'matches')).toBe('2 matches')
  })
})
