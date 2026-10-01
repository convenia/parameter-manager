// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { append, clear, h } from '../../src/renderer/lib/dom.js'

describe('h', () => {
  it('sets classes, attributes, dataset, styles, and listeners', () => {
    const onClick = vi.fn()
    const el = h('button', { class: ['btn', false && 'no', 'btn--primary'], type: 'button', hidden: false, dataset: { action: 'save' }, style: { color: 'red', '--conn-color': 'blue' }, 'aria-label': 'Save', onClick }, 'Save')
    expect(el.className).toBe('btn btn--primary')
    expect(el.getAttribute('type')).toBe('button')
    expect(h('button', { disabled: true }).disabled).toBe(true)
    expect(el.hasAttribute('hidden')).toBe(false)
    expect(el.dataset.action).toBe('save')
    expect(el.style.color).toBe('red')
    expect(el.style.getPropertyValue('--conn-color')).toBe('blue')
    expect(el.getAttribute('aria-label')).toBe('Save')
    el.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('appends strings, numbers, nodes, and nested arrays, skipping empty values', () => {
    const el = h('div', {}, 'a', 1, null, false, true, undefined, [h('span', {}, 'b'), ['c']])
    expect(el.textContent).toBe('a1bc')
    expect(el.querySelector('span').textContent).toBe('b')
  })

  it('sets the initial value and checked state through attributes', () => {
    expect(h('input', { value: 'x' }).value).toBe('x')
    expect(h('input', { type: 'checkbox', checked: true }).checked).toBe(true)
  })
})

describe('append and clear', () => {
  it('appends a single child or a list, and clears', () => {
    const el = h('div')
    append(el, 'x')
    append(el, [h('i'), 'y'])
    expect(el.childNodes).toHaveLength(3)
    expect(clear(el).childNodes).toHaveLength(0)
  })
})
