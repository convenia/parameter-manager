export const COLUMNS = Object.freeze([
  { key: 'name', label: 'Name' },
  { key: 'tier', label: 'Tier' },
  { key: 'type', label: 'Type' },
  { key: 'dataType', label: 'Data type' },
  { key: 'version', label: 'Version' },
  { key: 'lastModifiedDate', label: 'Last modified' },
  { key: 'lastModifiedUser', label: 'Last modified user' },
  { key: 'description', label: 'Description' }
])

export function filterRows(rows, { query = '', prefix = '' } = {}) {
  const q = query.trim().toLowerCase()
  const folder = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix
  return rows.filter((row) => {
    if (folder && !row.name.startsWith(folder)) return false
    if (!q) return true
    return row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q)
  })
}

export function sortRows(rows, column, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1
  return [...rows].sort((x, y) => {
    const a = x[column]
    const b = y[column]
    const aEmpty = isEmpty(a)
    const bEmpty = isEmpty(b)
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
    return compareValues(a, b, column) * factor
  })
}

function isEmpty(value) {
  return value === null || value === undefined || value === ''
}

function compareValues(a, b, column) {
  if (column === 'version') return Number(a) - Number(b)
  if (column === 'lastModifiedDate') return Date.parse(a) - Date.parse(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}
