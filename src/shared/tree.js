/**
 * @typedef {{ type: 'leaf', name: string, path: string }} LeafNode
 * @typedef {{ type: 'folder', name: string, path: string, count: number, children: (FolderNode | LeafNode)[] }} FolderNode
 */

/** @param {string[]} names @returns {FolderNode} */
export function buildTree(names) {
  const root = emptyRoot()
  for (const fullName of names) {
    if (!fullName.startsWith('/')) {
      root.children.push({ type: 'leaf', name: fullName, path: fullName })
      continue
    }
    const segments = fullName.split('/').filter(Boolean)
    let folder = root
    for (let i = 0; i < segments.length - 1; i++) {
      let next = folder.children.find((child) => child.type === 'folder' && child.name === segments[i])
      if (!next) {
        next = { type: 'folder', name: segments[i], path: `/${segments.slice(0, i + 1).join('/')}`, count: 0, children: [] }
        folder.children.push(next)
      }
      folder = next
    }
    folder.children.push({ type: 'leaf', name: segments[segments.length - 1], path: fullName })
  }
  finalize(root)
  return root
}

/** @param {FolderNode} tree @param {string} query @returns {FolderNode} */
export function filterTree(tree, query) {
  const q = query.trim().toLowerCase()
  if (!q) return tree
  return prune(tree, q) ?? emptyRoot()
}

function emptyRoot() {
  return { type: 'folder', name: '', path: '', count: 0, children: [] }
}

function finalize(folder) {
  folder.children.sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)))
  folder.count = 0
  for (const child of folder.children) {
    if (child.type === 'folder') {
      finalize(child)
      folder.count += child.count
    } else {
      folder.count += 1
    }
  }
}

function prune(node, q) {
  if (node.type === 'leaf') return node.path.toLowerCase().includes(q) ? node : null
  const children = node.children.map((child) => prune(child, q)).filter(Boolean)
  if (children.length === 0) return null
  const count = children.reduce((sum, child) => sum + (child.type === 'folder' ? child.count : 1), 0)
  return { ...node, children, count }
}
