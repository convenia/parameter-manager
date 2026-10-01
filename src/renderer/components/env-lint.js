import { linter, lintGutter } from '@codemirror/lint'
import { parseEnv } from '@shared/env.js'

// Expects LF-only text, which is what a CodeMirror document always returns.
export function envDiagnostics(text) {
  const parsed = parseEnv(text)
  if (!parsed.isEnv) return []
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return parsed.warnings.map((warning) => {
    const from = starts[warning.line - 1]
    const end = text.indexOf('\n', from)
    return { from, to: end === -1 ? text.length : end, severity: 'warning', message: warning.message }
  })
}

export function envLint() {
  return [linter((view) => envDiagnostics(view.state.doc.toString()), { delay: 250 }), lintGutter()]
}
