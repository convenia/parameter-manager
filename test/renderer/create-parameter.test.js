// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { openCreateParameter } from '../../src/renderer/views/create-parameter.js'

const q = (selector) => document.querySelector(`.modal ${selector}`)
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const choose = (select, value) => {
  select.value = value
  select.dispatchEvent(new Event('change'))
}
const setValue = (text) => {
  const view = EditorView.findFromDOM(q('.cm-editor'))
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}
function open(put = vi.fn(async () => ({ version: 1, tier: 'Standard' }))) {
  const onCreated = vi.fn()
  openCreateParameter({ api: { ssm: { put } }, connection: { id: 'c1', name: 'Prod' }, prefix: '/myapp/prod', onCreated })
  return { put, onCreated }
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('openCreateParameter', () => {
  it('prefills the folder and keeps Create disabled until name and value are valid', () => {
    open()
    expect(q('input[name="name"]').value).toBe('/myapp/prod/')
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    type(q('input[name="name"]'), '/myapp/prod/env')
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    setValue('A=1')
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('shows name errors only after the user types', () => {
    open()
    expect(q('.field__error').textContent).toBe('')
    type(q('input[name="name"]'), 'bad name')
    expect(q('.field__error').textContent).toBe('Only letters, numbers, and _ . - / are allowed')
  })

  it('shows the KMS key field only for SecureString', () => {
    open()
    const keyField = q('input[name="keyId"]').closest('.field')
    expect(keyField.hidden).toBe(false)
    choose(q('select[name="type"]'), 'String')
    expect(keyField.hidden).toBe(true)
  })

  it('blocks values over the tier limit until the tier allows them', () => {
    open()
    type(q('input[name="name"]'), '/a/b')
    setValue('x'.repeat(4097))
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    choose(q('select[name="tier"]'), 'Advanced')
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('creates without overwriting and reports the new name', async () => {
    const { put, onCreated } = open()
    type(q('input[name="name"]'), '/myapp/prod/new')
    type(q('input[name="description"]'), ' New one ')
    setValue('A=1')
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('/myapp/prod/new'))
    expect(put).toHaveBeenCalledWith('c1', { name: '/myapp/prod/new', value: 'A=1', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: 'New one', dataType: 'text', overwrite: false })
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('keeps the dialog open and points at the name when it already exists', async () => {
    const put = vi.fn(async () => Promise.reject(Object.assign(new Error('A parameter named /myapp/prod/env already exists.'), { code: 'ParameterAlreadyExists' })))
    open(put)
    type(q('input[name="name"]'), '/myapp/prod/env')
    setValue('A=1')
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(q('.field__error').textContent).toBe('A parameter named /myapp/prod/env already exists.'))
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })
})
