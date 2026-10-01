// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installUnloadGuard } from '../../src/renderer/lib/unload-guard.js'

const fire = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('installUnloadGuard', () => {
  it('blocks closing only while there are unsaved changes, until disposed', () => {
    let dirty = false
    const dispose = installUnloadGuard(() => dirty)
    expect(fire()).toBe(false)
    dirty = true
    expect(fire()).toBe(true)
    dispose()
    expect(fire()).toBe(false)
  })
})
