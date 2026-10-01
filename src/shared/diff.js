import { normalizeEol, parseEnv, toMap } from './env.js'

// Key-level diff of two .env texts. When either side is not .env the caller gets the
// raw texts back (mode 'lines') and renders them with @codemirror/merge instead.
export function diffEnv(oldText, newText) {
  const before = parseEnv(oldText)
  const after = parseEnv(newText)
  const textChanged = normalizeEol(oldText) !== normalizeEol(newText)
  if (!before.isEnv || !after.isEnv) return { mode: 'lines', oldText, newText, textChanged }

  const a = toMap(before)
  const b = toMap(after)
  const added = []
  const changed = []
  const removed = []
  let unchanged = 0
  for (const [key, value] of b) {
    if (!a.has(key)) added.push({ key, value })
    else if (a.get(key) !== value) changed.push({ key, oldValue: a.get(key), newValue: value })
    else unchanged++
  }
  for (const [key, value] of a) {
    if (!b.has(key)) removed.push({ key, value })
  }
  return { mode: 'keys', added, changed, removed, unchanged, textChanged }
}

export function compareEnv(aText, bText) {
  const a = parseEnv(aText)
  const b = parseEnv(bText)
  const result = { comparable: a.isEnv && b.isEnv, aIsEnv: a.isEnv, bIsEnv: b.isEnv, onlyA: [], onlyB: [], different: [], equal: [] }
  if (!result.comparable) return result

  const am = toMap(a)
  const bm = toMap(b)
  const keys = [...new Set([...am.keys(), ...bm.keys()])].sort()
  for (const key of keys) {
    const row = { key, a: am.has(key) ? am.get(key) : null, b: bm.has(key) ? bm.get(key) : null }
    if (!bm.has(key)) result.onlyA.push(row)
    else if (!am.has(key)) result.onlyB.push(row)
    else if (row.a !== row.b) result.different.push(row)
    else result.equal.push(row)
  }
  return result
}
