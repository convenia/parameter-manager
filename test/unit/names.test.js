import { describe, expect, it } from 'vitest'
import { byteLength, tierLimit, validateName } from '@shared/names.js'

const levels = (n) => '/' + Array.from({ length: n }, (_, i) => `l${i}`).join('/')

describe('validateName', () => {
  it.each(['my-param', '/myapp/prod/env', '/a_b.c-d/E1', 'x'])('accepts %s', (name) => {
    expect(validateName(name)).toBeNull()
  })

  it('accepts exactly 15 hierarchy levels', () => {
    expect(validateName(levels(15))).toBeNull()
  })

  it.each([
    ['', 'Name is required'],
    ['has space', 'Only letters, numbers, and _ . - / are allowed'],
    ['myapp/prod', 'Hierarchical names must start with "/"'],
    ['/myapp/', 'Name cannot end with "/"'],
    ['/myapp//env', 'Name cannot contain empty path segments'],
    ['/aws/thing', 'Names cannot begin with "aws" or "ssm"'],
    ['SSM-param', 'Names cannot begin with "aws" or "ssm"'],
    [levels(16), 'Names can have at most 15 hierarchy levels'],
    ['a'.repeat(1012), 'Name must be at most 1011 characters']
  ])('rejects %j', (name, message) => {
    expect(validateName(name)).toBe(message)
  })

  it('rejects non-strings as missing', () => {
    expect(validateName(undefined)).toBe('Name is required')
  })
})

describe('byteLength and tierLimit', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('ç')).toBe(2)
    expect(byteLength('€')).toBe(3)
    expect(byteLength('😀')).toBe(4)
    expect(byteLength(null)).toBe(0)
  })

  it('knows the tier limits and treats unknown tiers as Standard', () => {
    expect(tierLimit('Standard')).toBe(4096)
    expect(tierLimit('Advanced')).toBe(8192)
    expect(tierLimit('Intelligent-Tiering')).toBe(4096)
    expect(tierLimit(undefined)).toBe(4096)
  })
})
