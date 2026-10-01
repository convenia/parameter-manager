// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from '../../src/renderer/lib/dom.js'
import { choiceDialog, confirmDialog, openModal, typeToConfirm } from '../../src/renderer/components/modal.js'

const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
const action = (id) => document.querySelector(`.modal [data-action="${id}"]`)
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => document.body.replaceChildren())

describe('openModal', () => {
  it('renders title, body, and actions, and Escape closes with undefined', () => {
    const onClose = vi.fn()
    openModal({ title: 'Hello', body: h('p', {}, 'Body'), actions: [{ id: 'ok', label: 'OK', kind: 'primary' }], onClose })
    expect(document.querySelector('.modal__title').textContent).toBe('Hello')
    expect(document.querySelector('.modal__body').textContent).toBe('Body')
    expect(action('ok').className).toBe('btn btn--primary')
    escape()
    expect(document.querySelector('.modal')).toBeNull()
    expect(onClose).toHaveBeenCalledWith(undefined)
  })

  it('closes on a backdrop mousedown but not on the dialog itself', () => {
    const modal = openModal({ title: 'X', body: 'b' })
    modal.root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.modal')).not.toBeNull()
    document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('lets only the topmost modal react to Escape', () => {
    openModal({ title: 'A', body: '' })
    openModal({ title: 'B', body: '' })
    escape()
    expect([...document.querySelectorAll('.modal__title')].map((t) => t.textContent)).toEqual(['A'])
  })

  it('setBusy disables every button and then restores the previous states', () => {
    const modal = openModal({ title: 'X', body: '', actions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }] })
    modal.setBusy(true)
    expect([action('a').disabled, action('b').disabled]).toEqual([true, true])
    modal.setBusy(false)
    expect([action('a').disabled, action('b').disabled]).toEqual([false, true])
  })

  it('passes the controller to action handlers and reports close results', () => {
    const onClose = vi.fn()
    openModal({ title: 'X', body: '', onClose, actions: [{ id: 'go', label: 'Go', onClick: (m) => m.close('done') }] })
    action('go').click()
    expect(onClose).toHaveBeenCalledWith('done')
  })
})

describe('dialogs', () => {
  it('confirmDialog resolves true on confirm and false on cancel', async () => {
    const yes = confirmDialog({ title: 'Sure?', message: 'Really' })
    action('confirm').click()
    expect(await yes).toBe(true)
    const no = confirmDialog({ title: 'Sure?', message: 'Really' })
    action('cancel').click()
    expect(await no).toBe(false)
  })

  it('choiceDialog resolves the chosen id, or null when dismissed', async () => {
    const choices = [{ id: 'reload', label: 'Reload' }, { id: 'overwrite', label: 'Overwrite', kind: 'danger' }]
    const picked = choiceDialog({ title: 'Conflict', message: 'm', choices })
    action('overwrite').click()
    expect(await picked).toBe('overwrite')
    const dismissed = choiceDialog({ title: 'Conflict', message: 'm', choices })
    escape()
    expect(await dismissed).toBeNull()
  })

  it('typeToConfirm enables the button only for the exact text', async () => {
    const result = typeToConfirm({ title: 'Delete', message: 'Gone forever', expected: '/a/b' })
    const input = document.querySelector('.modal input')
    expect(document.activeElement).toBe(input)
    expect(action('confirm').disabled).toBe(true)
    type(input, '/a/')
    expect(action('confirm').disabled).toBe(true)
    type(input, '/a/b')
    expect(action('confirm').disabled).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(await result).toBe(true)
  })
})
