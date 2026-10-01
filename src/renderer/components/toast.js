import { h } from '../lib/dom.js'
import { icon } from './icons.js'

const DEFAULT_TIMEOUT = { success: 4000, info: 5000, warning: 8000, error: 10000 }
let host = null

export function mountToasts(parent = document.body) {
  host?.remove()
  host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  parent.append(host)
  return host
}

// timeout 0 keeps the toast until it is dismissed.
export function toast({ kind = 'info', title = '', message = '', hint = '', timeout = DEFAULT_TIMEOUT[kind] ?? 5000 }) {
  if (!host?.isConnected) mountToasts()
  const el = h(
    'div',
    { class: ['toast', `toast--${kind}`], role: kind === 'error' ? 'alert' : null },
    h('div', { class: 'toast__body' }, title ? h('strong', { class: 'toast__title' }, title) : null, message ? h('span', { class: 'toast__message' }, message) : null, hint ? h('span', { class: 'toast__hint' }, hint) : null),
    h('button', { class: 'toast__close', type: 'button', 'aria-label': 'Dismiss', onClick: () => el.remove() }, icon('close', 14))
  )
  host.append(el)
  if (timeout > 0) setTimeout(() => el.remove(), timeout)
  return el
}

export function toastError(err, title = 'Something went wrong') {
  console.error(err)
  return toast({ kind: 'error', title, message: err?.message ?? String(err), hint: err?.hint ?? '' })
}
