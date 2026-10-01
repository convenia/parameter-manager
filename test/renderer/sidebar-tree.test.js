// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSidebarTree } from '../../src/renderer/views/sidebar-tree.js'

const rows = [
  { name: '/myapp/prod/env', type: 'SecureString' },
  { name: '/myapp/dev/env', type: 'String' },
  { name: 'legacy', type: 'String' }
]

function setup() {
  const onSelectFolder = vi.fn()
  const onOpenLeaf = vi.fn()
  const tree = createSidebarTree({ onSelectFolder, onOpenLeaf })
  document.body.append(tree.el)
  tree.setRows(rows)
  return { tree, onSelectFolder, onOpenLeaf }
}
const visible = (tree) => [...tree.el.querySelectorAll('.tree-row .tree-row__name')].map((n) => n.textContent)
const row = (tree, path) => tree.el.querySelector(`.tree-row[data-path="${path}"]`)

afterEach(() => document.body.replaceChildren())

describe('createSidebarTree', () => {
  it('shows the root count and collapsed top-level folders', () => {
    const { tree } = setup()
    expect(visible(tree)).toEqual(['All parameters', 'myapp', 'legacy'])
    expect(tree.el.querySelector('.tree-row--root .tree-row__count').textContent).toBe('3')
  })

  it('expands a folder and selects it on click', () => {
    const { tree, onSelectFolder } = setup()
    row(tree, '/myapp').click()
    expect(visible(tree)).toEqual(['All parameters', 'myapp', 'dev', 'prod', 'legacy'])
    expect(onSelectFolder).toHaveBeenCalledWith('/myapp')
    tree.el.querySelector('.tree-row--root').click()
    expect(onSelectFolder).toHaveBeenLastCalledWith('')
  })

  it('opens leaves by full name and marks SecureString leaves with a lock', () => {
    const { tree, onOpenLeaf } = setup()
    row(tree, '/myapp').click()
    row(tree, '/myapp/prod').click()
    expect(row(tree, '/myapp/prod/env').querySelector('.icon--lock')).not.toBeNull()
    row(tree, '/myapp/prod/env').click()
    expect(onOpenLeaf).toHaveBeenCalledWith('/myapp/prod/env')
  })

  it('expands every folder that contains a match', () => {
    const { tree } = setup()
    tree.setQuery('prod')
    expect(visible(tree)).toEqual(['All parameters', 'myapp', 'prod', 'env'])
    tree.setQuery('nothing-here')
    expect(tree.el.textContent).toContain('No matches')
  })

  it('highlights the active leaf and the selected folder', () => {
    const { tree } = setup()
    tree.setActiveLeaf('legacy')
    expect(row(tree, 'legacy').classList.contains('is-active')).toBe(true)
    tree.setSelectedFolder('')
    expect(tree.el.querySelector('.tree-row--root').classList.contains('is-selected')).toBe(true)
  })
})
