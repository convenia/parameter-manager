import { buildTree, filterTree } from '@shared/tree.js'
import { h } from '../lib/dom.js'
import { icon } from '../components/icons.js'

export function createSidebarTree({ onSelectFolder, onOpenLeaf }) {
  const state = { tree: buildTree([]), types: new Map(), query: '', expanded: new Set(), selectedFolder: '', activeLeaf: null }
  const el = h('nav', { class: 'tree', 'aria-label': 'Parameter tree' })
  draw()

  return {
    el,
    setRows(rows) {
      state.tree = buildTree(rows.map((r) => r.name))
      state.types = new Map(rows.map((r) => [r.name, r.type]))
      draw()
    },
    setQuery(query) {
      state.query = query
      draw()
    },
    setSelectedFolder(path) {
      state.selectedFolder = path
      draw()
    },
    setActiveLeaf(name) {
      state.activeLeaf = name
      draw()
    }
  }

  function draw() {
    const filtering = state.query.trim() !== ''
    const tree = filterTree(state.tree, state.query)
    el.replaceChildren(
      h(
        'button',
        { class: ['tree-row tree-row--root', state.selectedFolder === '' && 'is-selected'], type: 'button', onClick: () => onSelectFolder('') },
        icon('folder', 14),
        h('span', { class: 'tree-row__name' }, 'All parameters'),
        h('span', { class: 'tree-row__count' }, String(state.tree.count))
      ),
      tree.children.length ? h('ul', { class: 'tree-list', role: 'tree' }, tree.children.map((node) => renderNode(node, 0, filtering))) : h('p', { class: 'tree-empty' }, filtering ? 'No matches' : 'No parameters')
    )
  }

  function renderNode(node, depth, filtering) {
    const indent = { paddingLeft: `${12 + depth * 14}px` }
    if (node.type === 'leaf') {
      const secure = state.types.get(node.path) === 'SecureString'
      return h(
        'li',
        { role: 'treeitem' },
        h('button', { class: ['tree-row tree-row--leaf', state.activeLeaf === node.path && 'is-active'], type: 'button', style: indent, title: node.path, dataset: { path: node.path }, onClick: () => onOpenLeaf(node.path) }, icon(secure ? 'lock' : 'file', 13), h('span', { class: 'tree-row__name' }, node.name))
      )
    }
    const open = filtering || state.expanded.has(node.path)
    const toggle = () => {
      if (state.expanded.has(node.path)) state.expanded.delete(node.path)
      else state.expanded.add(node.path)
      draw()
      onSelectFolder(node.path)
    }
    return h(
      'li',
      { role: 'treeitem', 'aria-expanded': String(open) },
      h(
        'button',
        { class: ['tree-row tree-row--folder', state.selectedFolder === node.path && 'is-selected'], type: 'button', style: indent, title: node.path, dataset: { path: node.path }, onClick: toggle },
        icon(open ? 'chevronDown' : 'chevronRight', 12),
        icon('folder', 14),
        h('span', { class: 'tree-row__name' }, node.name),
        h('span', { class: 'tree-row__count' }, String(node.count))
      ),
      open ? h('ul', { class: 'tree-list', role: 'group' }, node.children.map((child) => renderNode(child, depth + 1, filtering))) : null
    )
  }
}
