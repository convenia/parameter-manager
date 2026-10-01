import { h } from '../lib/dom.js'
import { icon } from './icons.js'

const TYPE_CLASS = { SecureString: 'badge--secure', StringList: 'badge--list', String: 'badge--plain' }

export function typeBadge(type) {
  return h('span', { class: ['badge', TYPE_CLASS[type] ?? 'badge--plain'] }, type === 'SecureString' ? icon('lock', 11) : null, type)
}

export function tierBadge(tier) {
  return h('span', { class: ['badge', tier === 'Advanced' ? 'badge--advanced' : 'badge--muted'] }, tier)
}

export function readOnlyBadge() {
  return h('span', { class: 'badge badge--readonly', title: 'Changes are disabled for this connection' }, 'Read-only')
}
