// Tiny hyperscript helper: h('button', { class: ['btn', active && 'is-active'], onClick }, 'Save')
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key === 'style' && typeof value === 'object') setStyle(el, value)
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value)
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  return append(el, children)
}

export function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return parent
}

export function clear(el) {
  el.replaceChildren()
  return el
}

function setStyle(el, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (prop.startsWith('--')) el.style.setProperty(prop, value)
    else el.style[prop] = value
  }
}
