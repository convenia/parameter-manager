import { describe, expect, it, vi } from 'vitest'
import { UNLOAD_DIALOG, confirmUnload } from '../../src/main/unload.js'

describe('confirmUnload', () => {
  it('lets the window close only when the user picks "Discard changes and close"', () => {
    const discard = { preventDefault: vi.fn() }
    confirmUnload(discard, () => 0)
    expect(discard.preventDefault).toHaveBeenCalled()

    const keep = { preventDefault: vi.fn() }
    confirmUnload(keep, () => 1)
    expect(keep.preventDefault).not.toHaveBeenCalled()
  })

  it('asks with a dialog whose default and cancel action keep editing', () => {
    const ask = vi.fn(() => 1)
    confirmUnload({ preventDefault() {} }, ask)
    expect(ask).toHaveBeenCalledWith(UNLOAD_DIALOG)
    expect(UNLOAD_DIALOG.buttons).toEqual(['Discard changes and close', 'Keep editing'])
    expect([UNLOAD_DIALOG.defaultId, UNLOAD_DIALOG.cancelId]).toEqual([1, 1])
  })
})
