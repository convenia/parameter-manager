import { describe, expect, it } from 'vitest'
import { API, CHANNELS } from '@shared/channels.js'

describe('IPC channels', () => {
  it('lists every channel exactly once', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length)
    expect(CHANNELS).toHaveLength(14)
  })

  it('names each channel group:method after the API shape', () => {
    for (const [group, methods] of Object.entries(API)) {
      for (const [method, channel] of Object.entries(methods)) {
        expect(channel).toBe(`${group}:${method}`)
      }
    }
  })
})
