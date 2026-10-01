import { describe, expect, it, vi } from 'vitest'
import { createTabModel } from '../../src/renderer/tabs.js'

const model = () => createTabModel([{ id: 'parameters', title: 'Parameters', closable: false }])
const ids = (tabs) => tabs.list().map((t) => t.id)

describe('createTabModel', () => {
  it('starts with the fixed tab active', () => {
    const tabs = model()
    expect(ids(tabs)).toEqual(['parameters'])
    expect(tabs.activeId).toBe('parameters')
  })

  it('opens and activates tabs without duplicating them', () => {
    const tabs = model()
    tabs.open({ id: 'a', title: 'A' })
    tabs.open({ id: 'b', title: 'B' })
    tabs.open({ id: 'a', title: 'A again' })
    expect(ids(tabs)).toEqual(['parameters', 'a', 'b'])
    expect(tabs.activeId).toBe('a')
    expect(tabs.get('a').title).toBe('A')
  })

  it('activates the right neighbour after closing the active tab, else the left one', () => {
    const tabs = model()
    tabs.open({ id: 'a', title: 'A' })
    tabs.open({ id: 'b', title: 'B' })
    tabs.activate('a')
    expect(tabs.close('a')).toBe(true)
    expect(tabs.activeId).toBe('b')
    tabs.close('b')
    expect(tabs.activeId).toBe('parameters')
  })

  it('refuses to close non-closable or unknown tabs', () => {
    const tabs = model()
    expect(tabs.close('parameters')).toBe(false)
    expect(tabs.close('nope')).toBe(false)
    expect(ids(tabs)).toEqual(['parameters'])
  })

  it('updates tabs and notifies subscribers until they unsubscribe', () => {
    const tabs = model()
    const fn = vi.fn()
    const unsubscribe = tabs.subscribe(fn)
    tabs.open({ id: 'a', title: 'A' })
    tabs.update('a', { title: 'Renamed' })
    expect(tabs.get('a').title).toBe('Renamed')
    expect(fn).toHaveBeenCalledTimes(2)
    unsubscribe()
    tabs.activate('parameters')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
