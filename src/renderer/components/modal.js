import { h } from '../lib/dom.js'
import { icon } from './icons.js'

const stack = []

export function openModal({ title, body, actions = [], size = 'md', onClose = () => {}, dismissible = true }) {
  const previousFocus = document.activeElement
  let closed = false
  let savedDisabled = null
  let buttons = []

  const controller = {
    root: null,
    button: (id) => buttons.find((b) => b.dataset.action === id) ?? null,
    setBusy(busy) {
      if (busy) {
        savedDisabled = buttons.map((b) => b.disabled)
        for (const b of buttons) b.disabled = true
      } else if (savedDisabled) {
        buttons.forEach((b, i) => {
          b.disabled = savedDisabled[i]
        })
        savedDisabled = null
      }
    },
    close(result) {
      if (closed) return
      closed = true
      stack.splice(stack.indexOf(controller), 1)
      document.removeEventListener('keydown', onKeydown, true)
      backdrop.remove()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
      onClose(result)
    }
  }

  buttons = actions.map((action) =>
    h('button', { class: ['btn', `btn--${action.kind ?? 'default'}`], type: 'button', disabled: action.disabled, dataset: { action: action.id }, onClick: () => action.onClick?.(controller) }, action.label)
  )
  const dialog = h(
    'div',
    { class: ['modal', `modal--${size}`], role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'modal__header' }, h('h2', { class: 'modal__title' }, title), dismissible ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close dialog', onClick: () => controller.close() }, icon('close')) : null),
    h('div', { class: 'modal__body' }, body),
    buttons.length ? h('footer', { class: 'modal__footer' }, buttons) : null
  )
  const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (event) => event.target === backdrop && dismissible && controller.close() }, dialog)

  function onKeydown(event) {
    if (event.key !== 'Escape' || !dismissible || stack.at(-1) !== controller) return
    event.stopPropagation()
    controller.close()
  }

  controller.root = dialog
  stack.push(controller)
  document.addEventListener('keydown', onKeydown, true)
  document.body.append(backdrop)
  ;(dialog.querySelector('[autofocus]') ?? buttons.findLast((b) => !b.disabled) ?? dialog.querySelector('button'))?.focus()
  return controller
}

export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    openModal({
      title,
      size: 'sm',
      body: typeof message === 'string' ? h('p', {}, message) : message,
      onClose: (result) => resolve(result ?? null),
      actions: choices.map((choice) => ({ ...choice, onClick: (modal) => modal.close(choice.id) }))
    })
  })
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', kind = 'primary' }) {
  const choice = await choiceDialog({ title, message, choices: [{ id: 'cancel', label: cancelLabel }, { id: 'confirm', label: confirmLabel, kind }] })
  return choice === 'confirm'
}

export function typeToConfirm({ title, message, expected, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input mono', type: 'text', autofocus: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Type the name to confirm' })
    const modal = openModal({
      title,
      size: 'sm',
      body: [h('p', {}, message), h('p', { class: 'muted' }, 'Type ', h('code', {}, expected), ' to confirm.'), input],
      onClose: (result) => resolve(result === true),
      actions: [
        { id: 'cancel', label: 'Cancel', onClick: (m) => m.close(false) },
        { id: 'confirm', label: confirmLabel, kind: 'danger', disabled: true, onClick: (m) => input.value === expected && m.close(true) }
      ]
    })
    input.addEventListener('input', () => {
      modal.button('confirm').disabled = input.value !== expected
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && input.value === expected) modal.close(true)
    })
  })
}
