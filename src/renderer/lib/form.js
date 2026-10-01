import { h } from './dom.js'

export function field(label, control, help = null, error = null) {
  return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), control, help ? h('span', { class: 'field__help' }, help) : null, error)
}
