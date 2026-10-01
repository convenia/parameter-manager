// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvEditor } from '../../src/renderer/components/env-editor.js'

const editors = []
const mount = (options) => {
  const editor = createEnvEditor(options)
  document.body.append(editor.el)
  editors.push(editor)
  return editor
}
const typeAtEnd = (editor, text) => editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: text } })
const status = (editor) => editor.el.querySelector('.editor-status__bytes')

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  document.body.replaceChildren()
})

describe('createEnvEditor', () => {
  it('shows the value, line count, and byte usage', () => {
    const editor = mount({ value: 'A=1\nB=2', tier: 'Standard' })
    expect(editor.getValue()).toBe('A=1\nB=2')
    expect(editor.el.querySelector('.editor-status__lines').textContent).toBe('2 lines')
    expect(status(editor).textContent).toBe('7 / 4,096 bytes (Standard)')
  })

  it('reports dirty changes, and becomes clean again when the text is restored', () => {
    const onChange = vi.fn()
    const editor = mount({ value: 'A=1', onChange })
    typeAtEnd(editor, '\nB=2')
    expect(editor.isDirty()).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(true, 'A=1\nB=2')
    editor.setValue('A=1', { markClean: false })
    expect(editor.isDirty()).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(false, 'A=1')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('is not dirty right after loading a CRLF value', () => {
    const editor = mount({ value: 'A=1\r\nB=2\r\n' })
    expect(editor.isDirty()).toBe(false)
    expect(editor.getValue()).toBe('A=1\nB=2\n')
  })

  it('setValue makes the new text the baseline unless markClean is false', () => {
    const editor = mount({ value: 'A=1' })
    editor.setValue('A=2')
    expect(editor.isDirty()).toBe(false)
    editor.setValue('A=3', { markClean: false })
    expect(editor.isDirty()).toBe(true)
  })

  it('flags values over the tier limit and follows tier changes', () => {
    const editor = mount({ value: 'x'.repeat(5000), tier: 'Standard' })
    expect(status(editor).classList.contains('is-over')).toBe(true)
    editor.setTier('Advanced')
    expect(status(editor).classList.contains('is-over')).toBe(false)
    expect(status(editor).textContent).toBe('5,000 / 8,192 bytes (Advanced)')
  })

  it('shows a notice for values that are not .env', () => {
    const editor = mount({ value: '{"a": 1}' })
    const notice = editor.el.querySelector('.editor-notice')
    expect(notice.hidden).toBe(false)
    editor.setValue('A=1')
    expect(notice.hidden).toBe(true)
  })

  it('calls onSave on Mod-S', () => {
    const onSave = vi.fn()
    const editor = mount({ value: 'A=1', onSave })
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('can be read-only and switched back', () => {
    const editor = mount({ value: 'A=1', readOnly: true })
    expect(editor.view.state.readOnly).toBe(true)
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('false')
    editor.setReadOnly(false)
    expect(editor.view.state.readOnly).toBe(false)
  })
})
