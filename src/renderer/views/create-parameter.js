import '../styles/dialogs.css'
import { PARAMETER_TYPES, byteLength, tierLimit, validateName } from '@shared/names.js'
import { h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { createEnvEditor } from '../components/env-editor.js'
import { openModal } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

export function openCreateParameter({ api, connection, prefix = '', onCreated = () => {} }) {
  const state = { name: prefix ? `${prefix.replace(/\/+$/, '')}/` : '', description: '', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', value: '', touched: false, busy: false }
  let modal = null

  const nameError = h('span', { class: 'field__error', role: 'alert' })
  const nameInput = h('input', {
    class: 'input mono',
    name: 'name',
    value: state.name,
    autofocus: true,
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '/myapp/prod/env',
    onInput: (event) => {
      state.name = event.target.value.trim()
      state.touched = true
      validate()
    }
  })
  const keyField = field(
    'KMS key',
    h('input', {
      class: 'input mono',
      name: 'keyId',
      value: state.keyId,
      spellcheck: 'false',
      onInput: (event) => {
        state.keyId = event.target.value.trim()
        validate()
      }
    }),
    'Key ID, key ARN, or alias used to encrypt the value.'
  )
  const typeSelect = h(
    'select',
    {
      class: 'input',
      name: 'type',
      onChange: (event) => {
        state.type = event.target.value
        keyField.hidden = state.type !== 'SecureString'
        validate()
      }
    },
    PARAMETER_TYPES.map((t) => h('option', { value: t }, t))
  )
  const editor = createEnvEditor({
    value: '',
    tier: state.tier,
    onChange: (_dirty, text) => {
      state.value = text
      validate()
    },
    onSave: () => submit()
  })
  const tierSelect = h(
    'select',
    {
      class: 'input',
      name: 'tier',
      onChange: (event) => {
        state.tier = event.target.value
        editor.setTier(state.tier)
        validate()
      }
    },
    h('option', { value: 'Standard' }, 'Standard — up to 4 KB, free'),
    h('option', { value: 'Advanced' }, 'Advanced — up to 8 KB, charges apply')
  )
  typeSelect.value = state.type

  const body = h(
    'form',
    {
      class: 'create-form',
      onSubmit: (event) => {
        event.preventDefault()
        submit()
      }
    },
    field('Name', nameInput, 'Use "/" to build a path, for example /myapp/prod/env.', nameError),
    field('Description', h('input', { class: 'input', name: 'description', placeholder: 'Optional', onInput: (event) => (state.description = event.target.value) })),
    h('div', { class: 'field-row' }, field('Type', typeSelect), field('Tier', tierSelect)),
    keyField,
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Value'), h('div', { class: 'create-form__editor' }, editor.el))
  )

  modal = openModal({
    title: `Create parameter in ${connection.name}`,
    size: 'lg',
    body,
    onClose: () => editor.destroy(),
    actions: [
      { id: 'cancel', label: 'Cancel', onClick: (m) => m.close() },
      { id: 'confirm', label: 'Create parameter', kind: 'primary', disabled: true, onClick: () => submit() }
    ]
  })
  validate()
  return modal

  function validate() {
    const nameProblem = validateName(state.name)
    nameError.textContent = state.touched && nameProblem ? nameProblem : ''
    const ok = !nameProblem && state.value.length > 0 && byteLength(state.value) <= tierLimit(state.tier) && (state.type !== 'SecureString' || state.keyId !== '')
    if (modal && !state.busy) modal.button('confirm').disabled = !ok
    return ok
  }

  async function submit() {
    if (state.busy || !validate()) return
    state.busy = true
    modal.setBusy(true)
    try {
      const result = await api.ssm.put(connection.id, {
        name: state.name,
        value: state.value,
        type: state.type,
        tier: state.tier,
        keyId: state.type === 'SecureString' ? state.keyId : null,
        description: state.description.trim(),
        dataType: 'text',
        overwrite: false
      })
      toast({ kind: 'success', message: `Created ${state.name} (version ${result.version}).` })
      modal.close()
      onCreated(state.name)
    } catch (err) {
      state.busy = false
      modal.setBusy(false)
      validate()
      if (err?.code === 'ParameterAlreadyExists') {
        nameError.textContent = err.message
        nameInput.focus()
      } else {
        toastError(err, 'Could not create the parameter')
      }
    }
  }
}
