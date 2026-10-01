// .env parsing for validation, diff, and compare. The editor saves the user's raw text
// unchanged — nothing here re-serializes it.

export const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/

const ENTRY = /^\s*(?:export\s+)?([^=]*?)\s*=(.*)$/
const ESCAPES = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

export function normalizeEol(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n')
}

/**
 * @param {string | null | undefined} text
 * @returns {{ entries: { key: string, value: string, line: number }[],
 *             warnings: { line: number, kind: 'invalid' | 'duplicate' | 'unterminated', message: string }[],
 *             isEnv: boolean }}
 */
export function parseEnv(text) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/)
  const entries = []
  const warnings = []
  const firstLineOf = new Map()
  let contentLines = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const trimmed = lines[i].trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    contentLines++

    const match = ENTRY.exec(lines[i])
    if (!match) {
      warnings.push({ line: lineNo, kind: 'invalid', message: 'Expected KEY=value' })
      continue
    }
    const key = match[1]
    if (key === '') {
      warnings.push({ line: lineNo, kind: 'invalid', message: 'Missing key before "="' })
      continue
    }
    if (!KEY_PATTERN.test(key)) {
      warnings.push({ line: lineNo, kind: 'invalid', message: `Invalid key "${key}"` })
      continue
    }

    const parsed = parseValue(match[2].trimStart(), lines, i)
    if (!parsed) {
      warnings.push({ line: lineNo, kind: 'unterminated', message: `Missing closing quote for "${key}"` })
      continue
    }
    i = parsed.endIndex // a multiline double-quoted value consumes the following lines

    if (firstLineOf.has(key)) {
      warnings.push({ line: lineNo, kind: 'duplicate', message: `Duplicate key "${key}" (first defined on line ${firstLineOf.get(key)})` })
    } else {
      firstLineOf.set(key, lineNo)
    }
    entries.push({ key, value: parsed.value, line: lineNo })
  }

  return { entries, warnings, isEnv: entries.length > 0 || contentLines === 0 }
}

export function toMap(parsed) {
  const map = new Map()
  for (const { key, value } of parsed.entries) map.set(key, value)
  return map
}

function parseValue(rest, lines, index) {
  if (rest.startsWith('"')) return parseDoubleQuoted(rest.slice(1), lines, index)
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1)
    return end === -1 ? null : { value: rest.slice(1, end), endIndex: index }
  }
  return { value: rest.replace(/\s+#.*$/, '').trim(), endIndex: index }
}

function parseDoubleQuoted(body, lines, index) {
  let value = ''
  let text = body
  let i = index
  for (;;) {
    for (let p = 0; p < text.length; p++) {
      const ch = text[p]
      if (ch === '\\' && p + 1 < text.length) {
        const next = text[p + 1]
        value += ESCAPES[next] ?? `\\${next}`
        p++
      } else if (ch === '"') {
        return { value, endIndex: i }
      } else {
        value += ch
      }
    }
    i++
    if (i >= lines.length) return null
    value += '\n'
    text = lines[i]
  }
}
