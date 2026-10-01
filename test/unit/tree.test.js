import { describe, expect, it } from 'vitest'
import { buildTree, filterTree } from '@shared/tree.js'

const names = ['/myapp/prod/env', '/myapp/prod/flags', '/myapp/dev/env', 'legacy', '/a', '/a/b']

describe('buildTree', () => {
  it('builds folders from "/" segments, folders first, with leaf counts', () => {
    const tree = buildTree(names)
    expect(tree.count).toBe(6)
    expect(tree.children.map((n) => `${n.type}:${n.name}`)).toEqual(['folder:a', 'folder:myapp', 'leaf:a', 'leaf:legacy'])
    const myapp = tree.children[1]
    expect(myapp.path).toBe('/myapp')
    expect(myapp.count).toBe(3)
    expect(myapp.children.map((n) => n.name)).toEqual(['dev', 'prod'])
    expect(myapp.children[1].children.map((n) => n.path)).toEqual(['/myapp/prod/env', '/myapp/prod/flags'])
  })

  it('keeps a name that is both a parameter and a folder prefix', () => {
    expect(buildTree(['/a', '/a/b']).children).toEqual([
      { type: 'folder', name: 'a', path: '/a', count: 1, children: [{ type: 'leaf', name: 'b', path: '/a/b' }] },
      { type: 'leaf', name: 'a', path: '/a' }
    ])
  })

  it('returns an empty root for no names', () => {
    expect(buildTree([])).toEqual({ type: 'folder', name: '', path: '', count: 0, children: [] })
  })
})

describe('filterTree', () => {
  it('keeps matching leaves and their folders, case-insensitively', () => {
    const filtered = filterTree(buildTree(names), 'PROD')
    expect(filtered.count).toBe(2)
    expect(filtered.children.map((n) => n.name)).toEqual(['myapp'])
    expect(filtered.children[0].children.map((n) => n.name)).toEqual(['prod'])
  })

  it('returns the same tree for a blank query and an empty root when nothing matches', () => {
    const tree = buildTree(names)
    expect(filterTree(tree, '  ')).toBe(tree)
    expect(filterTree(tree, 'zzz')).toEqual({ type: 'folder', name: '', path: '', count: 0, children: [] })
  })
})
