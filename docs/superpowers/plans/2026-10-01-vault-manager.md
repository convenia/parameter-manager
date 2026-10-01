# Vault Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app, in plain JavaScript, that lists every AWS SSM Parameter Store parameter with the AWS console's metadata, edits values as `.env` text in CodeMirror, and looks like MongoDB Compass.

**Architecture:** The Electron main process (ESM) is the only code that talks to AWS. It wraps `@aws-sdk/client-ssm` in a small service, keeps one service per saved connection, and exposes a fixed set of IPC channels that always return `{ ok, data | error }`. A sandboxed CommonJS preload turns those channels into `window.vault`. The renderer is framework-free DOM code bundled by electron-vite: views built with a tiny `h()` helper, CodeMirror 6 for the editor and line diffs, and pure logic in `src/shared/` that main, renderer, and tests all import. An in-memory fake SSM backend (`VAULT_FAKE_SSM=1`) powers the demo mode and the end-to-end tests, so nothing automated ever touches real AWS.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7, CodeMirror 6, AWS SDK for JavaScript v3, Vitest 4 + jsdom 29, Playwright 1.63 (Electron), electron-builder 26. Node ≥ 20.19.

**Spec:** `docs/superpowers/specs/2026-10-01-ssm-vault-manager-design.md`

**Pre-verified:** Every code block in this plan was extracted into a scratch project and run before hand-off. All 36 Vitest files (259 tests) and the 4 Playwright Electron specs passed on Node 20.19.3 with Electron 44, electron-vite 5, Vite 7, Vitest 4, and jsdom 29. The demo was also checked visually in light and dark themes. Copy the code as written. If a step fails, suspect version drift first and debug it (superpowers:systematic-debugging) before changing an assertion.

## Global Constraints

- Plain vanilla JavaScript only: `.js` (ESM) everywhere, plus the generated `out/preload/index.cjs`. No TypeScript, no `tsconfig`, no `.ts` files, no UI framework (no React, Vue, or LeafyGreen). Use JSDoc comments if a type hint helps.
- `package.json` has `"type": "module"`. electron-vite entry points are `src/main/index.js`, `src/preload/index.js`, `src/renderer/index.html`.
- Version pins (the local Node is 20.19.3, and newer majors need Node 22): `electron@^44`, `electron-vite@^5`, `vite@^7`, `vitest@^4`, `jsdom@^29`, `@playwright/test@^1.63`, `electron-builder@^26`, `aws-sdk-client-mock@^4`. Use `@smithy/shared-ini-file-loader@^4`, not the deprecated `@aws-sdk/shared-ini-file-loader`.
- `dependencies` hold only main-process runtime libraries (`@aws-sdk/client-ssm`, `@aws-sdk/credential-providers`, `@smithy/shared-ini-file-loader`). Renderer libraries (CodeMirror, `@lezer/highlight`, `@fontsource/source-code-pro`) go in `devDependencies`, because Vite bundles them.
- Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `will-navigate` blocked except the dev server origin, `setWindowOpenHandler` denies everything. CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`.
- Credentials never reach the renderer, and parameter values are never logged or written to disk by the app. Main logs only error code, parameter name, and message.
- No automated test may contact AWS. Unit tests use `aws-sdk-client-mock` or `FakeSsmService`; e2e runs with `VAULT_FAKE_SSM=1` and an isolated `VAULT_USER_DATA`.
- Modules under `src/main/` other than `index.js` and `window.js` must not import `electron` (Vitest cannot load it). Pass Electron objects (like `ipcMain`) in as arguments.
- Parameter limits: Standard tier 4096 bytes, Advanced 8192 bytes (UTF-8). Name ≤ 1011 characters, ≤ 15 hierarchy levels, characters `a-zA-Z0-9_.-/`, no `aws`/`ssm` prefix.
- Look: MongoDB Compass / LeafyGreen palette (`#001E2B` navy, greens `#00ED64`/`#00A35C`/`#00684A`, Compass grays), dark navy sidebar, 6 px radius buttons and inputs, green focus ring, toasts bottom-left.
- Renderer tests that touch the DOM start with `// @vitest-environment jsdom`. Everything else runs in the default `node` environment.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

These are inputs the spec implies but never spells out. Each one has a pinning test in the task that owns the code.

1. **CRLF values.** A value written on Windows (`\r\n`) loads into CodeMirror, which normalizes line endings to `\n`. Expected: the tab is *not* dirty and the diff shows no changes until the user edits. Pinned in Task 2 (`parseEnv` CRLF), Task 3 (`diffEnv` ignores line endings), and Task 14 (editor not dirty after a CRLF load).
2. **Empty value.** Parameter Store rejects an empty `Value`. Expected: saving an emptied editor is blocked with a clear message, before any dialog or AWS call. Pinned in Task 11 (`ssm:put` rejects `''`) and Task 17 (`planSave` and the parameter tab).
3. **SecureString not yet decrypted** (auto-decrypt off). Expected: the app never offers to save the hidden or ciphertext value; you must decrypt first. Pinned in Task 17 (`planSave` blocks `original === null`; the tab shows "Decrypt & show" and no editor).
4. **Double save.** Pressing `Ctrl+S` twice, or `Ctrl+S` while the save dialog is open, must produce exactly one dialog and one `PutParameter`. Pinned in Task 17.
5. **Very large accounts** (thousands of parameters). Expected: the table stays responsive by rendering 500 rows with a "Show more" button, while search and sort still cover every row. Pinned in Task 20.

---

## File map

```
package.json, electron.vite.config.js, vitest.config.js, playwright.config.js, electron-builder.yml, README.md
src/shared/   channels.js env.js diff.js names.js format.js settings.js tree.js table.js
src/main/     index.js window.js navigation.js errors.js store.js profiles.js
              ssm-service.js fake-seed.js fake-ssm-service.js clients.js ipc.js
src/preload/  index.js
src/renderer/ index.html app.js api.js theme.js tabs.js
              lib/        dom.js form.js regions.js save-plan.js
              styles/     tokens.css base.css editor.css diff.css connections.css workspace.css
                          parameters.css parameter.css compare.css dialogs.css
              components/ icons.js badges.js toast.js modal.js env-language.js env-lint.js
                          env-editor.js diff-view.js
              views/      connections.js workspace.js sidebar-tree.js parameters.js parameter.js
                          history-panel.js create-parameter.js compare.js settings.js
test/         setup.js fixtures/aws/{config,credentials}
              unit/*.test.js (node env)  renderer/*.test.js (jsdom env)  e2e/*.spec.js (Playwright)
```

Task order follows dependencies. Tasks 2–11 are main and shared code. Tasks 12–23 build the renderer bottom-up: components, then tabs, then the workspace, then the app shell. Task 24 is the end-to-end tests and Task 25 is packaging. The app becomes clickable at Task 23 (`npm run demo`).

---
### Task 1: Project scaffold and hardened Electron shell

**Files:**
- Create: `package.json`, `electron.vite.config.js`, `vitest.config.js`, `playwright.config.js`
- Modify: `.gitignore`
- Create: `src/shared/channels.js`, `src/main/navigation.js`, `src/main/window.js`, `src/main/index.js`, `src/preload/index.js`, `src/renderer/index.html`, `src/renderer/app.js`
- Create: `test/setup.js`
- Test: `test/unit/channels.test.js`, `test/unit/navigation.test.js`

**Interfaces:**
- Produces: `API` (nested `{ group: { method: 'group:method' } }`) and `CHANNELS` (flat string array) from `@shared/channels.js`. Preload exposes `window.vault.<group>.<method>(...args)` → `ipcRenderer.invoke('<group>:<method>', ...args)`.
- Produces: `isAllowedNavigation(url: string, devServerUrl?: string): boolean` from `src/main/navigation.js`.
- Produces: `createMainWindow(): BrowserWindow` from `src/main/window.js`.
- Produces: the `@shared` alias in both electron-vite and Vitest configs.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vault-manager",
  "productName": "Vault Manager",
  "version": "0.1.0",
  "description": "Desktop client for AWS SSM Parameter Store",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "author": {
    "name": "Leonardo Lemos",
    "email": "leonardo.lemos@convenia.com.br"
  },
  "license": "UNLICENSED",
  "engines": {
    "node": ">=20.19.0"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "demo": "VAULT_FAKE_SSM=1 electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "electron-vite build && playwright test",
    "dist": "electron-vite build && electron-builder --linux"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install @aws-sdk/client-ssm@^3 @aws-sdk/credential-providers@^3 @smithy/shared-ini-file-loader@^4
npm install -D electron@^44 electron-vite@^5 vite@^7 vitest@^4 jsdom@^29 @playwright/test@^1.63 electron-builder@^26 aws-sdk-client-mock@^4 codemirror@^6 @codemirror/state@^6 @codemirror/view@^6 @codemirror/language@^6 @codemirror/lint@^6 @codemirror/merge@^6 @codemirror/search@^6 @lezer/highlight@^1 @fontsource/source-code-pro@^5
```

Expected: both commands finish without `ERESOLVE` errors. `package.json` now has a `dependencies` block with exactly the three AWS/Smithy packages, and everything else is under `devDependencies`.

- [ ] **Step 3: Add the build and test configuration**

`electron.vite.config.js`:

```js
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// One alias for code shared by main, preload, and renderer. Dependencies listed in
// package.json "dependencies" stay external in main/preload (electron-vite 5 default).
const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias }
  }
})
```

`vitest.config.js`:

```js
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    setupFiles: ['test/setup.js'],
    restoreMocks: true
  }
})
```

`playwright.config.js`:

```js
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
```

`test/setup.js`:

```js
// CodeMirror measures text through Range rectangles, which jsdom does not implement.
if (typeof Range !== 'undefined') {
  const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() { return this } }
  Range.prototype.getClientRects ??= function getClientRects() { return Object.assign([], { item: () => null }) }
  Range.prototype.getBoundingClientRect ??= function getBoundingClientRect() { return emptyRect }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
}
```

Append to `.gitignore`:

```
.vite/
```

(`out/`, `dist/`, `node_modules/`, `test-results/`, and `playwright-report/` are already listed.)

- [ ] **Step 4: Write the failing tests**

`test/unit/channels.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { API, CHANNELS } from '@shared/channels.js'

describe('IPC channels', () => {
  it('lists every channel exactly once', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length)
    expect(CHANNELS).toHaveLength(14)
  })

  it('names each channel group:method after the API shape', () => {
    for (const [group, methods] of Object.entries(API)) {
      for (const [method, channel] of Object.entries(methods)) {
        expect(channel).toBe(`${group}:${method}`)
      }
    }
  })
})
```

`test/unit/navigation.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from '../../src/main/navigation.js'

describe('isAllowedNavigation', () => {
  it('blocks every navigation in production', () => {
    expect(isAllowedNavigation('file:///tmp/other.html', undefined)).toBe(false)
    expect(isAllowedNavigation('https://example.com', undefined)).toBe(false)
  })

  it('allows only the dev server origin in development', () => {
    const dev = 'http://localhost:5173'
    expect(isAllowedNavigation('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isAllowedNavigation('http://localhost:5174/', dev)).toBe(false)
    expect(isAllowedNavigation('https://evil.example', dev)).toBe(false)
  })

  it('treats malformed URLs as blocked', () => {
    expect(isAllowedNavigation('not a url', 'http://localhost:5173')).toBe(false)
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run test/unit/channels.test.js test/unit/navigation.test.js`
Expected: FAIL, with both files reporting `Failed to load url` / `Cannot find module` for `channels.js` and `navigation.js`.

- [ ] **Step 6: Implement the channel list and navigation guard**

`src/shared/channels.js`:

```js
// The whole IPC surface. The preload builds window.vault from it and main registers
// one handler per channel, so a channel cannot exist on only one side.
export const API = Object.freeze({
  app: { info: 'app:info' },
  profiles: { list: 'profiles:list' },
  connections: {
    list: 'connections:list',
    save: 'connections:save',
    delete: 'connections:delete',
    test: 'connections:test'
  },
  settings: { get: 'settings:get', save: 'settings:save' },
  ssm: {
    list: 'ssm:list',
    get: 'ssm:get',
    tags: 'ssm:tags',
    history: 'ssm:history',
    put: 'ssm:put',
    delete: 'ssm:delete'
  }
})

export const CHANNELS = Object.freeze(Object.values(API).flatMap((group) => Object.values(group)))
```

`src/main/navigation.js`:

```js
/**
 * The renderer never navigates. In development the only allowed origin is the Vite
 * dev server (full reloads); in production every navigation is blocked.
 * @param {string} url
 * @param {string | undefined} devServerUrl
 */
export function isAllowedNavigation(url, devServerUrl) {
  if (!devServerUrl) return false
  try {
    return new URL(url).origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/unit/channels.test.js test/unit/navigation.test.js`
Expected: PASS (5 tests).

- [ ] **Step 8: Add the window, main entry, preload, and placeholder renderer**

`src/main/window.js`:

```js
import { BrowserWindow, Menu } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedNavigation } from './navigation.js'

const here = dirname(fileURLToPath(import.meta.url))

export function installMenu() {
  // A minimal menu: keeps copy/paste shortcuts (needed on macOS) without the default
  // "Close Window" accelerator, so Ctrl+W can close tabs instead.
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    ...(process.env.ELECTRON_RENDERER_URL ? [{ role: 'viewMenu' }] : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function createMainWindow() {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Vault Manager',
    backgroundColor: '#001E2B',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devServerUrl)) event.preventDefault()
  })

  if (devServerUrl) win.loadURL(devServerUrl)
  else win.loadFile(join(here, '../renderer/index.html'))
  return win
}
```

`src/main/index.js`:

```js
import { app, BrowserWindow } from 'electron'
import { createMainWindow, installMenu } from './window.js'

app.whenReady().then(() => {
  installMenu()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.js`:

```js
import { contextBridge, ipcRenderer } from 'electron'
import { API } from '@shared/channels.js'

// window.vault.<group>.<method>(...args) → ipcRenderer.invoke('<group>:<method>', ...args)
const bridge = Object.fromEntries(
  Object.entries(API).map(([group, methods]) => [
    group,
    Object.fromEntries(
      Object.entries(methods).map(([method, channel]) => [method, (...args) => ipcRenderer.invoke(channel, ...args)])
    )
  ])
)

contextBridge.exposeInMainWorld('vault', bridge)
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    />
    <title>Vault Manager</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
```

`src/renderer/app.js` (placeholder; Task 22 replaces it):

```js
document.getElementById('app').textContent = window.vault ? 'Vault Manager' : 'Preload missing'
```

- [ ] **Step 9: Verify the build produces a CommonJS preload**

Run: `npm run build && ls out/main/index.js out/preload/index.cjs out/renderer/index.html`
Expected: the build succeeds and all three paths are listed. `head -c 200 out/preload/index.cjs` shows `require("electron")`, not `import`.

Then run `npm run dev` by hand. Expected: a window titled "Vault Manager" shows the text "Vault Manager". Close it.

- [ ] **Step 10: Run the full unit suite and commit**

Run: `npm test`
Expected: PASS (2 files, 5 tests).

```bash
git add package.json package-lock.json electron.vite.config.js vitest.config.js playwright.config.js .gitignore src test
git commit -m "chore: scaffold electron-vite app with hardened window and IPC channel list

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 2: `.env` parser

**Files:**
- Create: `src/shared/env.js`
- Test: `test/unit/env.test.js`

**Interfaces:**
- Produces: `parseEnv(text: string | null | undefined) → { entries: Array<{ key, value, line }>, warnings: Array<{ line, kind: 'invalid' | 'duplicate' | 'unterminated', message }>, isEnv: boolean }`. Line numbers are 1-based.
- Produces: `toMap(parsed) → Map<string, string>` (insertion order of first occurrence; the last value wins).
- Produces: `normalizeEol(text) → string` (CRLF/CR → LF).
- Produces: `KEY_PATTERN` (`/^[A-Za-z_][A-Za-z0-9_.-]*$/`).

- [ ] **Step 1: Write the failing test**

`test/unit/env.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { normalizeEol, parseEnv, toMap } from '@shared/env.js'

const entries = (text) => parseEnv(text).entries.map((e) => [e.key, e.value, e.line])

describe('parseEnv', () => {
  it('parses KEY=value lines and skips blank lines and comments', () => {
    expect(entries('# header\n\nA=1\nB=two\n')).toEqual([['A', '1', 3], ['B', 'two', 4]])
  })

  it('accepts an export prefix and whitespace around the key and "="', () => {
    expect(entries('export A=1\n  B  =  2  ')).toEqual([['A', '1', 1], ['B', '2', 2]])
  })

  it('strips inline comments from unquoted values only after whitespace', () => {
    expect(entries('A=value # note\nB=a#b\nC=')).toEqual([['A', 'value', 1], ['B', 'a#b', 2], ['C', '', 3]])
  })

  it('keeps single-quoted values literally', () => {
    expect(entries("A='x # y \\n'")).toEqual([['A', 'x # y \\n', 1]])
  })

  it('expands escapes in double-quoted values and keeps unknown ones', () => {
    expect(entries('A="line1\\nline2 \\"q\\" \\\\ \\x"')).toEqual([['A', 'line1\nline2 "q" \\ \\x', 1]])
  })

  it('lets a double-quoted value span several lines', () => {
    expect(entries('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1')).toEqual([
      ['KEY', '-----BEGIN-----\nabc\n-----END-----', 1],
      ['NEXT', '1', 4]
    ])
  })

  it('warns about an unterminated quote and keeps parsing the following lines', () => {
    const parsed = parseEnv('A="open\nB=2')
    expect(parsed.entries.map((e) => e.key)).toEqual(['B'])
    expect(parsed.warnings).toEqual([{ line: 1, kind: 'unterminated', message: 'Missing closing quote for "A"' }])
  })

  it('warns about lines that are not KEY=value', () => {
    const parsed = parseEnv('A=1\nthis is not valid\n=x\nBAD KEY=1')
    expect(parsed.entries.map((e) => e.key)).toEqual(['A'])
    expect(parsed.warnings.map((w) => [w.line, w.kind, w.message])).toEqual([
      [2, 'invalid', 'Expected KEY=value'],
      [3, 'invalid', 'Missing key before "="'],
      [4, 'invalid', 'Invalid key "BAD KEY"']
    ])
  })

  it('warns about duplicate keys, and toMap keeps the last value', () => {
    const parsed = parseEnv('A=1\nB=2\nA=3')
    expect(parsed.warnings).toEqual([{ line: 3, kind: 'duplicate', message: 'Duplicate key "A" (first defined on line 1)' }])
    expect([...toMap(parsed)]).toEqual([['A', '3'], ['B', '2']])
  })

  it('decides whether the text is .env at all', () => {
    expect(parseEnv('').isEnv).toBe(true)
    expect(parseEnv('# only a comment').isEnv).toBe(true)
    expect(parseEnv('A=1\nnot valid').isEnv).toBe(true)
    expect(parseEnv('{\n  "retries": 3\n}').isEnv).toBe(false)
    expect(parseEnv('just a token').isEnv).toBe(false)
  })

  it('treats CRLF and CR line endings like LF', () => {
    expect(entries('A=1\r\nB=2\rC=3')).toEqual([['A', '1', 1], ['B', '2', 2], ['C', '3', 3]])
  })

  it('treats null and undefined as empty text', () => {
    expect(parseEnv(undefined)).toEqual({ entries: [], warnings: [], isEnv: true })
    expect(parseEnv(null).isEnv).toBe(true)
  })
})

describe('normalizeEol', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/env.test.js`
Expected: FAIL, because `@shared/env.js` cannot be resolved.

- [ ] **Step 3: Implement the parser**

`src/shared/env.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/env.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/env.js test/unit/env.test.js
git commit -m "feat: add .env parser with warnings for invalid, duplicate, and unterminated lines

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Key-level diff and compare

**Files:**
- Create: `src/shared/diff.js`
- Test: `test/unit/diff.test.js`

**Interfaces:**
- Consumes: `parseEnv`, `toMap`, `normalizeEol` from `@shared/env.js` (Task 2).
- Produces: `diffEnv(oldText, newText)` → either `{ mode: 'keys', added: [{ key, value }], changed: [{ key, oldValue, newValue }], removed: [{ key, value }], unchanged: number, textChanged: boolean }` or `{ mode: 'lines', oldText, newText, textChanged }`.
- Produces: `compareEnv(aText, bText)` → `{ comparable, aIsEnv, bIsEnv, onlyA, onlyB, different, equal }`. Each list holds `{ key, a, b }` sorted by key, with `null` for a missing side.

- [ ] **Step 1: Write the failing test**

`test/unit/diff.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { compareEnv, diffEnv } from '@shared/diff.js'

describe('diffEnv', () => {
  it('reports added, changed, removed, and unchanged keys', () => {
    expect(diffEnv('A=1\nB=2\nC=3', 'A=1\nB=20\nD=4')).toEqual({
      mode: 'keys',
      added: [{ key: 'D', value: '4' }],
      changed: [{ key: 'B', oldValue: '2', newValue: '20' }],
      removed: [{ key: 'C', value: '3' }],
      unchanged: 1,
      textChanged: true
    })
  })

  it('notices text changes that touch no key', () => {
    const diff = diffEnv('A=1', '# comment\nA=1')
    expect(diff.mode).toBe('keys')
    expect(diff.added.length + diff.changed.length + diff.removed.length).toBe(0)
    expect(diff.textChanged).toBe(true)
  })

  it('ignores line-ending differences', () => {
    const diff = diffEnv('A=1\r\nB=2', 'A=1\nB=2')
    expect(diff.textChanged).toBe(false)
    expect(diff.unchanged).toBe(2)
  })

  it('falls back to line mode when either side is not .env', () => {
    expect(diffEnv('{"a":1}', 'A=1')).toEqual({ mode: 'lines', oldText: '{"a":1}', newText: 'A=1', textChanged: true })
    expect(diffEnv('A=1', 'plain text').mode).toBe('lines')
  })

  it('treats an empty old value as .env, so every key shows as added', () => {
    expect(diffEnv('', 'A=1').added).toEqual([{ key: 'A', value: '1' }])
  })
})

describe('compareEnv', () => {
  it('sorts keys into onlyA, onlyB, different, and equal, alphabetically', () => {
    expect(compareEnv('B=1\nA=1\nX=same', 'A=2\nC=3\nX=same')).toEqual({
      comparable: true,
      aIsEnv: true,
      bIsEnv: true,
      onlyA: [{ key: 'B', a: '1', b: null }],
      onlyB: [{ key: 'C', a: null, b: '3' }],
      different: [{ key: 'A', a: '1', b: '2' }],
      equal: [{ key: 'X', a: 'same', b: 'same' }]
    })
  })

  it('refuses to compare values that are not .env', () => {
    const result = compareEnv('A=1', '{"json":true}')
    expect(result.comparable).toBe(false)
    expect(result.aIsEnv).toBe(true)
    expect(result.bIsEnv).toBe(false)
    expect(result.onlyA).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/diff.test.js`
Expected: FAIL, because `@shared/diff.js` cannot be resolved.

- [ ] **Step 3: Implement diff and compare**

`src/shared/diff.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/diff.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/diff.js test/unit/diff.test.js
git commit -m "feat: add key-level .env diff and two-parameter compare

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Parameter names, size limits, and formatting

**Files:**
- Create: `src/shared/names.js`, `src/shared/format.js`
- Test: `test/unit/names.test.js`, `test/unit/format.test.js`

**Interfaces:**
- Produces from `@shared/names.js`: `TIER_LIMITS` (`{ Standard: 4096, Advanced: 8192 }`), `MAX_NAME_LENGTH` (1011), `MAX_HIERARCHY_DEPTH` (15), `PARAMETER_TYPES` (`['String', 'StringList', 'SecureString']`), `PARAMETER_TIERS` (`['Standard', 'Advanced']`), `validateName(name) → string | null` (an error message, or `null` when valid), `byteLength(value) → number` (UTF-8), `tierLimit(tier) → number` (unknown tiers count as Standard).
- Produces from `@shared/format.js`: `formatDate(iso, { locale?, timeZone? }) → string` (`'—'` when missing or invalid), `formatNumber(n) → string` (`en-US` grouping), `formatCount(n, singular, plural?) → string`.

- [ ] **Step 1: Write the failing tests**

`test/unit/names.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { byteLength, tierLimit, validateName } from '@shared/names.js'

const levels = (n) => '/' + Array.from({ length: n }, (_, i) => `l${i}`).join('/')

describe('validateName', () => {
  it.each(['my-param', '/myapp/prod/env', '/a_b.c-d/E1', 'x'])('accepts %s', (name) => {
    expect(validateName(name)).toBeNull()
  })

  it('accepts exactly 15 hierarchy levels', () => {
    expect(validateName(levels(15))).toBeNull()
  })

  it.each([
    ['', 'Name is required'],
    ['has space', 'Only letters, numbers, and _ . - / are allowed'],
    ['myapp/prod', 'Hierarchical names must start with "/"'],
    ['/myapp/', 'Name cannot end with "/"'],
    ['/myapp//env', 'Name cannot contain empty path segments'],
    ['/aws/thing', 'Names cannot begin with "aws" or "ssm"'],
    ['SSM-param', 'Names cannot begin with "aws" or "ssm"'],
    [levels(16), 'Names can have at most 15 hierarchy levels'],
    ['a'.repeat(1012), 'Name must be at most 1011 characters']
  ])('rejects %j', (name, message) => {
    expect(validateName(name)).toBe(message)
  })

  it('rejects non-strings as missing', () => {
    expect(validateName(undefined)).toBe('Name is required')
  })
})

describe('byteLength and tierLimit', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('ç')).toBe(2)
    expect(byteLength('€')).toBe(3)
    expect(byteLength('😀')).toBe(4)
    expect(byteLength(null)).toBe(0)
  })

  it('knows the tier limits and treats unknown tiers as Standard', () => {
    expect(tierLimit('Standard')).toBe(4096)
    expect(tierLimit('Advanced')).toBe(8192)
    expect(tierLimit('Intelligent-Tiering')).toBe(4096)
    expect(tierLimit(undefined)).toBe(4096)
  })
})
```

`test/unit/format.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'

describe('formatDate', () => {
  it('formats ISO dates in the given locale and time zone', () => {
    const text = formatDate('2026-10-01T12:30:00.000Z', { locale: 'en-US', timeZone: 'UTC' })
    // ICU uses a narrow no-break space before AM/PM; normalize whitespace for the assertion.
    expect(text.replace(/\s/g, ' ')).toBe('Oct 1, 2026, 12:30 PM')
  })

  it('returns an em dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })
})

describe('formatNumber and formatCount', () => {
  it('groups thousands', () => {
    expect(formatNumber(4096)).toBe('4,096')
  })

  it('pluralizes', () => {
    expect(formatCount(1, 'parameter')).toBe('1 parameter')
    expect(formatCount(1234, 'parameter')).toBe('1,234 parameters')
    expect(formatCount(2, 'match', 'matches')).toBe('2 matches')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/names.test.js test/unit/format.test.js`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement names and formatting**

`src/shared/names.js`:

```js
export const TIER_LIMITS = Object.freeze({ Standard: 4096, Advanced: 8192 })
export const MAX_NAME_LENGTH = 1011
export const MAX_HIERARCHY_DEPTH = 15
export const PARAMETER_TYPES = Object.freeze(['String', 'StringList', 'SecureString'])
export const PARAMETER_TIERS = Object.freeze(['Standard', 'Advanced'])

const ALLOWED = /^[A-Za-z0-9_.\-/]+$/
const encoder = new TextEncoder()

/** @returns {string | null} an error message, or null when the name is valid */
export function validateName(name) {
  const value = typeof name === 'string' ? name : ''
  if (value === '') return 'Name is required'
  if (value.length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters`
  if (!ALLOWED.test(value)) return 'Only letters, numbers, and _ . - / are allowed'
  if (value.includes('/')) {
    if (!value.startsWith('/')) return 'Hierarchical names must start with "/"'
    if (value.endsWith('/')) return 'Name cannot end with "/"'
    if (value.includes('//')) return 'Name cannot contain empty path segments'
  }
  const segments = value.split('/').filter(Boolean)
  if (segments.length > MAX_HIERARCHY_DEPTH) return `Names can have at most ${MAX_HIERARCHY_DEPTH} hierarchy levels`
  if (/^(aws|ssm)/i.test(segments[0])) return 'Names cannot begin with "aws" or "ssm"'
  return null
}

export function byteLength(value) {
  return encoder.encode(String(value ?? '')).length
}

export function tierLimit(tier) {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.Standard
}
```

`src/shared/format.js`:

```js
export function formatDate(iso, { locale, timeZone } = {}) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date)
}

export function formatNumber(value) {
  return Number(value).toLocaleString('en-US')
}

export function formatCount(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/names.test.js test/unit/format.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/names.js src/shared/format.js test/unit/names.test.js test/unit/format.test.js
git commit -m "feat: add SSM name validation, tier byte limits, and formatting helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sidebar tree and table logic

**Files:**
- Create: `src/shared/tree.js`, `src/shared/table.js`
- Test: `test/unit/tree.test.js`, `test/unit/table.test.js`

**Interfaces:**
- Produces from `@shared/tree.js`: `buildTree(names: string[]) → FolderNode`, where `FolderNode = { type: 'folder', name, path, count, children: Array<FolderNode | LeafNode> }` and `LeafNode = { type: 'leaf', name, path }`. The root is `{ type: 'folder', name: '', path: '', … }`. Children are sorted folders first, then by name. `count` is the number of leaves below.
- Produces: `filterTree(tree, query) → FolderNode`. A blank query returns the same object. Otherwise you get a pruned copy (case-insensitive match on the full path), or an empty root.
- Produces from `@shared/table.js`: `COLUMNS` (ordered `{ key, label }` for Name, Tier, Type, Data type, Version, Last modified, Last modified user, Description), `filterRows(rows, { query?, prefix? }) → rows`, `sortRows(rows, column, direction = 'asc') → new array` (empty values always last).

- [ ] **Step 1: Write the failing tests**

`test/unit/tree.test.js`:

```js
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
```

`test/unit/table.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { COLUMNS, filterRows, sortRows } from '@shared/table.js'

const rows = [
  { name: '/b/two', version: 10, lastModifiedDate: '2026-09-02T00:00:00.000Z', description: 'Second' },
  { name: '/a/one', version: 2, lastModifiedDate: '2026-09-10T00:00:00.000Z', description: '' },
  { name: 'legacy', version: 1, lastModifiedDate: null, description: 'Old TOKEN' },
  { name: '/ab/x', version: 3, lastModifiedDate: '2026-09-05T00:00:00.000Z', description: '' }
]
const names = (list) => list.map((r) => r.name)

describe('COLUMNS', () => {
  it('matches the AWS console columns', () => {
    expect(COLUMNS.map((c) => c.label)).toEqual(['Name', 'Tier', 'Type', 'Data type', 'Version', 'Last modified', 'Last modified user', 'Description'])
  })
})

describe('filterRows', () => {
  it('searches name and description case-insensitively', () => {
    expect(names(filterRows(rows, { query: 'token' }))).toEqual(['legacy'])
    expect(names(filterRows(rows, { query: 'ONE' }))).toEqual(['/a/one'])
  })

  it('limits to a folder prefix on segment boundaries', () => {
    expect(names(filterRows(rows, { prefix: '/a' }))).toEqual(['/a/one'])
    expect(names(filterRows(rows, { prefix: '/a/' }))).toEqual(['/a/one'])
  })

  it('returns every row without filters', () => {
    expect(filterRows(rows)).toHaveLength(4)
  })
})

describe('sortRows', () => {
  it('sorts versions numerically', () => {
    expect(sortRows(rows, 'version').map((r) => r.version)).toEqual([1, 2, 3, 10])
    expect(sortRows(rows, 'version', 'desc').map((r) => r.version)).toEqual([10, 3, 2, 1])
  })

  it('sorts dates chronologically and keeps empty values last in both directions', () => {
    expect(names(sortRows(rows, 'lastModifiedDate'))).toEqual(['/b/two', '/ab/x', '/a/one', 'legacy'])
    expect(names(sortRows(rows, 'lastModifiedDate', 'desc'))).toEqual(['/a/one', '/ab/x', '/b/two', 'legacy'])
  })

  it('sorts text with natural ordering and does not mutate the input', () => {
    const copy = [...rows]
    expect(names(sortRows(rows, 'name'))).toEqual(['/a/one', '/ab/x', '/b/two', 'legacy'])
    expect(rows).toEqual(copy)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/tree.test.js test/unit/table.test.js`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement the tree and table helpers**

`src/shared/tree.js`:

```js
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
```

`src/shared/table.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/tree.test.js test/unit/table.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tree.js src/shared/table.js test/unit/tree.test.js test/unit/table.test.js
git commit -m "feat: add parameter tree, table filtering, and sorting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Error normalization

**Files:**
- Create: `src/main/errors.js`
- Test: `test/unit/errors.test.js`

**Interfaces:**
- Produces: `class AppError extends Error { code, hint, details }`, built as `new AppError(code, message, { hint?, details? })`.
- Produces: `toIpcError(err, context?: { action?, name?, profile? }) → { code, message, hint, details }`.
- Produces: `CREDENTIAL_ERROR_CODES` (a `Set` of `ExpiredCredentials`, `CredentialsError`, `InvalidCredentials`).
- Produces: `versionConflictError(name, currentVersion, expectedVersion) → AppError` with code `VersionConflict` and `details.currentVersion`.

- [ ] **Step 1: Write the failing test**

`test/unit/errors.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { AppError, CREDENTIAL_ERROR_CODES, toIpcError, versionConflictError } from '../../src/main/errors.js'

const awsError = (name, message = 'AWS says no', extra = {}) => Object.assign(new Error(message), { name, ...extra })
const ctx = { action: 'write', name: '/myapp/prod/env', profile: 'prod' }

describe('toIpcError', () => {
  it('passes AppError through unchanged', () => {
    const err = new AppError('ReadOnlyConnection', 'Read only.', { hint: 'Edit it.', details: { x: 1 } })
    expect(toIpcError(err)).toEqual({ code: 'ReadOnlyConnection', message: 'Read only.', hint: 'Edit it.', details: { x: 1 } })
  })

  it('maps AccessDeniedException with the action, target, and profile', () => {
    const out = toIpcError(awsError('AccessDeniedException', 'User is not authorized to perform ssm:PutParameter'), ctx)
    expect(out.code).toBe('AccessDenied')
    expect(out.message).toBe('Not allowed to write on /myapp/prod/env.')
    expect(out.hint).toContain('profile "prod"')
    expect(out.hint).toContain('ssm:PutParameter')
  })

  it.each(['ExpiredTokenException', 'ExpiredToken', 'RequestExpired'])('maps %s to ExpiredCredentials', (name) => {
    const out = toIpcError(awsError(name), ctx)
    expect(out.code).toBe('ExpiredCredentials')
    expect(out.hint).toContain('aws sso login --profile prod')
  })

  it('maps credential provider errors, separating expired SSO sessions', () => {
    expect(toIpcError(awsError('CredentialsProviderError', 'The SSO session has expired'), ctx).code).toBe('ExpiredCredentials')
    expect(toIpcError(awsError('TokenProviderError', 'SSO Token refresh failed'), ctx).code).toBe('ExpiredCredentials')
    const missing = toIpcError(awsError('CredentialsProviderError', 'Could not resolve credentials using profile: [prod]'), ctx)
    expect(missing.code).toBe('CredentialsError')
    expect(missing.message).toBe('Could not load credentials for profile "prod".')
  })

  it.each(['UnrecognizedClientException', 'InvalidSignatureException', 'InvalidClientTokenId', 'SignatureDoesNotMatch'])(
    'maps %s to InvalidCredentials',
    (name) => expect(toIpcError(awsError(name), ctx).code).toBe('InvalidCredentials')
  )

  it('maps parameter-level errors', () => {
    expect(toIpcError(awsError('ParameterNotFound'), ctx)).toMatchObject({ code: 'ParameterNotFound', message: '/myapp/prod/env no longer exists.' })
    expect(toIpcError(awsError('ParameterNotFound'))).toMatchObject({ message: 'Parameter not found.' })
    expect(toIpcError(awsError('ParameterAlreadyExists'), ctx)).toMatchObject({ code: 'ParameterAlreadyExists', message: 'A parameter named /myapp/prod/env already exists.' })
    expect(toIpcError(awsError('ParameterMaxVersionLimitExceeded'), ctx)).toMatchObject({ code: 'MaxVersionLimit' })
    expect(toIpcError(awsError('ParameterMaxVersionLimitExceeded'), ctx).hint).toContain('label')
  })

  it('passes validation messages through', () => {
    expect(toIpcError(awsError('ValidationException', 'Value too long'), ctx)).toMatchObject({ code: 'ValidationError', message: 'Value too long' })
    expect(toIpcError(awsError('ParameterPatternMismatchException', 'Bad pattern'), ctx)).toMatchObject({ code: 'ValidationError', message: 'Bad pattern' })
    expect(toIpcError(awsError('InvalidKeyId', 'Key not found'), ctx)).toMatchObject({ code: 'ValidationError', hint: 'Check the KMS key ID or alias.' })
  })

  it('maps throttling and network failures', () => {
    expect(toIpcError(awsError('ThrottlingException'), ctx).code).toBe('Throttled')
    expect(toIpcError(awsError('Error', 'getaddrinfo ENOTFOUND ssm.sa-east-1.amazonaws.com', { code: 'ENOTFOUND' }), ctx).code).toBe('NetworkError')
    expect(toIpcError(awsError('TimeoutError', 'socket timeout'), ctx).code).toBe('NetworkError')
  })

  it('falls back to Unknown with the original name and message', () => {
    expect(toIpcError(awsError('WeirdError', 'something odd'))).toEqual({ code: 'Unknown', message: 'WeirdError: something odd', hint: null, details: null })
    expect(toIpcError('plain string').code).toBe('Unknown')
  })
})

describe('helpers', () => {
  it('builds version conflict errors', () => {
    const err = versionConflictError('/a', 5, 4)
    expect(err).toBeInstanceOf(AppError)
    expect(err.code).toBe('VersionConflict')
    expect(err.message).toBe('/a changed since you opened it: it is now at version 5, and you loaded version 4.')
    expect(err.details).toEqual({ currentVersion: 5 })
  })

  it('lists the credential error codes', () => {
    expect([...CREDENTIAL_ERROR_CODES].sort()).toEqual(['CredentialsError', 'ExpiredCredentials', 'InvalidCredentials'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/errors.test.js`
Expected: FAIL, because `src/main/errors.js` does not exist.

- [ ] **Step 3: Implement the error mapping**

`src/main/errors.js`:

```js
// Every error that crosses IPC becomes { code, message, hint, details }. AWS SDK errors
// are mapped by name; our own failures are AppError instances and pass through as-is.

export class AppError extends Error {
  constructor(code, message, { hint = null, details = null } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.hint = hint
    this.details = details
  }
}

export const CREDENTIAL_ERROR_CODES = new Set(['ExpiredCredentials', 'CredentialsError', 'InvalidCredentials'])

const EXPIRED = new Set(['ExpiredTokenException', 'ExpiredToken', 'RequestExpired'])
const INVALID_CREDENTIALS = new Set(['UnrecognizedClientException', 'InvalidSignatureException', 'InvalidClientTokenId', 'SignatureDoesNotMatch'])
const VALIDATION = new Set([
  'ValidationException',
  'ParameterPatternMismatchException',
  'HierarchyLevelLimitExceededException',
  'HierarchyTypeMismatchException',
  'UnsupportedParameterType',
  'InvalidAllowedPatternException',
  'IncompatiblePolicyException'
])
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'])

export function versionConflictError(name, currentVersion, expectedVersion) {
  return new AppError(
    'VersionConflict',
    `${name} changed since you opened it: it is now at version ${currentVersion}, and you loaded version ${expectedVersion}.`,
    { hint: 'Reload to get the latest value, or overwrite anyway.', details: { currentVersion } }
  )
}

export function toIpcError(err, context = {}) {
  if (err instanceof AppError) return { code: err.code, message: err.message, hint: err.hint, details: err.details }

  const name = err?.name ?? 'Error'
  const awsMessage = err?.message ?? String(err)
  const profile = context.profile ? `profile "${context.profile}"` : 'this profile'
  const ssoCommand = `aws sso login --profile ${context.profile ?? '<profile>'}`
  const out = (code, message, hint = null) => ({ code, message, hint, details: null })

  if (name === 'AccessDeniedException') {
    const target = context.name ? ` on ${context.name}` : ''
    return out('AccessDenied', `Not allowed to ${context.action ?? 'do that'}${target}.`, `Check the IAM permissions of ${profile}. AWS said: ${awsMessage}`)
  }
  if (EXPIRED.has(name)) {
    return out('ExpiredCredentials', 'Your AWS credentials have expired.', `Refresh the credentials for ${profile}. For SSO profiles run: ${ssoCommand}`)
  }
  if (name === 'CredentialsProviderError' || name === 'TokenProviderError') {
    if (/expired|refresh/i.test(awsMessage)) return out('ExpiredCredentials', 'Your AWS session has expired.', `Run: ${ssoCommand}`)
    return out('CredentialsError', `Could not load credentials for ${profile}.`, `Check the profile in your AWS config and credentials files (Settings → AWS files). ${awsMessage}`)
  }
  if (INVALID_CREDENTIALS.has(name)) {
    return out('InvalidCredentials', 'AWS rejected the credentials.', `The access keys for ${profile} are wrong or have been revoked.`)
  }
  if (name === 'ParameterNotFound') {
    return out('ParameterNotFound', context.name ? `${context.name} no longer exists.` : 'Parameter not found.', 'Someone may have deleted it. The list will refresh.')
  }
  if (name === 'ParameterAlreadyExists') {
    return out('ParameterAlreadyExists', context.name ? `A parameter named ${context.name} already exists.` : 'That parameter already exists.')
  }
  if (name === 'ParameterMaxVersionLimitExceeded') {
    return out('MaxVersionLimit', 'This parameter has reached the 100-version limit.', 'The oldest version has a label, so AWS cannot drop it. Move or remove that label in the AWS console.')
  }
  if (name === 'InvalidKeyId') return out('ValidationError', awsMessage, 'Check the KMS key ID or alias.')
  if (VALIDATION.has(name)) return out('ValidationError', awsMessage)
  if (name === 'ThrottlingException' || name === 'TooManyUpdates') {
    return out('Throttled', 'AWS is throttling requests right now.', 'Wait a few seconds and try again.')
  }
  if (NETWORK_CODES.has(err?.code) || name === 'TimeoutError') {
    return out('NetworkError', 'Could not reach AWS.', "Check your network connection and the connection's region.")
  }
  return out('Unknown', `${name}: ${awsMessage}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/errors.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/errors.js test/unit/errors.test.js
git commit -m "feat: normalize AWS and app errors into IPC-safe objects

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Settings and connections store

**Files:**
- Create: `src/shared/settings.js`, `src/main/store.js`
- Test: `test/unit/store.test.js`

**Interfaces:**
- Consumes: `AppError` (Task 6).
- Produces from `@shared/settings.js`: `DEFAULT_SETTINGS` (`{ theme: 'system', autoDecrypt: true, maskValuesInDiff: true, awsConfigFile: '', awsCredentialsFile: '' }`), `THEMES`, `CONNECTION_COLORS` (`['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']`).
- Produces from `src/main/store.js`:
  - `createStore(dir, { now?, newId?, seedConnections? })` → `{ warnings: string[], getSettings(), saveSettings(partial), listConnections(), getConnection(id), saveConnection(input), deleteConnection(id) }`.
  - `sanitizeSettings(input)` and `sanitizeConnection(input, id, createdAt)`; the latter throws `AppError('InvalidInput')`.
  - The connection shape is `{ id, name, profile, region, pathPrefix, color, readOnly, createdAt }`.
  - `getConnection` throws `AppError('InvalidInput')` for unknown ids.

- [ ] **Step 1: Write the failing test**

`test/unit/store.test.js`:

```js
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings.js'
import { createStore } from '../../src/main/store.js'

let dir
let counter = 0
const fixedNow = () => new Date('2026-10-01T12:00:00.000Z')
const open = (options = {}) => createStore(dir, { now: fixedNow, newId: () => `c_${++counter}`, ...options })
const errorOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected an error')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vault-store-'))
})

describe('settings', () => {
  it('starts with the defaults', () => {
    expect(open().getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('saves, drops unknown keys, and survives a reload', () => {
    open().saveSettings({ theme: 'dark', autoDecrypt: false, bogus: 1 })
    expect(open().getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', autoDecrypt: false })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).not.toHaveProperty('bogus')
  })

  it('replaces invalid values with defaults', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'neon', maskValuesInDiff: 'yes', awsConfigFile: 42 }))
    expect(open().getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('moves a corrupt file aside and reports it', () => {
    writeFileSync(join(dir, 'settings.json'), '{ not json')
    const store = open()
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(store.warnings).toHaveLength(1)
    expect(store.warnings[0]).toMatch(/settings\.json was unreadable/)
    expect(readdirSync(dir)).toContain(`settings.json.corrupt-${fixedNow().getTime()}`)
  })

  it('writes atomically without leaving temp files behind', () => {
    open().saveSettings({ theme: 'light' })
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('connections', () => {
  const input = { name: ' Prod ', profile: 'default', region: 'sa-east-1', pathPrefix: ' /myapp ', color: 'green', readOnly: true }

  it('creates a connection with an id and timestamp, trimming text', () => {
    const saved = open().saveConnection(input)
    expect(saved).toEqual({
      id: expect.stringMatching(/^c_\d+$/),
      name: 'Prod',
      profile: 'default',
      region: 'sa-east-1',
      pathPrefix: '/myapp',
      color: 'green',
      readOnly: true,
      createdAt: '2026-10-01T12:00:00.000Z'
    })
    expect(open().listConnections()).toEqual([saved])
  })

  it('updates an existing connection in place, keeping id and createdAt', () => {
    const store = open()
    const saved = store.saveConnection(input)
    const updated = store.saveConnection({ ...saved, name: 'Production', readOnly: false, createdAt: 'ignored' })
    expect(updated).toEqual({ ...saved, name: 'Production', readOnly: false })
    expect(store.listConnections()).toHaveLength(1)
  })

  it('deletes connections', () => {
    const store = open()
    const saved = store.saveConnection(input)
    store.deleteConnection(saved.id)
    expect(open().listConnections()).toEqual([])
  })

  it('rejects connections without a name, profile, or valid region', () => {
    const store = open()
    expect(errorOf(() => store.saveConnection({ ...input, name: '  ' }))).toMatchObject({ code: 'InvalidInput', message: 'Connection name is required.' })
    expect(errorOf(() => store.saveConnection({ ...input, profile: '' })).message).toBe('Choose an AWS profile.')
    expect(errorOf(() => store.saveConnection({ ...input, region: '' })).message).toBe('Region is required.')
    expect(errorOf(() => store.saveConnection({ ...input, region: 'mars-1' })).message).toBe('"mars-1" is not a valid AWS region.')
  })

  it('normalizes unknown colors and non-boolean readOnly', () => {
    const saved = open().saveConnection({ ...input, color: 'chartreuse', readOnly: 'yes' })
    expect(saved.color).toBe('none')
    expect(saved.readOnly).toBe(false)
  })

  it('throws InvalidInput for unknown ids', () => {
    expect(errorOf(() => open().getConnection('nope'))).toMatchObject({ code: 'InvalidInput', message: 'That connection no longer exists.' })
  })

  it('seeds connections only when no connections file exists yet', () => {
    const seed = [{ id: 'demo', ...input }]
    expect(open({ seedConnections: seed }).listConnections().map((c) => c.id)).toEqual(['demo'])
    open().deleteConnection('demo')
    expect(open({ seedConnections: seed }).listConnections()).toEqual([])
  })

  it('skips invalid stored connections and reports them', () => {
    writeFileSync(join(dir, 'connections.json'), JSON.stringify({ version: 1, connections: [{ id: 'bad', name: '' }, { id: 'ok', ...input }] }))
    const store = open()
    expect(store.listConnections().map((c) => c.id)).toEqual(['ok'])
    expect(store.warnings[0]).toMatch(/Skipped a saved connection/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/store.test.js`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement the shared defaults and the store**

`src/shared/settings.js`:

```js
export const THEMES = Object.freeze(['system', 'light', 'dark'])

export const CONNECTION_COLORS = Object.freeze(['none', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'])

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  autoDecrypt: true,
  maskValuesInDiff: true,
  awsConfigFile: '',
  awsCredentialsFile: ''
})
```

`src/main/store.js`:

```js
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CONNECTION_COLORS, DEFAULT_SETTINGS, THEMES } from '@shared/settings.js'
import { AppError } from './errors.js'

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/

export function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {}
  const bool = (key) => (typeof src[key] === 'boolean' ? src[key] : DEFAULT_SETTINGS[key])
  const path = (key) => (typeof src[key] === 'string' ? src[key].trim() : DEFAULT_SETTINGS[key])
  return {
    theme: THEMES.includes(src.theme) ? src.theme : DEFAULT_SETTINGS.theme,
    autoDecrypt: bool('autoDecrypt'),
    maskValuesInDiff: bool('maskValuesInDiff'),
    awsConfigFile: path('awsConfigFile'),
    awsCredentialsFile: path('awsCredentialsFile')
  }
}

export function sanitizeConnection(input, id, createdAt) {
  const src = input && typeof input === 'object' ? input : {}
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const connection = {
    id,
    name: text(src.name),
    profile: text(src.profile),
    region: text(src.region),
    pathPrefix: text(src.pathPrefix),
    color: CONNECTION_COLORS.includes(src.color) ? src.color : 'none',
    readOnly: src.readOnly === true,
    createdAt
  }
  if (!connection.name) throw new AppError('InvalidInput', 'Connection name is required.')
  if (!connection.profile) throw new AppError('InvalidInput', 'Choose an AWS profile.')
  if (!connection.region) throw new AppError('InvalidInput', 'Region is required.')
  if (!REGION.test(connection.region)) throw new AppError('InvalidInput', `"${connection.region}" is not a valid AWS region.`)
  return connection
}

export function createStore(dir, { now = () => new Date(), newId = () => `c_${randomBytes(6).toString('hex')}`, seedConnections = [] } = {}) {
  mkdirSync(dir, { recursive: true })
  const settingsFile = join(dir, 'settings.json')
  const connectionsFile = join(dir, 'connections.json')
  const warnings = []

  let settings = sanitizeSettings(readJson(settingsFile, {}))
  const stored = readJson(connectionsFile, null)
  let connections = stored === null ? seed() : load(stored)
  if (stored === null && connections.length > 0) persistConnections()

  return {
    warnings,
    getSettings: () => ({ ...settings }),
    saveSettings(input) {
      settings = sanitizeSettings({ ...settings, ...input })
      writeJsonAtomic(settingsFile, settings)
      return { ...settings }
    },
    listConnections: () => connections.map((c) => ({ ...c })),
    getConnection(id) {
      const found = connections.find((c) => c.id === id)
      if (!found) throw new AppError('InvalidInput', 'That connection no longer exists.')
      return { ...found }
    },
    saveConnection(input) {
      const existing = input?.id ? connections.find((c) => c.id === input.id) : null
      const saved = sanitizeConnection(input, existing?.id ?? newId(), existing?.createdAt ?? now().toISOString())
      connections = existing ? connections.map((c) => (c.id === saved.id ? saved : c)) : [...connections, saved]
      persistConnections()
      return { ...saved }
    },
    deleteConnection(id) {
      connections = connections.filter((c) => c.id !== id)
      persistConnections()
    }
  }

  function seed() {
    return seedConnections.map((c) => sanitizeConnection(c, c.id ?? newId(), c.createdAt ?? now().toISOString()))
  }

  function load(data) {
    const list = Array.isArray(data?.connections) ? data.connections : []
    return list.flatMap((c) => {
      try {
        return [sanitizeConnection(c, typeof c?.id === 'string' ? c.id : newId(), typeof c?.createdAt === 'string' ? c.createdAt : now().toISOString())]
      } catch (err) {
        warnings.push(`Skipped a saved connection that is no longer valid (${err.message})`)
        return []
      }
    })
  }

  function persistConnections() {
    writeJsonAtomic(connectionsFile, { version: 1, connections })
  }

  function readJson(file, fallback) {
    if (!existsSync(file)) return fallback
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      const backup = `${file}.corrupt-${now().getTime()}`
      renameSync(file, backup)
      warnings.push(`${basename(file)} was unreadable and has been reset. The old file was kept as ${basename(backup)}.`)
      return fallback
    }
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/store.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.js src/main/store.js test/unit/store.test.js
git commit -m "feat: persist settings and saved connections with atomic writes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: AWS profile discovery

**Files:**
- Create: `src/main/profiles.js`
- Create: `test/fixtures/aws/config`, `test/fixtures/aws/credentials`
- Test: `test/unit/profiles.test.js`

**Interfaces:**
- Produces: `resolveAwsPaths({ configFile?, credentialsFile? }, env = process.env, home = os.homedir()) → { configPath, credentialsPath }`. Precedence is the explicit setting, then `AWS_CONFIG_FILE` / `AWS_SHARED_CREDENTIALS_FILE`, then `~/.aws/…`.
- Produces: `listProfiles({ configPath, credentialsPath }) → Promise<Array<{ name, region: string | null, sources: Array<'config' | 'credentials'>, sso: boolean }>>`. `default` comes first, then the rest alphabetically. Credential values are never returned.

- [ ] **Step 1: Add the fixtures**

`test/fixtures/aws/config`:

```ini
[default]
region = sa-east-1

[profile staging]
region = us-east-1

[profile sso-dev]
sso_session = corp
sso_account_id = 111111111111
sso_role_name = Developer
region = us-west-2

[sso-session corp]
sso_start_url = https://corp.awsapps.com/start
sso_region = us-east-1
```

`test/fixtures/aws/credentials`:

```ini
[default]
aws_access_key_id = AKIAEXAMPLEDEFAULT
aws_secret_access_key = not-a-real-secret

[prod]
aws_access_key_id = AKIAEXAMPLEPROD
aws_secret_access_key = not-a-real-secret-either
```

- [ ] **Step 2: Write the failing test**

`test/unit/profiles.test.js`:

```js
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listProfiles, resolveAwsPaths } from '../../src/main/profiles.js'

const fixtures = fileURLToPath(new URL('../fixtures/aws/', import.meta.url))
const paths = { configPath: join(fixtures, 'config'), credentialsPath: join(fixtures, 'credentials') }

describe('listProfiles', () => {
  it('merges profiles from both files, default first', async () => {
    expect(await listProfiles(paths)).toEqual([
      { name: 'default', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false },
      { name: 'prod', region: null, sources: ['credentials'], sso: false },
      { name: 'sso-dev', region: 'us-west-2', sources: ['config'], sso: true },
      { name: 'staging', region: 'us-east-1', sources: ['config'], sso: false }
    ])
  })

  it('never returns credential values', async () => {
    expect(JSON.stringify(await listProfiles(paths))).not.toMatch(/AKIA|secret/)
  })

  it('returns an empty list when the files do not exist', async () => {
    expect(await listProfiles({ configPath: join(fixtures, 'missing-config'), credentialsPath: join(fixtures, 'missing-credentials') })).toEqual([])
  })
})

describe('resolveAwsPaths', () => {
  it('prefers explicit settings, then environment variables, then ~/.aws', () => {
    expect(resolveAwsPaths({ configFile: '/x/config', credentialsFile: '/x/creds' }, {}, '/home/u')).toEqual({ configPath: '/x/config', credentialsPath: '/x/creds' })
    expect(resolveAwsPaths({}, { AWS_CONFIG_FILE: '/env/config', AWS_SHARED_CREDENTIALS_FILE: '/env/creds' }, '/home/u')).toEqual({ configPath: '/env/config', credentialsPath: '/env/creds' })
    expect(resolveAwsPaths({}, {}, '/home/u')).toEqual({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/unit/profiles.test.js`
Expected: FAIL, because `src/main/profiles.js` does not exist.

- [ ] **Step 4: Implement profile discovery**

`src/main/profiles.js`:

```js
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader'

// The loader keys [sso-session x] and [services x] sections as "sso-session.x" / "services.x".
const NON_PROFILE_SECTION = /^(sso-session|services)\./

export function resolveAwsPaths({ configFile = '', credentialsFile = '' } = {}, env = process.env, home = homedir()) {
  return {
    configPath: configFile || env.AWS_CONFIG_FILE || join(home, '.aws', 'config'),
    credentialsPath: credentialsFile || env.AWS_SHARED_CREDENTIALS_FILE || join(home, '.aws', 'credentials')
  }
}

// Only names, regions, and an SSO flag leave this function — never key material.
export async function listProfiles({ configPath, credentialsPath }) {
  const { configFile, credentialsFile } = await loadSharedConfigFiles({ configFilepath: configPath, filepath: credentialsPath, ignoreCache: true })
  const byName = new Map()
  const entry = (name) => {
    if (!byName.has(name)) byName.set(name, { name, region: null, sources: [], sso: false })
    return byName.get(name)
  }

  for (const [name, section] of Object.entries(configFile)) {
    if (NON_PROFILE_SECTION.test(name)) continue
    const profile = entry(name)
    profile.sources.push('config')
    profile.region = section.region ?? null
    profile.sso = Boolean(section.sso_session || section.sso_start_url)
  }
  for (const name of Object.keys(credentialsFile)) entry(name).sources.push('credentials')

  return [...byName.values()].sort((a, b) => {
    if (a.name === 'default') return -1
    if (b.name === 'default') return 1
    return a.name.localeCompare(b.name)
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/profiles.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/profiles.js test/fixtures/aws test/unit/profiles.test.js
git commit -m "feat: discover AWS profiles from config and credentials files

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: Real SSM service

**Files:**
- Create: `src/main/ssm-service.js`
- Test: `test/unit/ssm-service.test.js`

**Interfaces:**
- Consumes: `versionConflictError` (Task 6).
- Produces: `createSsmClient({ profile, region, configFile?, credentialsFile? }) → SSMClient` (`fromIni` credentials, `retryMode: 'adaptive'`, `maxAttempts: 6`).
- Produces: `class SsmService`, built as `new SsmService(client)`, with these async methods. `FakeSsmService` (Task 10) implements the same interface.
  - `test(prefix?)` → `{ ok: true }`
  - `list(prefix?)` → `Array<ParameterMeta>`, where `ParameterMeta = { name, type, tier, dataType, version, lastModifiedDate (ISO | null), lastModifiedUser | null, description ('' if none), keyId | null, allowedPattern | null }`
  - `get(name, { decrypt })` → `{ name, type, value (null for an undecrypted SecureString), version, lastModifiedDate, dataType, arn }`
  - `tags(name)` → `Array<{ key, value }>`
  - `history(name, { decrypt })` → `Array<{ version, value | null, type, tier, keyId, description, lastModifiedDate, lastModifiedUser, labels }>`, newest first
  - `put({ name, value, type, tier, keyId, description, dataType, allowedPattern, overwrite, expectedVersion })` → `{ version, tier }`. When `overwrite` is true and `expectedVersion` is set, it first runs `GetParameter`, then throws `VersionConflict` on a mismatch.
  - `delete(name)` → `{ deleted: true }`

- [ ] **Step 1: Write the failing test**

`test/unit/ssm-service.test.js`:

```js
import {
  DeleteParameterCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  ListTagsForResourceCommand,
  PutParameterCommand,
  SSMClient
} from '@aws-sdk/client-ssm'
import { mockClient } from 'aws-sdk-client-mock'
import { beforeEach, describe, expect, it } from 'vitest'
import { SsmService, createSsmClient } from '../../src/main/ssm-service.js'

const client = new SSMClient({ region: 'sa-east-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
const ssm = mockClient(client)
const service = new SsmService(client)
const inputs = (Command) => ssm.commandCalls(Command).map((call) => call.args[0].input)

beforeEach(() => ssm.reset())

describe('list', () => {
  it('follows NextToken through every page and maps the console fields', async () => {
    ssm
      .on(DescribeParametersCommand)
      .resolvesOnce({
        Parameters: [
          {
            Name: '/a',
            Type: 'SecureString',
            Tier: 'Standard',
            DataType: 'text',
            Version: 3,
            LastModifiedDate: new Date('2026-09-01T10:00:00Z'),
            LastModifiedUser: 'arn:aws:iam::1:user/leo',
            Description: 'A',
            KeyId: 'alias/aws/ssm'
          }
        ],
        NextToken: 'page-2'
      })
      .resolvesOnce({ Parameters: [{ Name: '/b', Type: 'String', Version: 1 }] })

    expect(await service.list('')).toEqual([
      { name: '/a', type: 'SecureString', tier: 'Standard', dataType: 'text', version: 3, lastModifiedDate: '2026-09-01T10:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: 'A', keyId: 'alias/aws/ssm', allowedPattern: null },
      { name: '/b', type: 'String', tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: null, lastModifiedUser: null, description: '', keyId: null, allowedPattern: null }
    ])
    expect(inputs(DescribeParametersCommand)).toEqual([
      { MaxResults: 50, ParameterFilters: undefined, NextToken: undefined },
      { MaxResults: 50, ParameterFilters: undefined, NextToken: 'page-2' }
    ])
  })

  it('filters by the connection path prefix', async () => {
    ssm.on(DescribeParametersCommand).resolves({ Parameters: [] })
    await service.list('/myapp')
    expect(inputs(DescribeParametersCommand)[0].ParameterFilters).toEqual([{ Key: 'Name', Option: 'BeginsWith', Values: ['/myapp'] }])
  })
})

describe('get', () => {
  it('returns the decrypted value and ARN when asked to decrypt', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Value: 'A=1', Version: 2, LastModifiedDate: new Date('2026-09-01T10:00:00Z'), DataType: 'text', ARN: 'arn:aws:ssm:sa-east-1:1:parameter/a' } })
    expect(await service.get('/a', { decrypt: true })).toEqual({ name: '/a', type: 'SecureString', value: 'A=1', version: 2, lastModifiedDate: '2026-09-01T10:00:00.000Z', dataType: 'text', arn: 'arn:aws:ssm:sa-east-1:1:parameter/a' })
    expect(inputs(GetParameterCommand)).toEqual([{ Name: '/a', WithDecryption: true }])
  })

  it('hides the ciphertext of a SecureString read without decryption', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Value: 'AQICAHh...', Version: 2 } })
    expect((await service.get('/a', { decrypt: false })).value).toBeNull()
  })
})

describe('tags and history', () => {
  it('lists tags for the parameter resource', async () => {
    ssm.on(ListTagsForResourceCommand).resolves({ TagList: [{ Key: 'team', Value: 'platform' }] })
    expect(await service.tags('/a')).toEqual([{ key: 'team', value: 'platform' }])
    expect(inputs(ListTagsForResourceCommand)).toEqual([{ ResourceType: 'Parameter', ResourceId: '/a' }])
  })

  it('pages through history, newest first, hiding undecrypted SecureString values', async () => {
    ssm
      .on(GetParameterHistoryCommand)
      .resolvesOnce({ Parameters: [{ Version: 1, Type: 'SecureString', Value: 'c1', Labels: ['old'] }], NextToken: 'n' })
      .resolvesOnce({ Parameters: [{ Version: 2, Type: 'SecureString', Value: 'c2', LastModifiedUser: 'arn:aws:iam::1:user/leo' }] })
    const history = await service.history('/a', { decrypt: false })
    expect(history.map((h) => [h.version, h.value, h.labels])).toEqual([[2, null, []], [1, null, ['old']]])
    expect(history[0].lastModifiedUser).toBe('arn:aws:iam::1:user/leo')
    expect(inputs(GetParameterHistoryCommand).map((i) => i.NextToken)).toEqual([undefined, 'n'])
  })
})

describe('put', () => {
  const update = { name: '/a', value: 'A=2', type: 'SecureString', tier: 'Standard', keyId: 'alias/custom', description: 'Prod env', dataType: 'text', allowedPattern: null, overwrite: true, expectedVersion: 4 }

  it('checks the version, then overwrites, keeping type, KMS key, and description', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Type: 'SecureString', Version: 4 } })
    ssm.on(PutParameterCommand).resolves({ Version: 5, Tier: 'Standard' })
    expect(await service.put(update)).toEqual({ version: 5, tier: 'Standard' })
    expect(inputs(GetParameterCommand)).toEqual([{ Name: '/a', WithDecryption: false }])
    expect(inputs(PutParameterCommand)).toEqual([{ Name: '/a', Value: 'A=2', Type: 'SecureString', Tier: 'Standard', Overwrite: true, KeyId: 'alias/custom', Description: 'Prod env', DataType: 'text' }])
  })

  it('throws VersionConflict without writing when the version moved', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: '/a', Version: 5 } })
    await expect(service.put(update)).rejects.toMatchObject({ code: 'VersionConflict', details: { currentVersion: 5 } })
    expect(inputs(PutParameterCommand)).toEqual([])
  })

  it('creates without a version check and omits empty optional fields', async () => {
    ssm.on(PutParameterCommand).resolves({ Version: 1 })
    await service.put({ name: '/new', value: 'x', type: 'String', tier: 'Standard', keyId: 'alias/ignored', description: '', dataType: 'text', allowedPattern: null, overwrite: false, expectedVersion: null })
    expect(inputs(GetParameterCommand)).toEqual([])
    expect(inputs(PutParameterCommand)).toEqual([{ Name: '/new', Value: 'x', Type: 'String', Tier: 'Standard', Overwrite: false, DataType: 'text' }])
  })

  it('keeps an allowed pattern on overwrite', async () => {
    ssm.on(PutParameterCommand).resolves({ Version: 2 })
    await service.put({ ...update, type: 'String', allowedPattern: '^[a-z]+$', expectedVersion: null })
    expect(inputs(PutParameterCommand)[0].AllowedPattern).toBe('^[a-z]+$')
  })
})

describe('delete and test', () => {
  it('deletes by name', async () => {
    ssm.on(DeleteParameterCommand).resolves({})
    expect(await service.delete('/a')).toEqual({ deleted: true })
    expect(inputs(DeleteParameterCommand)).toEqual([{ Name: '/a' }])
  })

  it('tests access with a one-item DescribeParameters', async () => {
    ssm.on(DescribeParametersCommand).resolves({ Parameters: [] })
    expect(await service.test('/myapp')).toEqual({ ok: true })
    expect(inputs(DescribeParametersCommand)[0]).toMatchObject({ MaxResults: 1, ParameterFilters: [{ Key: 'Name', Option: 'BeginsWith', Values: ['/myapp'] }] })
  })
})

describe('createSsmClient', () => {
  it('builds a client for the region with adaptive retries', async () => {
    const value = (v) => (typeof v === 'function' ? v() : v)
    const created = createSsmClient({ profile: 'prod', region: 'eu-west-1' })
    expect(await value(created.config.region)).toBe('eu-west-1')
    expect(await value(created.config.maxAttempts)).toBe(6)
    expect(await value(created.config.retryMode)).toBe('adaptive')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/ssm-service.test.js`
Expected: FAIL, because `src/main/ssm-service.js` does not exist.

- [ ] **Step 3: Implement the service**

`src/main/ssm-service.js`:

```js
import {
  DeleteParameterCommand,
  DescribeParametersCommand,
  GetParameterCommand,
  GetParameterHistoryCommand,
  ListTagsForResourceCommand,
  PutParameterCommand,
  SSMClient
} from '@aws-sdk/client-ssm'
import { fromIni } from '@aws-sdk/credential-providers'
import { versionConflictError } from './errors.js'

export function createSsmClient({ profile, region, configFile = '', credentialsFile = '' }) {
  return new SSMClient({
    region,
    maxAttempts: 6,
    retryMode: 'adaptive',
    credentials: fromIni({ profile, configFilepath: configFile || undefined, filepath: credentialsFile || undefined, ignoreCache: true })
  })
}

const iso = (date) => (date ? new Date(date).toISOString() : null)
const nameFilter = (prefix) => (prefix ? [{ Key: 'Name', Option: 'BeginsWith', Values: [prefix] }] : undefined)
const visible = (type, value, decrypt) => (type === 'SecureString' && !decrypt ? null : value)

export class SsmService {
  constructor(client) {
    this.client = client
  }

  async test(prefix = '') {
    await this.client.send(new DescribeParametersCommand({ MaxResults: 1, ParameterFilters: nameFilter(prefix) }))
    return { ok: true }
  }

  async list(prefix = '') {
    const rows = []
    let token
    do {
      // A fresh input object per page: the SDK paginators mutate theirs.
      const page = await this.client.send(new DescribeParametersCommand({ MaxResults: 50, ParameterFilters: nameFilter(prefix), NextToken: token }))
      for (const p of page.Parameters ?? []) rows.push(toMeta(p))
      token = page.NextToken
    } while (token)
    return rows
  }

  async get(name, { decrypt = false } = {}) {
    const { Parameter: p } = await this.client.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }))
    return {
      name: p.Name,
      type: p.Type,
      value: visible(p.Type, p.Value, decrypt),
      version: p.Version,
      lastModifiedDate: iso(p.LastModifiedDate),
      dataType: p.DataType ?? 'text',
      arn: p.ARN ?? null
    }
  }

  async tags(name) {
    const { TagList } = await this.client.send(new ListTagsForResourceCommand({ ResourceType: 'Parameter', ResourceId: name }))
    return (TagList ?? []).map((t) => ({ key: t.Key, value: t.Value }))
  }

  async history(name, { decrypt = false } = {}) {
    const entries = []
    let token
    do {
      const page = await this.client.send(new GetParameterHistoryCommand({ Name: name, WithDecryption: decrypt, MaxResults: 50, NextToken: token }))
      for (const h of page.Parameters ?? []) {
        entries.push({
          version: h.Version,
          value: visible(h.Type, h.Value, decrypt),
          type: h.Type,
          tier: h.Tier ?? 'Standard',
          keyId: h.KeyId ?? null,
          description: h.Description ?? '',
          lastModifiedDate: iso(h.LastModifiedDate),
          lastModifiedUser: h.LastModifiedUser ?? null,
          labels: h.Labels ?? []
        })
      }
      token = page.NextToken
    } while (token)
    return entries.sort((a, b) => b.version - a.version)
  }

  async put({ name, value, type, tier, keyId, description, dataType, allowedPattern, overwrite, expectedVersion }) {
    if (overwrite && expectedVersion != null) {
      const { Parameter } = await this.client.send(new GetParameterCommand({ Name: name, WithDecryption: false }))
      if (Parameter.Version !== expectedVersion) throw versionConflictError(name, Parameter.Version, expectedVersion)
    }
    // Pass KeyId/Description/DataType/AllowedPattern explicitly: an overwrite that omits
    // KeyId re-encrypts with the default key instead of the parameter's own.
    const res = await this.client.send(
      new PutParameterCommand({
        Name: name,
        Value: value,
        Type: type,
        Tier: tier,
        Overwrite: Boolean(overwrite),
        ...(type === 'SecureString' && keyId ? { KeyId: keyId } : {}),
        ...(description ? { Description: description } : {}),
        ...(dataType ? { DataType: dataType } : {}),
        ...(allowedPattern ? { AllowedPattern: allowedPattern } : {})
      })
    )
    return { version: res.Version, tier: res.Tier ?? tier }
  }

  async delete(name) {
    await this.client.send(new DeleteParameterCommand({ Name: name }))
    return { deleted: true }
  }
}

function toMeta(p) {
  return {
    name: p.Name,
    type: p.Type,
    tier: p.Tier ?? 'Standard',
    dataType: p.DataType ?? 'text',
    version: p.Version,
    lastModifiedDate: iso(p.LastModifiedDate),
    lastModifiedUser: p.LastModifiedUser ?? null,
    description: p.Description ?? '',
    keyId: p.KeyId ?? null,
    allowedPattern: p.AllowedPattern ?? null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/ssm-service.test.js`
Expected: PASS (13 tests). If the `createSsmClient` test fails only because a config field resolves differently in this SDK version, check it with `console.log(await created.config.retryMode?.())` and adjust the assertion helper. Do not remove the region, `maxAttempts`, or `retryMode` settings.

- [ ] **Step 5: Commit**

```bash
git add src/main/ssm-service.js test/unit/ssm-service.test.js
git commit -m "feat: wrap SSM Parameter Store calls with pagination and version checks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Fake SSM backend for demo mode and e2e

**Files:**
- Create: `src/main/fake-seed.js`, `src/main/fake-ssm-service.js`
- Test: `test/unit/fake-ssm-service.test.js`

**Interfaces:**
- Consumes: `byteLength`, `tierLimit` (Task 4); `versionConflictError` (Task 6).
- Produces from `fake-seed.js`: `seedParameters() → Array<{ name, type, tier?, description?, tags?, versions: string[] }>`, with 19 parameters.
- Produces from `fake-ssm-service.js`:
  - `class FakeSsmService`, built as `new FakeSsmService({ seed?, now?, delayMs?, region? })`. It has the same methods and return shapes as `SsmService` (Task 9). Errors carry the AWS names (`ParameterNotFound`, `ParameterAlreadyExists`, `ValidationException`) so `toIpcError` maps them the same way.
  - `FAKE_PROFILES` (`demo`, `demo-readonly`) and `FAKE_CONNECTIONS`: `demo-all` ("Demo — all parameters", writable) and `demo-prod` ("Demo — production (read-only)", prefix `/myapp/prod`, read-only).

- [ ] **Step 1: Write the failing test**

`test/unit/fake-ssm-service.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { seedParameters } from '../../src/main/fake-seed.js'
import { FAKE_CONNECTIONS, FAKE_PROFILES, FakeSsmService } from '../../src/main/fake-ssm-service.js'

const now = () => new Date('2026-10-01T12:00:00.000Z')
const create = () => new FakeSsmService({ now })
const base = { type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', dataType: 'text', allowedPattern: null }

describe('seed data', () => {
  it('has 19 parameters covering every type, a root-level name, and a near-limit value', async () => {
    const rows = await create().list()
    expect(rows).toHaveLength(19)
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(['String', 'StringList', 'SecureString']))
    expect(rows.some((r) => !r.name.startsWith('/'))).toBe(true)
    const big = seedParameters().find((s) => s.name === '/myapp/prod/big-env').versions[0]
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(3900)
    expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(4096)
  })

  it('exposes demo profiles and connections', () => {
    expect(FAKE_PROFILES.map((p) => p.name)).toEqual(['demo', 'demo-readonly'])
    expect(FAKE_CONNECTIONS.map((c) => [c.id, c.readOnly, c.pathPrefix])).toEqual([['demo-all', false, ''], ['demo-prod', true, '/myapp/prod']])
  })
})

describe('reads', () => {
  it('lists sorted metadata filtered by prefix', async () => {
    const rows = await create().list('/myapp/prod')
    expect(rows.map((r) => r.name)).toEqual(['/myapp/prod/big-env', '/myapp/prod/config.json', '/myapp/prod/env', '/myapp/prod/feature-flags', '/myapp/prod/quoted-env'])
    expect(rows.find((r) => r.name === '/myapp/prod/env')).toMatchObject({ version: 3, type: 'SecureString', keyId: 'alias/aws/ssm' })
  })

  it('hides SecureString values unless decrypting, and builds an ARN', async () => {
    const fake = create()
    expect((await fake.get('/myapp/prod/env', { decrypt: false })).value).toBeNull()
    const value = await fake.get('/myapp/prod/env', { decrypt: true })
    expect(value.value).toContain('APP_ENV=prod')
    expect(value.arn).toBe('arn:aws:ssm:sa-east-1:000000000000:parameter/myapp/prod/env')
    expect((await fake.get('legacy-api-token', { decrypt: true })).arn).toBe('arn:aws:ssm:sa-east-1:000000000000:parameter/legacy-api-token')
  })

  it('returns tags and history newest first', async () => {
    const fake = create()
    expect(await fake.tags('/myapp/prod/env')).toEqual([{ key: 'team', value: 'platform' }, { key: 'environment', value: 'production' }])
    expect((await fake.history('/myapp/prod/env', { decrypt: true })).map((h) => h.version)).toEqual([3, 2, 1])
  })

  it('throws ParameterNotFound for unknown names', async () => {
    await expect(create().get('/nope')).rejects.toMatchObject({ name: 'ParameterNotFound' })
  })
})

describe('writes', () => {
  it('overwrites with a new version and keeps history', async () => {
    const fake = create()
    expect(await fake.put({ ...base, name: '/myapp/dev/env', value: 'A=1', overwrite: true, expectedVersion: 1 })).toEqual({ version: 2, tier: 'Standard' })
    const history = await fake.history('/myapp/dev/env', { decrypt: true })
    expect(history.map((h) => [h.version, h.value.slice(0, 3)])).toEqual([[2, 'A=1'], [1, 'APP']])
    expect(history[0].lastModifiedDate).toBe('2026-10-01T12:00:00.000Z')
  })

  it('keeps the existing description when an overwrite sends an empty one', async () => {
    const fake = create()
    await fake.put({ ...base, name: '/myapp/prod/env', value: 'A=1', overwrite: true })
    expect((await fake.list('/myapp/prod/env'))[0].description).toBe('Production .env for myapp')
  })

  it('creates new parameters and refuses to create over an existing one', async () => {
    const fake = create()
    expect(await fake.put({ ...base, type: 'String', name: '/new/param', value: 'x', overwrite: false })).toEqual({ version: 1, tier: 'Standard' })
    expect((await fake.get('/new/param')).value).toBe('x')
    await expect(fake.put({ ...base, name: '/new/param', value: 'y', overwrite: false })).rejects.toMatchObject({ name: 'ParameterAlreadyExists' })
  })

  it('detects version conflicts', async () => {
    await expect(create().put({ ...base, name: '/myapp/prod/env', value: 'A=1', overwrite: true, expectedVersion: 2 })).rejects.toMatchObject({ code: 'VersionConflict', details: { currentVersion: 3 } })
  })

  it('enforces tier limits, the no-downgrade rule, and non-empty values like AWS', async () => {
    const fake = create()
    const big = 'x'.repeat(5000)
    await expect(fake.put({ ...base, name: '/myapp/dev/env', value: big, overwrite: true })).rejects.toMatchObject({ name: 'ValidationException' })
    expect(await fake.put({ ...base, name: '/myapp/dev/env', value: big, tier: 'Advanced', overwrite: true })).toEqual({ version: 2, tier: 'Advanced' })
    await expect(fake.put({ ...base, name: '/myapp/dev/env', value: 'A=1', tier: 'Standard', overwrite: true })).rejects.toMatchObject({ name: 'ValidationException' })
    await expect(fake.put({ ...base, name: '/myapp/dev/env', value: '', tier: 'Advanced', overwrite: true })).rejects.toMatchObject({ name: 'ValidationException' })
  })

  it('deletes parameters', async () => {
    const fake = create()
    expect(await fake.delete('/infra/vpc/id')).toEqual({ deleted: true })
    await expect(fake.get('/infra/vpc/id')).rejects.toMatchObject({ name: 'ParameterNotFound' })
    await expect(fake.delete('/infra/vpc/id')).rejects.toMatchObject({ name: 'ParameterNotFound' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/fake-ssm-service.test.js`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the seed data**

`src/main/fake-seed.js`:

```js
// Demo data for VAULT_FAKE_SSM=1. Every secret-looking value is obviously fake.

const env = (entries) => Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')

const appEnv = (stage, extra = {}) =>
  env({
    APP_NAME: 'myapp',
    APP_ENV: stage,
    APP_DEBUG: stage === 'prod' ? 'false' : 'true',
    APP_URL: stage === 'prod' ? 'https://myapp.example.com' : `https://${stage}.myapp.example.com`,
    DB_HOST: `db-${stage}.internal`,
    DB_PORT: '5432',
    DB_DATABASE: 'myapp',
    DB_USERNAME: 'myapp',
    DB_PASSWORD: `${stage}-not-a-real-password`,
    REDIS_HOST: `redis-${stage}.internal`,
    QUEUE_CONNECTION: 'sqs',
    MAIL_FROM_ADDRESS: 'no-reply@myapp.example.com',
    ...extra
  })

// 61 lines of 64 bytes + 60 newlines = 3,964 bytes: close to the 4,096-byte Standard limit.
const bigEnv = () => Array.from({ length: 61 }, (_, i) => `CACHE_KEY_${String(i + 1).padStart(3, '0')}=${'x'.repeat(50)}`).join('\n')

const quotedEnv = [
  '# Values with quotes, comments, and a multiline key',
  'PRIVATE_KEY="-----BEGIN KEY-----\nnot-a-real-key\n-----END KEY-----"',
  "GREETING='hello # not a comment'",
  'export PATH_EXTRA=/opt/bin # inline comment'
].join('\n')

export function seedParameters() {
  const sentry = { SENTRY_DSN: 'https://public@sentry.example.com/1' }
  return [
    { name: '/myapp/dev/env', type: 'SecureString', description: 'Development .env for myapp', versions: [appEnv('dev')] },
    { name: '/myapp/dev/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard,dark-mode,beta-reports'] },
    { name: '/myapp/dev/broken-env', type: 'String', description: 'Has an invalid line and a duplicate key', versions: ['A=1\nthis line is not valid\nA=2'] },
    { name: '/myapp/staging/env', type: 'SecureString', description: 'Staging .env for myapp', versions: [appEnv('staging'), appEnv('staging', { FEATURE_NEW_CHECKOUT: 'true' })] },
    { name: '/myapp/staging/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard'] },
    {
      name: '/myapp/prod/env',
      type: 'SecureString',
      description: 'Production .env for myapp',
      tags: [{ key: 'team', value: 'platform' }, { key: 'environment', value: 'production' }],
      versions: [appEnv('prod'), appEnv('prod', sentry), appEnv('prod', { ...sentry, DB_PASSWORD: 'prod-rotated-not-real' })]
    },
    { name: '/myapp/prod/quoted-env', type: 'SecureString', description: 'Quoted and multiline values', versions: [quotedEnv] },
    { name: '/myapp/prod/big-env', type: 'SecureString', description: 'Close to the 4 KB Standard limit', versions: [bigEnv()] },
    { name: '/myapp/prod/feature-flags', type: 'StringList', versions: ['checkout,new-dashboard,dark-mode'] },
    { name: '/myapp/prod/config.json', type: 'String', description: 'Not .env, so diffs are line by line', versions: ['{\n  "retries": 3,\n  "timeoutMs": 5000\n}', '{\n  "retries": 5,\n  "timeoutMs": 5000\n}'] },
    { name: '/billing/staging/env', type: 'SecureString', versions: [env({ STRIPE_MODE: 'test', STRIPE_KEY: 'sk_test_not_real', INVOICE_PREFIX: 'STG' })] },
    { name: '/billing/prod/env', type: 'SecureString', versions: [env({ STRIPE_MODE: 'live', STRIPE_KEY: 'sk_live_not_real', INVOICE_PREFIX: 'INV' })] },
    { name: '/billing/prod/stripe-webhook-secret', type: 'SecureString', versions: ['whsec_not_a_real_secret'] },
    { name: '/shared/datadog/api-key', type: 'SecureString', versions: ['dd-not-a-real-key'] },
    { name: '/shared/sentry/dsn', type: 'String', versions: ['https://public@sentry.example.com/1'] },
    { name: '/infra/vpc/id', type: 'String', versions: ['vpc-0abc1234def567890'] },
    { name: '/infra/vpc/private-subnets', type: 'StringList', versions: ['subnet-0aaa,subnet-0bbb,subnet-0ccc'] },
    { name: '/reports/prod/env', type: 'SecureString', tier: 'Advanced', description: 'Advanced tier example', versions: [appEnv('prod', { REPORTS_BUCKET: 's3://reports-prod' })] },
    { name: 'legacy-api-token', type: 'SecureString', description: 'Name without a path', versions: ['legacy-not-a-real-token'] }
  ]
}
```

- [ ] **Step 4: Implement the fake service**

`src/main/fake-ssm-service.js`:

```js
import { byteLength, tierLimit } from '@shared/names.js'
import { versionConflictError } from './errors.js'
import { seedParameters } from './fake-seed.js'

const ACCOUNT = '000000000000'
const DEMO_USER = `arn:aws:iam::${ACCOUNT}:user/demo`
const SEED_START = Date.UTC(2026, 8, 1, 12, 0, 0)
const DAY = 86_400_000

export const FAKE_PROFILES = Object.freeze([
  { name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false },
  { name: 'demo-readonly', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false }
])

export const FAKE_CONNECTIONS = Object.freeze([
  { id: 'demo-all', name: 'Demo — all parameters', profile: 'demo', region: 'sa-east-1', pathPrefix: '', color: 'green', readOnly: false },
  { id: 'demo-prod', name: 'Demo — production (read-only)', profile: 'demo-readonly', region: 'sa-east-1', pathPrefix: '/myapp/prod', color: 'red', readOnly: true }
])

// Errors carry the AWS SDK error names so errors.js maps them exactly like real ones.
const awsError = (name, message) => Object.assign(new Error(message), { name })

export class FakeSsmService {
  #params = new Map()
  #now
  #delayMs
  #region

  constructor({ seed = seedParameters(), now = () => new Date(), delayMs = 0, region = 'sa-east-1' } = {}) {
    this.#now = now
    this.#delayMs = delayMs
    this.#region = region
    seed.forEach((s, index) => {
      this.#params.set(s.name, {
        name: s.name,
        type: s.type,
        tier: s.tier ?? 'Standard',
        dataType: 'text',
        keyId: s.type === 'SecureString' ? 'alias/aws/ssm' : null,
        description: s.description ?? '',
        allowedPattern: null,
        tags: s.tags ?? [],
        versions: s.versions.map((value, v) => ({
          version: v + 1,
          value,
          lastModifiedDate: new Date(SEED_START + (index * 3 + v) * DAY).toISOString(),
          lastModifiedUser: DEMO_USER,
          labels: []
        }))
      })
    })
  }

  async test() {
    await this.#wait()
    return { ok: true }
  }

  async list(prefix = '') {
    await this.#wait()
    return [...this.#params.values()]
      .filter((p) => p.name.startsWith(prefix))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => this.#meta(p))
  }

  async get(name, { decrypt = false } = {}) {
    await this.#wait()
    const p = this.#require(name)
    const latest = p.versions.at(-1)
    return { name, type: p.type, value: visible(p.type, latest.value, decrypt), version: latest.version, lastModifiedDate: latest.lastModifiedDate, dataType: p.dataType, arn: this.#arn(name) }
  }

  async tags(name) {
    await this.#wait()
    return this.#require(name).tags.map((t) => ({ ...t }))
  }

  async history(name, { decrypt = false } = {}) {
    await this.#wait()
    const p = this.#require(name)
    return p.versions
      .map((v) => ({ version: v.version, value: visible(p.type, v.value, decrypt), type: p.type, tier: p.tier, keyId: p.keyId, description: p.description, lastModifiedDate: v.lastModifiedDate, lastModifiedUser: v.lastModifiedUser, labels: [...v.labels] }))
      .reverse()
  }

  async put({ name, value, type, tier = 'Standard', keyId, description, dataType, allowedPattern, overwrite, expectedVersion }) {
    await this.#wait()
    const existing = this.#params.get(name)
    if (existing && !overwrite) {
      throw awsError('ParameterAlreadyExists', 'The parameter already exists. To overwrite this value, set the overwrite option in the request to true.')
    }
    const current = existing?.versions.at(-1)
    if (existing && expectedVersion != null && current.version !== expectedVersion) throw versionConflictError(name, current.version, expectedVersion)
    if (!value) throw awsError('ValidationException', "1 validation error detected: Value at 'value' failed to satisfy constraint: Member must have length greater than or equal to 1")
    if (existing?.tier === 'Advanced' && tier === 'Standard') throw awsError('ValidationException', 'An Advanced parameter cannot be downgraded to the Standard tier.')
    if (byteLength(value) > tierLimit(tier)) throw awsError('ValidationException', `Parameter value exceeds the maximum size for the ${tier} tier (${tierLimit(tier)} bytes).`)

    const record = existing ?? { name, tags: [], description: '', allowedPattern: null, versions: [] }
    Object.assign(record, {
      type,
      tier,
      dataType: dataType || 'text',
      keyId: type === 'SecureString' ? keyId || 'alias/aws/ssm' : null,
      // Like AWS: an overwrite without a description keeps the existing one.
      description: description || record.description,
      allowedPattern: allowedPattern ?? record.allowedPattern
    })
    const version = (current?.version ?? 0) + 1
    record.versions.push({ version, value, lastModifiedDate: this.#now().toISOString(), lastModifiedUser: DEMO_USER, labels: [] })
    this.#params.set(name, record)
    return { version, tier }
  }

  async delete(name) {
    await this.#wait()
    this.#require(name)
    this.#params.delete(name)
    return { deleted: true }
  }

  #meta(p) {
    const latest = p.versions.at(-1)
    return { name: p.name, type: p.type, tier: p.tier, dataType: p.dataType, version: latest.version, lastModifiedDate: latest.lastModifiedDate, lastModifiedUser: latest.lastModifiedUser, description: p.description, keyId: p.keyId, allowedPattern: p.allowedPattern }
  }

  #require(name) {
    const p = this.#params.get(name)
    if (!p) throw awsError('ParameterNotFound', `Parameter ${name} not found.`)
    return p
  }

  #arn(name) {
    return `arn:aws:ssm:${this.#region}:${ACCOUNT}:parameter${name.startsWith('/') ? '' : '/'}${name}`
  }

  async #wait() {
    if (this.#delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#delayMs))
  }
}

function visible(type, value, decrypt) {
  return type === 'SecureString' && !decrypt ? null : value
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/fake-ssm-service.test.js`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/fake-seed.js src/main/fake-ssm-service.js test/unit/fake-ssm-service.test.js
git commit -m "feat: add in-memory fake SSM backend with demo seed data

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: IPC handlers, client cache, and main-process wiring

**Files:**
- Create: `src/main/clients.js`, `src/main/ipc.js`
- Modify: `src/main/index.js` (replace the whole file)
- Test: `test/unit/clients.test.js`, `test/unit/ipc.test.js`

**Interfaces:**
- Consumes: `API`, `CHANNELS` (Task 1); `validateName`, `byteLength`, `tierLimit`, `PARAMETER_TYPES`, `PARAMETER_TIERS` (Task 4); `AppError`, `toIpcError`, `CREDENTIAL_ERROR_CODES` (Task 6); `createStore`, `sanitizeConnection` (Task 7); `listProfiles`, `resolveAwsPaths` (Task 8); `SsmService`, `createSsmClient` (Task 9); `FakeSsmService`, `FAKE_PROFILES`, `FAKE_CONNECTIONS` (Task 10).
- Produces from `clients.js`: `createClients({ store, fakeService?, makeService? })` → `{ forConnection(id), forDraft(connection), invalidate(id), clear() }`.
- Produces from `ipc.js`:
  - `createHandlers({ store, clients, listProfiles, resolvePaths, fake?, appVersion? })` returns an object keyed by channel name. Each handler is `(...args) => data | Promise<data>` and throws on error.
  - `wrap(handler, { contextOf?, onCredentialError?, log? })` returns an async function resolving to `{ ok: true, data }` or `{ ok: false, error }`.
  - `registerIpc(ipcMain, { handlers, store, clients, log? })`.
- IPC contract the renderer relies on:
  - `app:info` → `{ version, fake, warnings: string[] }`. The warnings are returned once and then cleared.
  - `profiles:list` → `{ configPath, credentialsPath, profiles }`.
  - `connections:list` / `save(input)` / `delete(id)` / `test(draft)`.
  - `settings:get` / `save(partial)`.
  - `ssm:list(connId)`, `ssm:get(connId, name, { decrypt })`, `ssm:tags(connId, name)`, `ssm:history(connId, name, { decrypt })`, `ssm:put(connId, input)`, `ssm:delete(connId, name)`.

- [ ] **Step 1: Write the failing tests**

`test/unit/clients.test.js`:

```js
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createClients } from '../../src/main/clients.js'
import { createStore } from '../../src/main/store.js'

function setup() {
  const store = createStore(mkdtempSync(join(tmpdir(), 'vault-clients-')))
  store.saveSettings({ awsConfigFile: '/cfg', awsCredentialsFile: '/creds' })
  const conn = store.saveConnection({ name: 'Prod', profile: 'prod', region: 'sa-east-1' })
  const makeService = vi.fn((options) => ({ options }))
  return { store, conn, makeService, clients: createClients({ store, makeService }) }
}

describe('createClients', () => {
  it('builds one service per connection from its profile, region, and the AWS file settings', () => {
    const { conn, makeService, clients } = setup()
    const first = clients.forConnection(conn.id)
    expect(clients.forConnection(conn.id)).toBe(first)
    expect(makeService).toHaveBeenCalledTimes(1)
    expect(makeService).toHaveBeenCalledWith({ profile: 'prod', region: 'sa-east-1', configFile: '/cfg', credentialsFile: '/creds' })
  })

  it('drops cached services on invalidate and clear', () => {
    const { conn, makeService, clients } = setup()
    clients.forConnection(conn.id)
    clients.invalidate(conn.id)
    clients.forConnection(conn.id)
    clients.clear()
    clients.forConnection(conn.id)
    expect(makeService).toHaveBeenCalledTimes(3)
  })

  it('never caches draft services', () => {
    const { makeService, clients } = setup()
    clients.forDraft({ profile: 'p', region: 'us-east-1' })
    clients.forDraft({ profile: 'p', region: 'us-east-1' })
    expect(makeService).toHaveBeenCalledTimes(2)
  })

  it('returns the fake service for every connection in fake mode', () => {
    const { store, conn } = setup()
    const fakeService = { fake: true }
    const clients = createClients({ store, fakeService })
    expect(clients.forConnection(conn.id)).toBe(fakeService)
    expect(clients.forDraft({ profile: 'x', region: 'us-east-1' })).toBe(fakeService)
  })

  it('throws InvalidInput for an unknown connection', () => {
    expect(() => setup().clients.forConnection('missing')).toThrow('That connection no longer exists.')
  })
})
```

`test/unit/ipc.test.js`:

```js
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { API, CHANNELS } from '@shared/channels.js'
import { createClients } from '../../src/main/clients.js'
import { AppError } from '../../src/main/errors.js'
import { FakeSsmService } from '../../src/main/fake-ssm-service.js'
import { createHandlers, registerIpc, wrap } from '../../src/main/ipc.js'
import { createStore } from '../../src/main/store.js'

const quiet = () => {}

function setup({ readOnly = false, pathPrefix = '' } = {}) {
  const store = createStore(mkdtempSync(join(tmpdir(), 'vault-ipc-')))
  const conn = store.saveConnection({ name: 'Demo', profile: 'demo', region: 'sa-east-1', readOnly, pathPrefix })
  const fake = new FakeSsmService()
  const clients = createClients({ store, fakeService: fake })
  vi.spyOn(clients, 'clear')
  vi.spyOn(clients, 'invalidate')
  const handlers = createHandlers({
    store,
    clients,
    fake: true,
    appVersion: '1.2.3',
    resolvePaths: () => ({ configPath: '/c', credentialsPath: '/k' }),
    listProfiles: async () => [{ name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false }]
  })
  const call = (channel, ...args) => wrap(handlers[channel], { log: quiet })(...args)
  return { store, conn, fake, clients, call }
}

const putInput = (overrides = {}) => ({ name: '/myapp/dev/env', value: 'A=1', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', dataType: 'text', overwrite: true, expectedVersion: 1, ...overrides })

describe('wrap', () => {
  it('returns ok envelopes and normalized errors', async () => {
    expect(await wrap(async () => 42, { log: quiet })()).toEqual({ ok: true, data: 42 })
    const failed = await wrap(() => {
      throw Object.assign(new Error('x'), { name: 'ThrottlingException' })
    }, { log: quiet })()
    expect(failed).toEqual({ ok: false, error: expect.objectContaining({ code: 'Throttled' }) })
  })

  it('reports credential errors for the connection so its client is rebuilt', async () => {
    const onCredentialError = vi.fn()
    const run = wrap(
      () => {
        throw Object.assign(new Error('expired'), { name: 'ExpiredTokenException' })
      },
      { contextOf: () => ({ connectionId: 'c1', profile: 'p' }), onCredentialError, log: quiet }
    )
    expect((await run()).error.code).toBe('ExpiredCredentials')
    expect(onCredentialError).toHaveBeenCalledWith('c1')
  })

  it('logs the code and name but never the value', async () => {
    const log = vi.fn()
    await wrap(() => {
      throw new AppError('InvalidInput', 'bad')
    }, { contextOf: () => ({ name: '/a' }), log })('secret-value')
    expect(log).toHaveBeenCalledWith('[ipc] InvalidInput /a: bad')
  })
})

describe('handlers', () => {
  it('app:info reports the version, fake flag, and load warnings once', async () => {
    const { store, call } = setup()
    store.warnings.push('settings.json was unreadable')
    expect((await call(API.app.info)).data).toEqual({ version: '1.2.3', fake: true, warnings: ['settings.json was unreadable'] })
    expect((await call(API.app.info)).data.warnings).toEqual([])
  })

  it('profiles:list returns the resolved paths with the profiles', async () => {
    const { call } = setup()
    expect((await call(API.profiles.list)).data).toEqual({ configPath: '/c', credentialsPath: '/k', profiles: [{ name: 'demo', region: 'sa-east-1', sources: ['credentials'], sso: false }] })
  })

  it('ssm:list applies the connection path prefix', async () => {
    const { conn, call } = setup({ pathPrefix: '/billing' })
    const { data } = await call(API.ssm.list, conn.id)
    expect(data.length).toBeGreaterThan(0)
    expect(data.every((r) => r.name.startsWith('/billing'))).toBe(true)
  })

  it('ssm:get passes decrypt through as a strict boolean', async () => {
    const { conn, call } = setup()
    expect((await call(API.ssm.get, conn.id, '/myapp/dev/env', { decrypt: 'yes' })).data.value).toBeNull()
    expect((await call(API.ssm.get, conn.id, '/myapp/dev/env', { decrypt: true })).data.value).toContain('APP_ENV=dev')
  })

  it('ssm:put writes through and returns the new version', async () => {
    const { conn, call } = setup()
    expect(await call(API.ssm.put, conn.id, putInput())).toEqual({ ok: true, data: { version: 2, tier: 'Standard' } })
  })

  it('refuses writes on read-only connections and leaves data untouched', async () => {
    const { conn, fake, call } = setup({ readOnly: true })
    expect((await call(API.ssm.put, conn.id, putInput())).error.code).toBe('ReadOnlyConnection')
    expect((await call(API.ssm.delete, conn.id, '/myapp/dev/env')).error.code).toBe('ReadOnlyConnection')
    expect((await fake.get('/myapp/dev/env')).version).toBe(1)
  })

  it('validates put input before calling AWS', async () => {
    const { conn, call } = setup()
    const code = async (input) => (await call(API.ssm.put, conn.id, input)).error
    expect(await code(putInput({ value: '' }))).toMatchObject({ code: 'InvalidInput', message: 'The value cannot be empty.' })
    expect(await code(putInput({ type: 'Binary' }))).toMatchObject({ code: 'InvalidInput', message: 'Unknown parameter type "Binary".' })
    expect(await code(putInput({ tier: 'Gold' }))).toMatchObject({ code: 'InvalidInput', message: 'Unknown tier "Gold".' })
    expect(await code(putInput({ value: 'x'.repeat(4097) }))).toMatchObject({ code: 'InvalidInput', message: 'The value is 4097 bytes; the Standard tier allows 4096 bytes.' })
    expect(await code(putInput({ name: 'bad name', overwrite: false }))).toMatchObject({ code: 'InvalidInput', message: 'Only letters, numbers, and _ . - / are allowed' })
  })

  it('connections:test validates the draft first', async () => {
    const { call } = setup()
    expect((await call(API.connections.test, { name: 'x', profile: '', region: 'sa-east-1' })).error.message).toBe('Choose an AWS profile.')
    expect(await call(API.connections.test, { name: 'x', profile: 'demo', region: 'sa-east-1' })).toEqual({ ok: true, data: { ok: true } })
  })

  it('accepts a test draft without a name', async () => {
    const { call } = setup()
    expect((await call(API.connections.test, { profile: 'demo', region: 'sa-east-1' })).ok).toBe(true)
  })

  it('invalidates cached clients when connections or settings change', async () => {
    const { conn, clients, call } = setup()
    await call(API.connections.save, { ...conn, region: 'us-east-1' })
    expect(clients.invalidate).toHaveBeenCalledWith(conn.id)
    await call(API.settings.save, { theme: 'dark' })
    expect(clients.clear).toHaveBeenCalled()
  })

  it('rejects unknown connection ids', async () => {
    const { call } = setup()
    expect((await call(API.ssm.get, 'missing', '/a', {})).error).toMatchObject({ code: 'InvalidInput', message: 'That connection no longer exists.' })
  })
})

describe('registerIpc', () => {
  it('registers every channel and fails fast when a handler is missing', async () => {
    const { store, clients } = setup()
    const ipcMain = { handle: vi.fn() }
    const handlers = Object.fromEntries(CHANNELS.map((c) => [c, async () => c]))
    registerIpc(ipcMain, { handlers, store, clients, log: quiet })
    expect(ipcMain.handle.mock.calls.map(([channel]) => channel)).toEqual([...CHANNELS])
    const [, listener] = ipcMain.handle.mock.calls[0]
    expect(await listener({}, 'arg')).toEqual({ ok: true, data: CHANNELS[0] })

    delete handlers[API.ssm.put]
    expect(() => registerIpc({ handle: vi.fn() }, { handlers, store, clients })).toThrow('Missing IPC handler for ssm:put')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/clients.test.js test/unit/ipc.test.js`
Expected: FAIL, because `clients.js` and `ipc.js` do not exist.

- [ ] **Step 3: Implement the client cache**

`src/main/clients.js`:

```js
import { SsmService, createSsmClient } from './ssm-service.js'

// One SsmService per saved connection, rebuilt when the connection, the AWS file
// settings, or its credentials change. In fake mode everything shares one fake.
export function createClients({ store, fakeService = null, makeService = (options) => new SsmService(createSsmClient(options)) }) {
  const cache = new Map()

  const optionsFor = (connection) => {
    const { awsConfigFile, awsCredentialsFile } = store.getSettings()
    return { profile: connection.profile, region: connection.region, configFile: awsConfigFile, credentialsFile: awsCredentialsFile }
  }

  return {
    forConnection(id) {
      const connection = store.getConnection(id)
      if (fakeService) return fakeService
      if (!cache.has(id)) cache.set(id, makeService(optionsFor(connection)))
      return cache.get(id)
    },
    forDraft(connection) {
      return fakeService ?? makeService(optionsFor(connection))
    },
    invalidate(id) {
      cache.delete(id)
    },
    clear() {
      cache.clear()
    }
  }
}
```

- [ ] **Step 4: Implement the handlers and registration**

`src/main/ipc.js`:

```js
import { API, CHANNELS } from '@shared/channels.js'
import { PARAMETER_TIERS, PARAMETER_TYPES, byteLength, tierLimit, validateName } from '@shared/names.js'
import { AppError, CREDENTIAL_ERROR_CODES, toIpcError } from './errors.js'
import { sanitizeConnection } from './store.js'

export function createHandlers({ store, clients, listProfiles, resolvePaths, fake = false, appVersion = '0.0.0' }) {
  const service = (id) => clients.forConnection(id)
  const writable = (id) => {
    const connection = store.getConnection(id)
    if (connection.readOnly) {
      throw new AppError('ReadOnlyConnection', `"${connection.name}" is a read-only connection.`, { hint: 'Edit the connection and turn off read-only to make changes.' })
    }
  }

  return {
    [API.app.info]: () => ({ version: appVersion, fake, warnings: store.warnings.splice(0) }),
    [API.profiles.list]: async () => {
      const paths = resolvePaths(store.getSettings())
      return { ...paths, profiles: await listProfiles(paths) }
    },
    [API.connections.list]: () => store.listConnections(),
    [API.connections.save]: (input) => {
      const saved = store.saveConnection(input)
      clients.invalidate(saved.id)
      return saved
    },
    [API.connections.delete]: (id) => {
      store.deleteConnection(id)
      clients.invalidate(id)
      return { deleted: true }
    },
    [API.connections.test]: (input) => {
      // A draft may not have a name yet; profile and region must still be valid.
      const draft = sanitizeConnection({ ...input, name: 'draft' }, 'draft', '')
      return clients.forDraft(draft).test(draft.pathPrefix)
    },
    [API.settings.get]: () => store.getSettings(),
    [API.settings.save]: (input) => {
      const saved = store.saveSettings(input)
      clients.clear()
      return saved
    },
    [API.ssm.list]: (id) => service(id).list(store.getConnection(id).pathPrefix),
    [API.ssm.get]: (id, name, options) => service(id).get(requireText(name), { decrypt: options?.decrypt === true }),
    [API.ssm.tags]: (id, name) => service(id).tags(requireText(name)),
    [API.ssm.history]: (id, name, options) => service(id).history(requireText(name), { decrypt: options?.decrypt === true }),
    [API.ssm.put]: (id, input) => {
      writable(id)
      return service(id).put(validatePut(input))
    },
    [API.ssm.delete]: (id, name) => {
      writable(id)
      return service(id).delete(requireText(name))
    }
  }
}

function validatePut(input) {
  const src = input && typeof input === 'object' ? input : {}
  const overwrite = src.overwrite === true
  // Strict name rules only for new parameters; existing names are whatever AWS accepted.
  const name = overwrite ? requireText(src.name) : requireValidName(src.name)
  if (typeof src.value !== 'string' || src.value.length === 0) throw new AppError('InvalidInput', 'The value cannot be empty.')
  if (!PARAMETER_TYPES.includes(src.type)) throw new AppError('InvalidInput', `Unknown parameter type "${src.type}".`)
  const tier = src.tier ?? 'Standard'
  if (!PARAMETER_TIERS.includes(tier)) throw new AppError('InvalidInput', `Unknown tier "${tier}".`)
  const bytes = byteLength(src.value)
  if (bytes > tierLimit(tier)) throw new AppError('InvalidInput', `The value is ${bytes} bytes; the ${tier} tier allows ${tierLimit(tier)} bytes.`)
  return {
    name,
    value: src.value,
    type: src.type,
    tier,
    keyId: optionalText(src.keyId),
    description: optionalText(src.description) ?? '',
    dataType: optionalText(src.dataType) ?? 'text',
    allowedPattern: optionalText(src.allowedPattern),
    overwrite,
    expectedVersion: Number.isInteger(src.expectedVersion) ? src.expectedVersion : null
  }
}

function optionalText(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

function requireText(value) {
  if (typeof value !== 'string' || value === '') throw new AppError('InvalidInput', 'A parameter name is required.')
  return value
}

function requireValidName(name) {
  const error = validateName(name)
  if (error) throw new AppError('InvalidInput', error)
  return name
}

function connectionContext(store, id) {
  try {
    const connection = store.getConnection(id)
    return { profile: connection.profile, connectionId: connection.id }
  } catch {
    return {}
  }
}

// What each channel was doing, for readable AccessDenied messages and credential resets.
const CONTEXT = {
  [API.connections.test]: (store, input) => ({ action: 'list parameters', profile: input?.profile }),
  [API.ssm.list]: (store, id) => ({ action: 'list parameters', ...connectionContext(store, id) }),
  [API.ssm.get]: (store, id, name) => ({ action: 'read', name, ...connectionContext(store, id) }),
  [API.ssm.tags]: (store, id, name) => ({ action: 'read the tags of', name, ...connectionContext(store, id) }),
  [API.ssm.history]: (store, id, name) => ({ action: 'read the history of', name, ...connectionContext(store, id) }),
  [API.ssm.put]: (store, id, input) => ({ action: 'write', name: input?.name, ...connectionContext(store, id) }),
  [API.ssm.delete]: (store, id, name) => ({ action: 'delete', name, ...connectionContext(store, id) })
}

export function wrap(handler, { contextOf = () => ({}), onCredentialError = () => {}, log = console.error } = {}) {
  return async (...args) => {
    try {
      return { ok: true, data: await handler(...args) }
    } catch (err) {
      const context = contextOf(...args)
      const error = toIpcError(err, context)
      if (CREDENTIAL_ERROR_CODES.has(error.code) && context.connectionId) onCredentialError(context.connectionId)
      log(`[ipc] ${error.code}${context.name ? ` ${context.name}` : ''}: ${error.message}`)
      return { ok: false, error }
    }
  }
}

export function registerIpc(ipcMain, { handlers, store, clients, log }) {
  for (const channel of CHANNELS) {
    const handler = handlers[channel]
    if (typeof handler !== 'function') throw new Error(`Missing IPC handler for ${channel}`)
    const run = wrap(handler, {
      contextOf: (...args) => CONTEXT[channel]?.(store, ...args) ?? {},
      onCredentialError: (id) => clients.invalidate(id),
      log
    })
    ipcMain.handle(channel, (_event, ...args) => run(...args))
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/clients.test.js test/unit/ipc.test.js`
Expected: PASS.

- [ ] **Step 6: Wire everything into the main process**

Replace `src/main/index.js`:

```js
import { app, BrowserWindow, ipcMain } from 'electron'
import { createClients } from './clients.js'
import { FAKE_CONNECTIONS, FAKE_PROFILES, FakeSsmService } from './fake-ssm-service.js'
import { createHandlers, registerIpc } from './ipc.js'
import { listProfiles, resolveAwsPaths } from './profiles.js'
import { createStore } from './store.js'
import { createMainWindow, installMenu } from './window.js'

// VAULT_USER_DATA isolates e2e runs; VAULT_FAKE_SSM=1 swaps AWS for the in-memory fake.
if (process.env.VAULT_USER_DATA) app.setPath('userData', process.env.VAULT_USER_DATA)
const fake = process.env.VAULT_FAKE_SSM === '1'

app.whenReady().then(() => {
  const store = createStore(app.getPath('userData'), { seedConnections: fake ? FAKE_CONNECTIONS : [] })
  const clients = createClients({ store, fakeService: fake ? new FakeSsmService({ delayMs: 120 }) : null })
  const handlers = createHandlers({
    store,
    clients,
    fake,
    appVersion: app.getVersion(),
    resolvePaths: (settings) => resolveAwsPaths({ configFile: settings.awsConfigFile, credentialsFile: settings.awsCredentialsFile }),
    listProfiles: fake ? async () => FAKE_PROFILES.map((p) => ({ ...p })) : listProfiles
  })
  registerIpc(ipcMain, { handlers, store, clients })

  installMenu()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 7: Verify the whole suite and the build**

Run: `npm test && npm run build`
Expected: all unit tests pass, and the build succeeds. The `out/main/index.js` imports `@aws-sdk/client-ssm` as an external module (`grep -c "@aws-sdk/client-ssm" out/main/index.js` prints at least 1), so the SDK is not bundled.

- [ ] **Step 8: Commit**

```bash
git add src/main test/unit/clients.test.js test/unit/ipc.test.js
git commit -m "feat: expose SSM, connections, and settings over validated IPC

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 12: Renderer core (DOM helper, API client, theme, tab model)

**Files:**
- Create: `src/renderer/lib/dom.js`, `src/renderer/lib/form.js`, `src/renderer/api.js`, `src/renderer/theme.js`, `src/renderer/tabs.js`
- Test: `test/renderer/dom.test.js`, `test/renderer/api.test.js`, `test/renderer/theme.test.js`, `test/renderer/tabs.test.js`

**Interfaces:**
- Consumes: `API` (Task 1).
- Produces from `lib/dom.js`:
  - `h(tag, props?, ...children) → HTMLElement`. Props behave as follows:
    - `class`: a string, or an array with falsy entries dropped.
    - `dataset`: an object.
    - `style`: an object; `--custom` properties are supported.
    - `onXxx`: a function, added as the `xxx` event listener.
    - `true`: sets an empty attribute.
    - `false`, `null`, or `undefined`: skipped.
    - Anything else: set as a string attribute.
  - Children are nodes, strings, numbers, or nested arrays; `null`, `false`, and `true` are skipped.
  - `append(parent, children)` and `clear(el)`.
- Produces from `lib/form.js`: `field(label, control, help?, error?) → <label class="field">`.
- Produces from `api.js`: `class ApiError { code, message, hint, details }` and `createApi(bridge) → { group: { method(...args) → Promise<data> } }`. It throws `ApiError` on `{ ok: false }`, a transport failure, or a malformed response. Calling it with a missing bridge or method throws immediately.
- Produces from `theme.js`: `resolveTheme(setting, prefersDark) → 'light' | 'dark'` and `applyTheme(setting, root?, media?) → dispose()`.
- Produces from `tabs.js`: `createTabModel(initialTabs)` → `{ list(), get(id), activeId (getter), open(tab), activate(id), update(id, patch), close(id) → boolean, subscribe(fn) → unsubscribe }`. A tab is `{ id, title, closable = true, …extra }`. `open` of an existing id only activates it. `close` refuses non-closable tabs and then activates the right neighbour, or the left one.

- [ ] **Step 1: Write the failing tests**

`test/renderer/dom.test.js`:

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { append, clear, h } from '../../src/renderer/lib/dom.js'

describe('h', () => {
  it('sets classes, attributes, dataset, styles, and listeners', () => {
    const onClick = vi.fn()
    const el = h('button', { class: ['btn', false && 'no', 'btn--primary'], type: 'button', hidden: false, dataset: { action: 'save' }, style: { color: 'red', '--conn-color': 'blue' }, 'aria-label': 'Save', onClick }, 'Save')
    expect(el.className).toBe('btn btn--primary')
    expect(el.getAttribute('type')).toBe('button')
    expect(h('button', { disabled: true }).disabled).toBe(true)
    expect(el.hasAttribute('hidden')).toBe(false)
    expect(el.dataset.action).toBe('save')
    expect(el.style.color).toBe('red')
    expect(el.style.getPropertyValue('--conn-color')).toBe('blue')
    expect(el.getAttribute('aria-label')).toBe('Save')
    el.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('appends strings, numbers, nodes, and nested arrays, skipping empty values', () => {
    const el = h('div', {}, 'a', 1, null, false, true, undefined, [h('span', {}, 'b'), ['c']])
    expect(el.textContent).toBe('a1bc')
    expect(el.querySelector('span').textContent).toBe('b')
  })

  it('sets the initial value and checked state through attributes', () => {
    expect(h('input', { value: 'x' }).value).toBe('x')
    expect(h('input', { type: 'checkbox', checked: true }).checked).toBe(true)
  })
})

describe('append and clear', () => {
  it('appends a single child or a list, and clears', () => {
    const el = h('div')
    append(el, 'x')
    append(el, [h('i'), 'y'])
    expect(el.childNodes).toHaveLength(3)
    expect(clear(el).childNodes).toHaveLength(0)
  })
})
```

`test/renderer/api.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { API } from '@shared/channels.js'
import { ApiError, createApi } from '../../src/renderer/api.js'

const makeBridge = (overrides = {}) =>
  Object.fromEntries(
    Object.entries(API).map(([group, methods]) => [
      group,
      Object.fromEntries(Object.keys(methods).map((m) => [m, overrides[`${group}.${m}`] ?? vi.fn(async () => ({ ok: true, data: null }))]))
    ])
  )

describe('createApi', () => {
  it('resolves with data and passes arguments through', async () => {
    const get = vi.fn(async () => ({ ok: true, data: { value: 'A=1' } }))
    const api = createApi(makeBridge({ 'ssm.get': get }))
    expect(await api.ssm.get('c1', '/a', { decrypt: true })).toEqual({ value: 'A=1' })
    expect(get).toHaveBeenCalledWith('c1', '/a', { decrypt: true })
  })

  it('throws ApiError with the error fields on ok: false', async () => {
    const api = createApi(makeBridge({ 'ssm.put': async () => ({ ok: false, error: { code: 'VersionConflict', message: 'changed', hint: 'reload', details: { currentVersion: 3 } } }) }))
    const err = await api.ssm.put('c1', {}).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'VersionConflict', message: 'changed', hint: 'reload', details: { currentVersion: 3 } })
  })

  it('wraps transport failures and malformed responses', async () => {
    const api = createApi(
      makeBridge({
        'app.info': async () => {
          throw new Error('IPC closed')
        },
        'settings.get': async () => 'nope'
      })
    )
    await expect(api.app.info()).rejects.toMatchObject({ code: 'Unknown', message: 'IPC closed' })
    await expect(api.settings.get()).rejects.toMatchObject({ code: 'Unknown', message: 'Unexpected response from settings.get.' })
  })

  it('fails fast when the bridge is missing or incomplete', () => {
    expect(() => createApi(undefined)).toThrow('window.vault is missing')
    const bridge = makeBridge()
    delete bridge.ssm.delete
    expect(() => createApi(bridge)).toThrow('window.vault.ssm.delete is missing')
  })
})
```

`test/renderer/theme.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { applyTheme, resolveTheme } from '../../src/renderer/theme.js'

const fakeMedia = (matches) => {
  const listeners = new Set()
  return { matches, listeners, addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn) }
}

describe('theme', () => {
  it('resolves explicit and system themes', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('applies an explicit theme without listening to the OS', () => {
    const root = { dataset: {} }
    const media = fakeMedia(true)
    applyTheme('light', root, media)
    expect(root.dataset.theme).toBe('light')
    expect(media.listeners.size).toBe(0)
  })

  it('follows the OS for "system" until disposed', () => {
    const root = { dataset: {} }
    const media = fakeMedia(false)
    const dispose = applyTheme('system', root, media)
    expect(root.dataset.theme).toBe('light')
    media.matches = true
    media.listeners.forEach((fn) => fn())
    expect(root.dataset.theme).toBe('dark')
    dispose()
    expect(media.listeners.size).toBe(0)
  })
})
```

`test/renderer/tabs.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { createTabModel } from '../../src/renderer/tabs.js'

const model = () => createTabModel([{ id: 'parameters', title: 'Parameters', closable: false }])
const ids = (tabs) => tabs.list().map((t) => t.id)

describe('createTabModel', () => {
  it('starts with the fixed tab active', () => {
    const tabs = model()
    expect(ids(tabs)).toEqual(['parameters'])
    expect(tabs.activeId).toBe('parameters')
  })

  it('opens and activates tabs without duplicating them', () => {
    const tabs = model()
    tabs.open({ id: 'a', title: 'A' })
    tabs.open({ id: 'b', title: 'B' })
    tabs.open({ id: 'a', title: 'A again' })
    expect(ids(tabs)).toEqual(['parameters', 'a', 'b'])
    expect(tabs.activeId).toBe('a')
    expect(tabs.get('a').title).toBe('A')
  })

  it('activates the right neighbour after closing the active tab, else the left one', () => {
    const tabs = model()
    tabs.open({ id: 'a', title: 'A' })
    tabs.open({ id: 'b', title: 'B' })
    tabs.activate('a')
    expect(tabs.close('a')).toBe(true)
    expect(tabs.activeId).toBe('b')
    tabs.close('b')
    expect(tabs.activeId).toBe('parameters')
  })

  it('refuses to close non-closable or unknown tabs', () => {
    const tabs = model()
    expect(tabs.close('parameters')).toBe(false)
    expect(tabs.close('nope')).toBe(false)
    expect(ids(tabs)).toEqual(['parameters'])
  })

  it('updates tabs and notifies subscribers until they unsubscribe', () => {
    const tabs = model()
    const fn = vi.fn()
    const unsubscribe = tabs.subscribe(fn)
    tabs.open({ id: 'a', title: 'A' })
    tabs.update('a', { title: 'Renamed' })
    expect(tabs.get('a').title).toBe('Renamed')
    expect(fn).toHaveBeenCalledTimes(2)
    unsubscribe()
    tabs.activate('parameters')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/renderer/dom.test.js test/renderer/api.test.js test/renderer/theme.test.js test/renderer/tabs.test.js`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the core modules**

`src/renderer/lib/dom.js`:

```js
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
```

`src/renderer/lib/form.js`:

```js
import { h } from './dom.js'

export function field(label, control, help = null, error = null) {
  return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), control, help ? h('span', { class: 'field__help' }, help) : null, error)
}
```

`src/renderer/api.js`:

```js
import { API } from '@shared/channels.js'

export class ApiError extends Error {
  constructor({ code = 'Unknown', message = 'Something went wrong.', hint = null, details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
    this.details = details
  }
}

// Mirrors window.vault, but resolves to `data` and throws ApiError for { ok: false }.
export function createApi(bridge) {
  if (!bridge) throw new Error('window.vault is missing. Is the preload script loaded?')
  return Object.fromEntries(
    Object.entries(API).map(([group, methods]) => [
      group,
      Object.fromEntries(Object.keys(methods).map((method) => [method, unwrap(bridge, group, method)]))
    ])
  )
}

function unwrap(bridge, group, method) {
  const fn = bridge[group]?.[method]
  if (typeof fn !== 'function') throw new Error(`window.vault.${group}.${method} is missing`)
  return async (...args) => {
    let result
    try {
      result = await fn(...args)
    } catch (err) {
      throw new ApiError({ code: 'Unknown', message: err?.message ?? String(err) })
    }
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new ApiError({ code: 'Unknown', message: `Unexpected response from ${group}.${method}.` })
    }
    if (result.ok) return result.data
    throw new ApiError(result.error)
  }
}
```

`src/renderer/theme.js`:

```js
export function resolveTheme(setting, prefersDark) {
  if (setting === 'light' || setting === 'dark') return setting
  return prefersDark ? 'dark' : 'light'
}

// Sets <html data-theme>. For "system" it follows OS changes. Returns a disposer.
export function applyTheme(setting, root = document.documentElement, media = window.matchMedia?.('(prefers-color-scheme: dark)')) {
  const update = () => {
    root.dataset.theme = resolveTheme(setting, Boolean(media?.matches))
  }
  update()
  if (setting !== 'system' || !media) return () => {}
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
```

`src/renderer/tabs.js`:

```js
// Tab bookkeeping for the workspace; rendering lives in views/workspace.js.
export function createTabModel(initial = []) {
  let tabs = initial.map((tab) => ({ closable: true, ...tab }))
  let activeId = tabs[0]?.id ?? null
  const listeners = new Set()
  const emit = () => {
    for (const fn of [...listeners]) fn()
  }

  return {
    list: () => tabs.slice(),
    get: (id) => tabs.find((t) => t.id === id) ?? null,
    get activeId() {
      return activeId
    },
    open(tab) {
      if (!tabs.some((t) => t.id === tab.id)) tabs = [...tabs, { closable: true, ...tab }]
      activeId = tab.id
      emit()
    },
    activate(id) {
      if (id === activeId || !tabs.some((t) => t.id === id)) return
      activeId = id
      emit()
    },
    update(id, patch) {
      tabs = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
      emit()
    },
    close(id) {
      const index = tabs.findIndex((t) => t.id === id)
      if (index === -1 || !tabs[index].closable) return false
      tabs = tabs.filter((t) => t.id !== id)
      if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null
      emit()
      return true
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/renderer/dom.test.js test/renderer/api.test.js test/renderer/theme.test.js test/renderer/tabs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib src/renderer/api.js src/renderer/theme.js src/renderer/tabs.js test/renderer
git commit -m "feat: add renderer DOM helper, IPC client, theme switching, and tab model

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: UI kit — Compass tokens, base styles, icons, badges, toasts, and modals

**Files:**
- Create: `src/renderer/styles/tokens.css`, `src/renderer/styles/base.css`
- Create: `src/renderer/components/icons.js`, `src/renderer/components/badges.js`, `src/renderer/components/toast.js`, `src/renderer/components/modal.js`
- Test: `test/renderer/icons.test.js`, `test/renderer/toast.test.js`, `test/renderer/modal.test.js`

**Interfaces:**
- Consumes: `h` (Task 12).
- Produces from `icons.js`: `icon(name, size = 16) → SVGElement` with class `icon icon--<name>`; it throws for unknown names. Names are `close plus refresh search settings lock folder file chevronRight chevronDown chevronUp trash history compare plug logout eye eyeOff save undo warning info check key copy`. Also `ICON_NAMES`.
- Produces from `badges.js`: `typeBadge(type)`, `tierBadge(tier)`, `readOnlyBadge()`. Each returns `<span class="badge …">`, and the text is the raw value.
- Produces from `toast.js`: `mountToasts(parent?)`, `toast({ kind = 'info' | 'success' | 'warning' | 'error', title?, message?, hint?, timeout? }) → element` (`timeout: 0` keeps it until dismissed), and `toastError(err, title?)`.
- Produces from `modal.js`:
  - `openModal({ title, body, actions: [{ id, label, kind?, disabled?, onClick(modal) }], size?: 'sm' | 'md' | 'lg', onClose?(result), dismissible? = true })` → `{ root, button(id), setBusy(bool), close(result) }`. Buttons carry `data-action="<id>"`. Escape and a backdrop click close the modal with `undefined`, and only the topmost modal reacts to Escape.
  - `choiceDialog({ title, message, choices: [{ id, label, kind? }] }) → Promise<id | null>`.
  - `confirmDialog({ title, message, confirmLabel?, cancelLabel?, kind? }) → Promise<boolean>`.
  - `typeToConfirm({ title, message, expected, confirmLabel? }) → Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

`test/renderer/icons.test.js`:

```js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, icon } from '../../src/renderer/components/icons.js'
import { readOnlyBadge, tierBadge, typeBadge } from '../../src/renderer/components/badges.js'

describe('icon', () => {
  it('renders every icon as an SVG with paths', () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name, 12)
      expect(svg.tagName.toLowerCase()).toBe('svg')
      expect(svg.getAttribute('width')).toBe('12')
      expect(svg.getAttribute('class')).toBe(`icon icon--${name}`)
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0)
    }
  })

  it('throws for unknown names', () => {
    expect(() => icon('nope')).toThrow('Unknown icon "nope"')
  })
})

describe('badges', () => {
  it('styles parameter types, tiers, and read-only', () => {
    expect(typeBadge('SecureString').className).toBe('badge badge--secure')
    expect(typeBadge('SecureString').querySelector('.icon--lock')).not.toBeNull()
    expect(typeBadge('StringList').className).toBe('badge badge--list')
    expect(typeBadge('String').textContent).toBe('String')
    expect(tierBadge('Advanced').className).toBe('badge badge--advanced')
    expect(tierBadge('Standard').className).toBe('badge badge--muted')
    expect(readOnlyBadge().textContent).toBe('Read-only')
  })
})
```

`test/renderer/toast.test.js`:

```js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts, toast, toastError } from '../../src/renderer/components/toast.js'

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('toast', () => {
  it('shows title, message, and hint with the kind class', () => {
    toast({ kind: 'success', title: 'Saved', message: 'All good', hint: 'Nothing else to do' })
    const el = document.querySelector('.toasts .toast')
    expect(el.classList.contains('toast--success')).toBe(true)
    expect(el.querySelector('.toast__title').textContent).toBe('Saved')
    expect(el.querySelector('.toast__message').textContent).toBe('All good')
    expect(el.querySelector('.toast__hint').textContent).toBe('Nothing else to do')
  })

  it('removes itself after the timeout, and stays when timeout is 0', () => {
    vi.useFakeTimers()
    toast({ message: 'short', timeout: 1000 })
    toast({ message: 'sticky', timeout: 0 })
    vi.advanceTimersByTime(1000)
    expect([...document.querySelectorAll('.toast__message')].map((t) => t.textContent)).toEqual(['sticky'])
    vi.useRealTimers()
  })

  it('dismisses on the close button', () => {
    toast({ message: 'bye' })
    document.querySelector('.toast__close').click()
    expect(document.querySelector('.toast')).toBeNull()
  })

  it('toastError shows the message and hint and logs the error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = Object.assign(new Error('Not allowed'), { hint: 'Check IAM' })
    toastError(err, 'Save failed')
    const el = document.querySelector('.toast--error')
    expect(el.getAttribute('role')).toBe('alert')
    expect(el.textContent).toContain('Save failed')
    expect(el.textContent).toContain('Not allowed')
    expect(el.textContent).toContain('Check IAM')
    expect(log).toHaveBeenCalledWith(err)
  })
})
```

`test/renderer/modal.test.js`:

```js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from '../../src/renderer/lib/dom.js'
import { choiceDialog, confirmDialog, openModal, typeToConfirm } from '../../src/renderer/components/modal.js'

const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
const action = (id) => document.querySelector(`.modal [data-action="${id}"]`)
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => document.body.replaceChildren())

describe('openModal', () => {
  it('renders title, body, and actions, and Escape closes with undefined', () => {
    const onClose = vi.fn()
    openModal({ title: 'Hello', body: h('p', {}, 'Body'), actions: [{ id: 'ok', label: 'OK', kind: 'primary' }], onClose })
    expect(document.querySelector('.modal__title').textContent).toBe('Hello')
    expect(document.querySelector('.modal__body').textContent).toBe('Body')
    expect(action('ok').className).toBe('btn btn--primary')
    escape()
    expect(document.querySelector('.modal')).toBeNull()
    expect(onClose).toHaveBeenCalledWith(undefined)
  })

  it('closes on a backdrop mousedown but not on the dialog itself', () => {
    const modal = openModal({ title: 'X', body: 'b' })
    modal.root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.modal')).not.toBeNull()
    document.querySelector('.modal-backdrop').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('lets only the topmost modal react to Escape', () => {
    openModal({ title: 'A', body: '' })
    openModal({ title: 'B', body: '' })
    escape()
    expect([...document.querySelectorAll('.modal__title')].map((t) => t.textContent)).toEqual(['A'])
  })

  it('setBusy disables every button and then restores the previous states', () => {
    const modal = openModal({ title: 'X', body: '', actions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }] })
    modal.setBusy(true)
    expect([action('a').disabled, action('b').disabled]).toEqual([true, true])
    modal.setBusy(false)
    expect([action('a').disabled, action('b').disabled]).toEqual([false, true])
  })

  it('passes the controller to action handlers and reports close results', () => {
    const onClose = vi.fn()
    openModal({ title: 'X', body: '', onClose, actions: [{ id: 'go', label: 'Go', onClick: (m) => m.close('done') }] })
    action('go').click()
    expect(onClose).toHaveBeenCalledWith('done')
  })
})

describe('dialogs', () => {
  it('confirmDialog resolves true on confirm and false on cancel', async () => {
    const yes = confirmDialog({ title: 'Sure?', message: 'Really' })
    action('confirm').click()
    expect(await yes).toBe(true)
    const no = confirmDialog({ title: 'Sure?', message: 'Really' })
    action('cancel').click()
    expect(await no).toBe(false)
  })

  it('choiceDialog resolves the chosen id, or null when dismissed', async () => {
    const choices = [{ id: 'reload', label: 'Reload' }, { id: 'overwrite', label: 'Overwrite', kind: 'danger' }]
    const picked = choiceDialog({ title: 'Conflict', message: 'm', choices })
    action('overwrite').click()
    expect(await picked).toBe('overwrite')
    const dismissed = choiceDialog({ title: 'Conflict', message: 'm', choices })
    escape()
    expect(await dismissed).toBeNull()
  })

  it('typeToConfirm enables the button only for the exact text', async () => {
    const result = typeToConfirm({ title: 'Delete', message: 'Gone forever', expected: '/a/b' })
    const input = document.querySelector('.modal input')
    expect(document.activeElement).toBe(input)
    expect(action('confirm').disabled).toBe(true)
    type(input, '/a/')
    expect(action('confirm').disabled).toBe(true)
    type(input, '/a/b')
    expect(action('confirm').disabled).toBe(false)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(await result).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/renderer/icons.test.js test/renderer/toast.test.js test/renderer/modal.test.js`
Expected: FAIL, because the component modules do not exist.

- [ ] **Step 3: Implement icons and badges**

`src/renderer/components/icons.js`:

```js
const NS = 'http://www.w3.org/2000/svg'

// 24×24 stroke icons in the Lucide style; each entry is a list of path "d" strings.
const PATHS = {
  close: ['M18 6 6 18', 'M6 6l12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15.4 6.4L3 16', 'M3 21v-5h5'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm21 21-4.3-4.3'],
  settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  folder: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'],
  file: ['M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z', 'M14 3v5h5'],
  chevronRight: ['m9 6 6 6-6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronUp: ['m6 15 6-6 6 6'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  history: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  compare: ['M4 4h16v16H4z', 'M12 4v16'],
  plug: ['M9 2v6', 'M15 2v6', 'M6 8h12v3a6 6 0 0 1-12 0z', 'M12 17v5'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: ['m3 3 18 18', 'M10.6 5.1A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2', 'M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  save: ['M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M7 3v5h8', 'M7 21v-7h10v7'],
  undo: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  warning: ['M12 3 2 21h20z', 'M12 10v4', 'M12 17h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16v-4', 'M12 8h.01'],
  check: ['m5 12 5 5L20 7'],
  key: ['M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M10.9 12.1 20 3', 'm17 6 2 2', 'm15 8 2 2'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1']
}

export const ICON_NAMES = Object.freeze(Object.keys(PATHS))

export function icon(name, size = 16) {
  const paths = PATHS[name]
  if (!paths) throw new Error(`Unknown icon "${name}"`)
  const svg = document.createElementNS(NS, 'svg')
  const attrs = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `icon icon--${name}` }
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, String(value))
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
```

`src/renderer/components/badges.js`:

```js
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
```

- [ ] **Step 4: Implement toasts and modals**

`src/renderer/components/toast.js`:

```js
import { h } from '../lib/dom.js'
import { icon } from './icons.js'

const DEFAULT_TIMEOUT = { success: 4000, info: 5000, warning: 8000, error: 10000 }
let host = null

export function mountToasts(parent = document.body) {
  host?.remove()
  host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  parent.append(host)
  return host
}

// timeout 0 keeps the toast until it is dismissed.
export function toast({ kind = 'info', title = '', message = '', hint = '', timeout = DEFAULT_TIMEOUT[kind] ?? 5000 }) {
  if (!host?.isConnected) mountToasts()
  const el = h(
    'div',
    { class: ['toast', `toast--${kind}`], role: kind === 'error' ? 'alert' : null },
    h('div', { class: 'toast__body' }, title ? h('strong', { class: 'toast__title' }, title) : null, message ? h('span', { class: 'toast__message' }, message) : null, hint ? h('span', { class: 'toast__hint' }, hint) : null),
    h('button', { class: 'toast__close', type: 'button', 'aria-label': 'Dismiss', onClick: () => el.remove() }, icon('close', 14))
  )
  host.append(el)
  if (timeout > 0) setTimeout(() => el.remove(), timeout)
  return el
}

export function toastError(err, title = 'Something went wrong') {
  console.error(err)
  return toast({ kind: 'error', title, message: err?.message ?? String(err), hint: err?.hint ?? '' })
}
```

`src/renderer/components/modal.js`:

```js
import { h } from '../lib/dom.js'
import { icon } from './icons.js'

const stack = []

export function openModal({ title, body, actions = [], size = 'md', onClose = () => {}, dismissible = true }) {
  const previousFocus = document.activeElement
  let closed = false
  let savedDisabled = null
  let buttons = []

  const controller = {
    root: null,
    button: (id) => buttons.find((b) => b.dataset.action === id) ?? null,
    setBusy(busy) {
      if (busy) {
        savedDisabled = buttons.map((b) => b.disabled)
        for (const b of buttons) b.disabled = true
      } else if (savedDisabled) {
        buttons.forEach((b, i) => {
          b.disabled = savedDisabled[i]
        })
        savedDisabled = null
      }
    },
    close(result) {
      if (closed) return
      closed = true
      stack.splice(stack.indexOf(controller), 1)
      document.removeEventListener('keydown', onKeydown, true)
      backdrop.remove()
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
      onClose(result)
    }
  }

  buttons = actions.map((action) =>
    h('button', { class: ['btn', `btn--${action.kind ?? 'default'}`], type: 'button', disabled: action.disabled, dataset: { action: action.id }, onClick: () => action.onClick?.(controller) }, action.label)
  )
  const dialog = h(
    'div',
    { class: ['modal', `modal--${size}`], role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'modal__header' }, h('h2', { class: 'modal__title' }, title), dismissible ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close dialog', onClick: () => controller.close() }, icon('close')) : null),
    h('div', { class: 'modal__body' }, body),
    buttons.length ? h('footer', { class: 'modal__footer' }, buttons) : null
  )
  const backdrop = h('div', { class: 'modal-backdrop', onMousedown: (event) => event.target === backdrop && dismissible && controller.close() }, dialog)

  function onKeydown(event) {
    if (event.key !== 'Escape' || !dismissible || stack.at(-1) !== controller) return
    event.stopPropagation()
    controller.close()
  }

  controller.root = dialog
  stack.push(controller)
  document.addEventListener('keydown', onKeydown, true)
  document.body.append(backdrop)
  ;(dialog.querySelector('[autofocus]') ?? buttons.findLast((b) => !b.disabled) ?? dialog.querySelector('button'))?.focus()
  return controller
}

export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    openModal({
      title,
      size: 'sm',
      body: typeof message === 'string' ? h('p', {}, message) : message,
      onClose: (result) => resolve(result ?? null),
      actions: choices.map((choice) => ({ ...choice, onClick: (modal) => modal.close(choice.id) }))
    })
  })
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', kind = 'primary' }) {
  const choice = await choiceDialog({ title, message, choices: [{ id: 'cancel', label: cancelLabel }, { id: 'confirm', label: confirmLabel, kind }] })
  return choice === 'confirm'
}

export function typeToConfirm({ title, message, expected, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input mono', type: 'text', autofocus: true, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Type the name to confirm' })
    const modal = openModal({
      title,
      size: 'sm',
      body: [h('p', {}, message), h('p', { class: 'muted' }, 'Type ', h('code', {}, expected), ' to confirm.'), input],
      onClose: (result) => resolve(result === true),
      actions: [
        { id: 'cancel', label: 'Cancel', onClick: (m) => m.close(false) },
        { id: 'confirm', label: confirmLabel, kind: 'danger', disabled: true, onClick: (m) => input.value === expected && m.close(true) }
      ]
    })
    input.addEventListener('input', () => {
      modal.button('confirm').disabled = input.value !== expected
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && input.value === expected) modal.close(true)
    })
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/renderer/icons.test.js test/renderer/toast.test.js test/renderer/modal.test.js`
Expected: PASS.

- [ ] **Step 6: Add the Compass design tokens and base styles**

`src/renderer/styles/tokens.css`:

```css
/* MongoDB Compass / LeafyGreen palette, plus semantic tokens for light and dark. */
:root {
  --black: #001e2b;
  --white: #ffffff;
  --gray-dark4: #112733;
  --gray-dark3: #1c2d38;
  --gray-dark2: #3d4f58;
  --gray-dark1: #5c6c75;
  --gray-base: #889397;
  --gray-light1: #c1c7c6;
  --gray-light2: #e8edeb;
  --gray-light3: #f9fbfa;
  --green-dark3: #023430;
  --green-dark2: #00684a;
  --green-dark1: #00a35c;
  --green-base: #00ed64;
  --green-light1: #71f6ba;
  --green-light2: #c0fae6;
  --green-light3: #e3fcf7;
  --blue-dark2: #083c90;
  --blue-dark1: #1254b7;
  --blue-base: #016bf8;
  --blue-light1: #0498ec;
  --blue-light2: #c3e7fe;
  --blue-light3: #e1f7ff;
  --yellow-dark2: #944f01;
  --yellow-base: #ffc010;
  --yellow-light2: #ffec9e;
  --yellow-light3: #fef7db;
  --red-dark2: #970606;
  --red-base: #db3030;
  --red-light2: #ffcdc7;
  --red-light3: #ffeae5;
  --purple-base: #b45af2;

  --font-sans: 'Euclid Circular A', Inter, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'Source Code Pro', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace;
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgb(0 30 43 / 0.08);
  --shadow-lg: 0 18px 48px -12px rgb(0 30 43 / 0.35);
  --focus: 0 0 0 3px rgb(0 237 100 / 0.45);

  --conn-none: var(--gray-base);
  --conn-red: #db3030;
  --conn-orange: #e8740c;
  --conn-yellow: #ffc010;
  --conn-green: #00a35c;
  --conn-teal: #13aa98;
  --conn-blue: #016bf8;
  --conn-purple: #b45af2;
  --conn-pink: #e0569b;

  color-scheme: light;
  --bg: var(--white);
  --bg-subtle: var(--gray-light3);
  --bg-muted: var(--gray-light2);
  --surface: var(--white);
  --border: var(--gray-light2);
  --border-strong: var(--gray-light1);
  --text: var(--black);
  --text-muted: var(--gray-dark1);
  --text-subtle: var(--gray-base);
  --primary: var(--green-dark2);
  --primary-hover: var(--green-dark3);
  --primary-text: var(--white);
  --danger: var(--red-base);
  --danger-hover: var(--red-dark2);
  --sidebar-bg: var(--black);
  --sidebar-bg-hover: var(--gray-dark4);
  --sidebar-active: var(--gray-dark3);
  --sidebar-text: var(--gray-light2);
  --sidebar-muted: var(--gray-base);
  --sidebar-border: var(--gray-dark3);
  --editor-bg: var(--white);
  --editor-gutter-bg: var(--gray-light3);
  --editor-active-line: rgb(232 237 235 / 0.6);
  --editor-selection: var(--blue-light2);
  --code-key: var(--blue-dark1);
  --code-keyword: var(--purple-base);
  --code-operator: var(--gray-dark1);
  --code-value: var(--black);
  --code-string: var(--green-dark2);
  --code-escape: var(--yellow-dark2);
  --code-comment: var(--gray-base);
  --code-invalid: var(--red-base);
  --diff-added-bg: var(--green-light3);
  --diff-added-text: var(--green-dark2);
  --diff-removed-bg: var(--red-light3);
  --diff-removed-text: var(--red-dark2);
  --diff-changed-bg: var(--yellow-light3);
  --diff-changed-text: var(--yellow-dark2);
  --tint-green-bg: var(--green-light3);
  --tint-green-text: var(--green-dark2);
  --tint-green-border: var(--green-light2);
  --tint-blue-bg: var(--blue-light3);
  --tint-blue-text: var(--blue-dark1);
  --tint-blue-border: var(--blue-light2);
  --tint-yellow-bg: var(--yellow-light3);
  --tint-yellow-text: var(--yellow-dark2);
  --tint-yellow-border: var(--yellow-light2);
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: var(--black);
  --bg-subtle: var(--gray-dark4);
  --bg-muted: var(--gray-dark3);
  --surface: var(--gray-dark4);
  --border: var(--gray-dark3);
  --border-strong: var(--gray-dark2);
  --text: var(--gray-light2);
  --text-muted: var(--gray-light1);
  --text-subtle: var(--gray-base);
  --primary: var(--green-dark2);
  --primary-hover: var(--green-dark1);
  --sidebar-bg: #00141d;
  --sidebar-bg-hover: var(--gray-dark4);
  --sidebar-active: var(--gray-dark3);
  --editor-bg: var(--black);
  --editor-gutter-bg: var(--gray-dark4);
  --editor-active-line: rgb(28 45 56 / 0.7);
  --editor-selection: var(--blue-dark2);
  --code-key: var(--blue-light1);
  --code-keyword: #d8a6ff;
  --code-operator: var(--gray-base);
  --code-value: var(--gray-light2);
  --code-string: var(--green-light1);
  --code-escape: var(--yellow-base);
  --code-comment: var(--gray-dark1);
  --code-invalid: #ff6960;
  --diff-added-bg: rgb(0 104 74 / 0.28);
  --diff-added-text: var(--green-light1);
  --diff-removed-bg: rgb(219 48 48 / 0.2);
  --diff-removed-text: var(--red-light2);
  --diff-changed-bg: rgb(255 192 16 / 0.14);
  --diff-changed-text: var(--yellow-light2);
  --tint-green-bg: rgb(0 104 74 / 0.3);
  --tint-green-text: var(--green-light1);
  --tint-green-border: transparent;
  --tint-blue-bg: rgb(1 107 248 / 0.2);
  --tint-blue-text: var(--blue-light2);
  --tint-blue-border: transparent;
  --tint-yellow-bg: rgb(255 192 16 / 0.12);
  --tint-yellow-text: var(--yellow-light2);
  --tint-yellow-border: rgb(255 192 16 / 0.3);
}
```

`src/renderer/styles/base.css`:

```css
/* Source Code Pro is the monospace face Compass uses; bundled so names and the editor match. */
@import '@fontsource/source-code-pro/400.css';
@import '@fontsource/source-code-pro/600.css';

*,
*::before,
*::after {
  box-sizing: border-box;
}
html,
body,
#app {
  height: 100%;
}
body {
  margin: 0;
  overflow: hidden;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
h2 {
  font-size: 16px;
  font-weight: 600;
}
h3 {
  font-size: 13px;
  font-weight: 600;
}
code,
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
}
code {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
}
[hidden] {
  display: none !important;
}
:focus-visible {
  outline: none;
  box-shadow: var(--focus);
}
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 10px;
  background: var(--border-strong);
  background-clip: content-box;
}
.muted {
  color: var(--text-muted);
}
.spacer {
  flex: 1;
}
.nowrap {
  white-space: nowrap;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.break {
  word-break: break-all;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.btn:hover:not(:disabled) {
  background: var(--bg-muted);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--primary {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--primary-text);
}
.btn--primary:hover:not(:disabled) {
  border-color: var(--primary-hover);
  background: var(--primary-hover);
}
.btn--danger {
  border-color: var(--danger);
  background: var(--danger);
  color: var(--white);
}
.btn--danger:hover:not(:disabled) {
  background: var(--danger-hover);
}
.btn--ghost {
  border-color: transparent;
  background: transparent;
}
.btn--ghost-danger {
  border-color: transparent;
  background: transparent;
  color: var(--danger);
}
.btn--ghost-danger:hover:not(:disabled) {
  background: var(--diff-removed-bg);
}
.btn--sm {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}
.btn--block {
  width: 100%;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--bg-muted);
  color: var(--text);
}
.icon-btn--sm {
  width: 24px;
  height: 24px;
}
.icon {
  flex: none;
}

/* Inputs */
.input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.input::placeholder {
  color: var(--text-subtle);
}
.input:focus {
  outline: none;
  border-color: var(--green-dark1);
  box-shadow: var(--focus);
}
select.input {
  appearance: none;
  padding-right: 28px;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23889397' stroke-width='2.5'><path d='m6 9 6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 9px center;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.field__label {
  font-weight: 600;
}
.field__help {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}
.field__error {
  min-height: 16px;
  color: var(--danger);
  font-size: 12px;
}
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.checkbox {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}
.checkbox input {
  width: 15px;
  height: 15px;
  margin-top: 2px;
  accent-color: var(--green-dark1);
}
.checkbox > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.checkbox--inline {
  align-items: center;
}

/* Badges, tags, callouts */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}
.badge--secure,
.badge--current {
  border-color: var(--tint-green-border);
  background: var(--tint-green-bg);
  color: var(--tint-green-text);
}
.badge--list {
  border-color: var(--tint-blue-border);
  background: var(--tint-blue-bg);
  color: var(--tint-blue-text);
}
.badge--advanced,
.badge--readonly {
  border-color: var(--tint-yellow-border);
  background: var(--tint-yellow-bg);
  color: var(--tint-yellow-text);
}
.tag {
  display: inline-flex;
  gap: 2px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-muted);
  font-size: 12px;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.callout {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-subtle);
}
.callout--warning {
  border-color: var(--tint-yellow-border);
  background: var(--tint-yellow-bg);
  color: var(--tint-yellow-text);
}
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

/* States */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px 16px;
  text-align: center;
}
.empty-state--error strong {
  color: var(--danger);
}
.loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px;
  color: var(--text-muted);
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--green-dark1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.skeleton {
  display: block;
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--bg-muted), var(--bg-subtle), var(--bg-muted));
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 24px 24px;
  overflow: auto;
  background: rgb(0 30 43 / 0.55);
  animation: fade-in 0.12s ease-out;
}
.modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 84vh;
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.modal--sm {
  max-width: 440px;
}
.modal--md {
  max-width: 560px;
}
.modal--lg {
  max-width: 880px;
}
.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px 8px;
}
.modal__title {
  font-size: 18px;
  word-break: break-all;
}
.modal__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 24px 18px;
  overflow: auto;
}
.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--border);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: var(--bg-subtle);
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}

/* Toasts */
.toasts {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 420px;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 12px 16px;
  border-left: 4px solid var(--gray-base);
  border-radius: var(--radius-lg);
  background: var(--black);
  color: var(--gray-light2);
  box-shadow: var(--shadow-lg);
  animation: toast-in 0.18s ease-out;
}
.toast--success {
  border-left-color: var(--green-base);
}
.toast--error {
  border-left-color: var(--red-base);
}
.toast--warning {
  border-left-color: var(--yellow-base);
}
.toast--info {
  border-left-color: var(--blue-light1);
}
.toast__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  word-break: break-word;
}
.toast__title {
  color: var(--white);
}
.toast__hint {
  color: var(--gray-light1);
  font-size: 12px;
}
.toast__close {
  padding: 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--gray-light1);
  cursor: pointer;
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* Demo mode: a thin bar above the app, so it never covers content. */
body.is-demo #app {
  height: calc(100% - 22px);
  margin-top: 22px;
}
.demo-banner {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  background: var(--yellow-base);
  color: var(--black);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 7: Run the renderer suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/components src/renderer/styles test/renderer
git commit -m "feat: add Compass design tokens, base styles, icons, badges, toasts, and modals

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 14: CodeMirror `.env` editor

**Files:**
- Create: `src/renderer/components/env-language.js`, `src/renderer/components/env-lint.js`, `src/renderer/components/env-editor.js`, `src/renderer/styles/editor.css`
- Test: `test/renderer/env-language.test.js`, `test/renderer/env-lint.test.js`, `test/renderer/env-editor.test.js`

**Interfaces:**
- Consumes: `parseEnv`, `normalizeEol` (Task 2); `byteLength`, `tierLimit` (Task 4); `formatNumber` (Task 4); `h` (Task 12).
- Produces from `env-language.js`: `envStreamParser`, `envLanguage` (a `StreamLanguage`), `envHighlightStyle`, `envTheme`, and `envSupport() → Extension[]`. Token names are `comment keyword propertyName operator content string escape invalid`.
- Produces from `env-lint.js`: `envDiagnostics(text) → Array<{ from, to, severity: 'warning', message }>` (empty for text that is not `.env`), and `envLint() → Extension[]`.
- Produces from `env-editor.js`: `createEnvEditor({ value?, tier?, readOnly?, onChange?(dirty, text), onSave?() })` → `{ el, view, getValue(), isDirty(), setValue(text, { markClean = true }?), setTier(tier), setReadOnly(bool), focus(), destroy() }`.
  - The baseline used by `isDirty` is the LF-normalized value.
  - `onChange` fires once per document change or `setValue`.
  - `Mod-S` calls `onSave`.

- [ ] **Step 1: Write the failing tests**

`test/renderer/env-language.test.js`:

```js
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { envLanguage } from '../../src/renderer/components/env-language.js'

// StreamLanguage merges adjacent tokens of the same type into one node.
function tokens(doc) {
  const state = EditorState.create({ doc, extensions: [envLanguage] })
  const out = []
  ensureSyntaxTree(state, state.doc.length, 5000).iterate({
    enter: (node) => {
      if (node.name !== 'Document') out.push([doc.slice(node.from, node.to), node.name])
    }
  })
  return out
}

describe('envLanguage', () => {
  it('tokenizes comments, keys, operators, values, and trailing comments', () => {
    expect(tokens('# note\nA=1 # c')).toEqual([['# note', 'comment'], ['A', 'propertyName'], ['=', 'operator'], ['1', 'content'], ['# c', 'comment']])
  })

  it('tokenizes export, double-quoted strings with escapes, and single quotes', () => {
    expect(tokens('export B="x\\ny"\nC=\'q # z\'')).toEqual([
      ['export', 'keyword'],
      ['B', 'propertyName'],
      ['=', 'operator'],
      ['"x', 'string'],
      ['\\n', 'escape'],
      ['y"', 'string'],
      ['C', 'propertyName'],
      ['=', 'operator'],
      ["'q # z'", 'string']
    ])
  })

  it('carries a double-quoted value across lines', () => {
    expect(tokens('K="multi\nline"\nN=2')).toEqual([['K', 'propertyName'], ['=', 'operator'], ['"multi', 'string'], ['line"', 'string'], ['N', 'propertyName'], ['=', 'operator'], ['2', 'content']])
  })

  it('marks lines that are not KEY=value as invalid', () => {
    expect(tokens('bad line\n=x')).toEqual([['bad line', 'invalid'], ['=x', 'invalid']])
  })

  it('handles spaces around "=" and empty values', () => {
    expect(tokens('A=\nB = 2')).toEqual([['A', 'propertyName'], ['=', 'operator'], ['B', 'propertyName'], ['=', 'operator'], ['2', 'content']])
  })
})
```

`test/renderer/env-lint.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { envDiagnostics } from '../../src/renderer/components/env-lint.js'

describe('envDiagnostics', () => {
  it('returns nothing for valid .env', () => {
    expect(envDiagnostics('A=1\n# c\nB=2')).toEqual([])
  })

  it('marks invalid lines and duplicate keys across the whole line', () => {
    expect(envDiagnostics('A=1\nnot valid\nA=2')).toEqual([
      { from: 4, to: 13, severity: 'warning', message: 'Expected KEY=value' },
      { from: 14, to: 17, severity: 'warning', message: 'Duplicate key "A" (first defined on line 1)' }
    ])
  })

  it('stays quiet for text that is not .env at all', () => {
    expect(envDiagnostics('{"json": true}')).toEqual([])
  })
})
```

`test/renderer/env-editor.test.js`:

```js
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvEditor } from '../../src/renderer/components/env-editor.js'

const editors = []
const mount = (options) => {
  const editor = createEnvEditor(options)
  document.body.append(editor.el)
  editors.push(editor)
  return editor
}
const typeAtEnd = (editor, text) => editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: text } })
const status = (editor) => editor.el.querySelector('.editor-status__bytes')

afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  document.body.replaceChildren()
})

describe('createEnvEditor', () => {
  it('shows the value, line count, and byte usage', () => {
    const editor = mount({ value: 'A=1\nB=2', tier: 'Standard' })
    expect(editor.getValue()).toBe('A=1\nB=2')
    expect(editor.el.querySelector('.editor-status__lines').textContent).toBe('2 lines')
    expect(status(editor).textContent).toBe('7 / 4,096 bytes (Standard)')
  })

  it('reports dirty changes, and becomes clean again when the text is restored', () => {
    const onChange = vi.fn()
    const editor = mount({ value: 'A=1', onChange })
    typeAtEnd(editor, '\nB=2')
    expect(editor.isDirty()).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(true, 'A=1\nB=2')
    editor.setValue('A=1', { markClean: false })
    expect(editor.isDirty()).toBe(false)
    expect(onChange).toHaveBeenLastCalledWith(false, 'A=1')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('is not dirty right after loading a CRLF value', () => {
    const editor = mount({ value: 'A=1\r\nB=2\r\n' })
    expect(editor.isDirty()).toBe(false)
    expect(editor.getValue()).toBe('A=1\nB=2\n')
  })

  it('setValue makes the new text the baseline unless markClean is false', () => {
    const editor = mount({ value: 'A=1' })
    editor.setValue('A=2')
    expect(editor.isDirty()).toBe(false)
    editor.setValue('A=3', { markClean: false })
    expect(editor.isDirty()).toBe(true)
  })

  it('flags values over the tier limit and follows tier changes', () => {
    const editor = mount({ value: 'x'.repeat(5000), tier: 'Standard' })
    expect(status(editor).classList.contains('is-over')).toBe(true)
    editor.setTier('Advanced')
    expect(status(editor).classList.contains('is-over')).toBe(false)
    expect(status(editor).textContent).toBe('5,000 / 8,192 bytes (Advanced)')
  })

  it('shows a notice for values that are not .env', () => {
    const editor = mount({ value: '{"a": 1}' })
    const notice = editor.el.querySelector('.editor-notice')
    expect(notice.hidden).toBe(false)
    editor.setValue('A=1')
    expect(notice.hidden).toBe(true)
  })

  it('calls onSave on Mod-S', () => {
    const onSave = vi.fn()
    const editor = mount({ value: 'A=1', onSave })
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('can be read-only and switched back', () => {
    const editor = mount({ value: 'A=1', readOnly: true })
    expect(editor.view.state.readOnly).toBe(true)
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('false')
    editor.setReadOnly(false)
    expect(editor.view.state.readOnly).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/renderer/env-language.test.js test/renderer/env-lint.test.js test/renderer/env-editor.test.js`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the language, linter, and editor**

`src/renderer/components/env-language.js`:

```js
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const KEY_THEN_EQUALS = /^[A-Za-z_][A-Za-z0-9_.-]*(?=\s*=)/
const EXPORT_THEN_KEY = /^export(?=\s+[A-Za-z_][A-Za-z0-9_.-]*\s*=)/

// Follows the parse rules in @shared/env.js. Token names double as @lezer/highlight tags.
export const envStreamParser = {
  name: 'env',
  startState: () => ({ phase: 'start', inQuote: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.inQuote) return readQuoted(stream, state)
    if (stream.sol()) state.phase = 'start'
    if (stream.eatSpace()) return null

    switch (state.phase) {
      case 'start':
        if (stream.peek() === '#') {
          stream.skipToEnd()
          return 'comment'
        }
        if (stream.match(EXPORT_THEN_KEY)) {
          state.phase = 'key'
          return 'keyword'
        }
      // falls through
      case 'key':
        if (stream.match(KEY_THEN_EQUALS)) {
          state.phase = 'equals'
          return 'propertyName'
        }
        stream.skipToEnd()
        return 'invalid'
      case 'equals':
        stream.next()
        state.phase = 'value'
        return 'operator'
      case 'value':
        if (stream.peek() === '"') {
          stream.next()
          state.inQuote = true
          return 'string'
        }
        state.phase = 'after'
        if (stream.match(/^'[^']*'?/)) return 'string'
        stream.match(/^.*?(?=\s+#|$)/)
        return 'content'
      default:
        if (stream.peek() === '#') {
          stream.skipToEnd()
          return 'comment'
        }
        stream.skipToEnd()
        return null
    }
  }
}

function readQuoted(stream, state) {
  if (stream.match(/^\\./)) return 'escape'
  if (stream.match(/^[^"\\]+/)) return 'string'
  if (stream.eat('"')) {
    state.inQuote = false
    state.phase = 'after'
    return 'string'
  }
  stream.next()
  return 'string'
}

export const envLanguage = StreamLanguage.define(envStreamParser)

export const envHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: t.propertyName, color: 'var(--code-key)', fontWeight: '600' },
  { tag: t.operator, color: 'var(--code-operator)' },
  { tag: t.content, color: 'var(--code-value)' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.escape, color: 'var(--code-escape)' },
  { tag: t.invalid, color: 'var(--code-invalid)', textDecoration: 'underline wavy' }
])

// Colors come from CSS variables, so a theme switch needs no editor reconfiguration.
export const envTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text)', backgroundColor: 'var(--editor-bg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-gutter-bg)', color: 'var(--text-subtle)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--editor-selection)'
  },
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--tint-yellow-bg)', outline: '1px solid var(--yellow-base)' }
})

export function envSupport() {
  return [envLanguage, syntaxHighlighting(envHighlightStyle), envTheme]
}
```

`src/renderer/components/env-lint.js`:

```js
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
```

`src/renderer/components/env-editor.js`:

```js
import '../styles/editor.css'
import { minimalSetup } from 'codemirror'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { normalizeEol, parseEnv } from '@shared/env.js'
import { formatNumber } from '@shared/format.js'
import { byteLength, tierLimit } from '@shared/names.js'
import { h } from '../lib/dom.js'
import { envSupport } from './env-language.js'
import { envLint } from './env-lint.js'

export function createEnvEditor({ value = '', tier = 'Standard', readOnly = false, onChange = () => {}, onSave = () => {} } = {}) {
  let original = normalizeEol(value)
  let currentTier = tier
  let silent = false
  const editable = new Compartment()

  const notice = h('div', { class: 'editor-notice', hidden: true }, 'Not in .env format — editing as plain text.')
  const lines = h('span', { class: 'editor-status__lines' })
  const bytes = h('span', { class: 'editor-status__bytes' })
  const host = h('div', { class: 'editor-host' })
  const el = h('div', { class: 'env-editor' }, notice, host, h('div', { class: 'editor-status' }, lines, bytes))

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: original,
      extensions: [
        minimalSetup,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...lintKeymap]),
        envSupport(),
        envLint(),
        editable.of(readOnlyExtensions(readOnly)),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSave()
                return true
              }
            }
          ])
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || silent) return
          changed()
        })
      ]
    })
  })

  const editor = {
    el,
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => view.state.doc.toString() !== original,
    setValue(text, { markClean = true } = {}) {
      const next = normalizeEol(text)
      if (markClean) original = next
      silent = true
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
      } finally {
        silent = false
      }
      changed()
    },
    setTier(nextTier) {
      currentTier = nextTier
      refresh()
    },
    setReadOnly(flag) {
      view.dispatch({ effects: editable.reconfigure(readOnlyExtensions(flag)) })
    },
    focus: () => view.focus(),
    destroy: () => view.destroy()
  }
  refresh()
  return editor

  function changed() {
    refresh()
    onChange(editor.isDirty(), editor.getValue())
  }

  function refresh() {
    const text = view.state.doc.toString()
    const size = byteLength(text)
    const limit = tierLimit(currentTier)
    const count = view.state.doc.lines
    notice.hidden = text.trim() === '' || parseEnv(text).isEnv
    lines.textContent = `${formatNumber(count)} ${count === 1 ? 'line' : 'lines'}`
    bytes.textContent = `${formatNumber(size)} / ${formatNumber(limit)} bytes (${currentTier})`
    bytes.classList.toggle('is-over', size > limit)
  }
}

function readOnlyExtensions(readOnly) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}
```

`src/renderer/styles/editor.css`:

```css
.env-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--editor-bg);
}
.editor-notice {
  padding: 8px 12px;
  border-bottom: 1px solid var(--tint-yellow-border);
  background: var(--tint-yellow-bg);
  color: var(--tint-yellow-text);
  font-size: 12px;
}
.editor-host {
  flex: 1;
  min-height: 0;
}
.editor-host .cm-editor {
  height: 100%;
}
.editor-status {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: var(--editor-gutter-bg);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}
.editor-status__bytes.is-over {
  color: var(--danger);
  font-weight: 600;
}
.cm-tooltip.cm-tooltip-lint {
  font-family: var(--font-sans);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/renderer/env-language.test.js test/renderer/env-lint.test.js test/renderer/env-editor.test.js`
Expected: PASS. A jsdom warning about missing layout APIs is fine if the tests pass; `test/setup.js` already stubs the `Range` methods CodeMirror needs.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/env-language.js src/renderer/components/env-lint.js src/renderer/components/env-editor.js src/renderer/styles/editor.css test/renderer/env-*.test.js
git commit -m "feat: add CodeMirror .env editor with highlighting, lint warnings, and size status

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Diff and compare views

**Files:**
- Create: `src/renderer/components/diff-view.js`, `src/renderer/styles/diff.css`
- Test: `test/renderer/diff-view.test.js`

**Interfaces:**
- Consumes: `diffEnv`, `compareEnv` result shapes (Task 3); `envSupport` (Task 14); `h`, `icon` (Tasks 12–13).
- Produces: `renderDiff(diff, { masked = true }) → { el, destroy() }`.
  - Key mode renders chips (`+n added`, `~n changed`, `−n removed`), an `n unchanged` note, and rows `tr.diff__row[data-kind][data-key]` with `.diff__value` cells. Masked values show `••••••••`; there are per-row `Reveal <KEY>` buttons and a `.diff__toggle` button that reveals all.
  - Line mode renders a `@codemirror/merge` `MergeView`, hidden behind `[data-action="reveal-lines"]` while masked.
- Produces: `renderCompare(result, { masked = true, labels = ['A', 'B'] }) → { el, destroy() }`. It renders the chips (`n different`, `n only in A`, `n only in B`, `n equal`) and rows (different, then onlyA, then onlyB). Equal rows only appear after `input[name="showEqual"]` is checked.

- [ ] **Step 1: Write the failing test**

`test/renderer/diff-view.test.js`:

```js
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { compareEnv, diffEnv } from '@shared/diff.js'
import { renderCompare, renderDiff } from '../../src/renderer/components/diff-view.js'

const MASK = '••••••••'
const rowsOf = (el) => [...el.querySelectorAll('.diff__row')].map((tr) => [tr.dataset.kind, tr.dataset.key, ...[...tr.querySelectorAll('.diff__value')].map((td) => td.textContent)])
const chips = (el) => [...el.querySelectorAll('.diff-chip')].map((c) => c.textContent)

afterEach(() => document.body.replaceChildren())

describe('renderDiff in key mode', () => {
  const diff = diffEnv('A=1\nB=2\nC=3', 'A=1\nB=20\nD=4')

  it('summarizes and lists changed keys with masked values', () => {
    const { el } = renderDiff(diff, { masked: true })
    expect(chips(el)).toEqual(['+1 added', '~1 changed', '−1 removed'])
    expect(el.querySelector('.diff__unchanged').textContent).toBe('1 unchanged')
    expect(rowsOf(el)).toEqual([
      ['added', 'D', '—', MASK],
      ['changed', 'B', MASK, MASK],
      ['removed', 'C', MASK, '—']
    ])
  })

  it('reveals one row, or every row with the toggle', () => {
    const { el } = renderDiff(diff, { masked: true })
    el.querySelector('[aria-label="Reveal B"]').click()
    expect(rowsOf(el)[1]).toEqual(['changed', 'B', '2', '20'])
    expect(rowsOf(el)[0][3]).toBe(MASK)
    el.querySelector('.diff__toggle').click()
    expect(rowsOf(el)).toEqual([
      ['added', 'D', '—', '4'],
      ['changed', 'B', '2', '20'],
      ['removed', 'C', '3', '—']
    ])
    expect(el.querySelector('.diff__toggle').textContent).toBe('Hide values')
  })

  it('shows values directly when masking is off', () => {
    const { el } = renderDiff(diff, { masked: false })
    expect(el.querySelector('.diff__toggle')).toBeNull()
    expect(rowsOf(el)[0]).toEqual(['added', 'D', '—', '4'])
  })

  it('explains comment-only and empty diffs', () => {
    expect(renderDiff(diffEnv('A=1', '# c\nA=1')).el.querySelector('.diff__empty').textContent).toBe('No variable changes — only comments or formatting changed.')
    expect(renderDiff(diffEnv('A=1', 'A=1')).el.querySelector('.diff__empty').textContent).toBe('No changes.')
  })
})

describe('renderDiff in line mode', () => {
  it('hides the line diff behind Reveal while masked, then mounts a MergeView', () => {
    const view = renderDiff(diffEnv('{"a":1}', '{"a":2}'), { masked: true })
    document.body.append(view.el)
    expect(view.el.querySelector('.cm-mergeView')).toBeNull()
    view.el.querySelector('[data-action="reveal-lines"]').click()
    expect(view.el.querySelector('.cm-mergeView')).not.toBeNull()
    view.destroy()
  })

  it('mounts the MergeView immediately when masking is off', () => {
    const view = renderDiff(diffEnv('{"a":1}', '{"a":2}'), { masked: false })
    document.body.append(view.el)
    expect(view.el.querySelector('.cm-mergeView')).not.toBeNull()
    view.destroy()
  })
})

describe('renderCompare', () => {
  const result = compareEnv('A=1\nB=1\nX=s', 'A=2\nC=3\nX=s')

  it('summarizes the buckets and lists differences first, hiding equal keys', () => {
    const { el } = renderCompare(result, { masked: false, labels: ['prod', 'staging'] })
    expect(chips(el)).toEqual(['1 different', '1 only in A', '1 only in B', '1 equal'])
    expect(rowsOf(el)).toEqual([
      ['different', 'A', '1', '2'],
      ['onlyA', 'B', '1', '—'],
      ['onlyB', 'C', '—', '3']
    ])
    expect([...el.querySelectorAll('th')].map((th) => th.textContent)).toContain('A · prod')
  })

  it('shows equal keys on request', () => {
    const { el } = renderCompare(result, { masked: false })
    const box = el.querySelector('input[name="showEqual"]')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(rowsOf(el).at(-1)).toEqual(['equal', 'X', 's', 's'])
  })

  it('masks compare values until revealed', () => {
    const { el } = renderCompare(result, { masked: true })
    expect(rowsOf(el)[0]).toEqual(['different', 'A', MASK, MASK])
  })

  it('explains when a side is not .env', () => {
    const { el } = renderCompare(compareEnv('A=1', '{"x":1}'), { labels: ['left', 'right'] })
    expect(el.textContent).toContain('right is not in .env format.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/diff-view.test.js`
Expected: FAIL, because `diff-view.js` does not exist.

- [ ] **Step 3: Implement the views**

`src/renderer/components/diff-view.js`:

```js
import '../styles/diff.css'
import { MergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { h } from '../lib/dom.js'
import { envSupport } from './env-language.js'
import { icon } from './icons.js'

const MASK = '••••••••'
const KIND_LABEL = { added: 'Added', changed: 'Changed', removed: 'Removed', different: 'Different', onlyA: 'Only A', onlyB: 'Only B', equal: 'Equal' }

export function renderDiff(diff, { masked = true } = {}) {
  return diff.mode === 'keys' ? renderKeyDiff(diff, masked) : renderLineDiff(diff, masked)
}

export function renderCompare(result, { masked = true, labels = ['A', 'B'] } = {}) {
  if (!result.comparable) {
    const sides = [!result.aIsEnv && labels[0], !result.bIsEnv && labels[1]].filter(Boolean)
    return {
      el: h('div', { class: 'empty-state compare-view' }, h('strong', {}, 'These values cannot be compared key by key'), h('span', { class: 'muted' }, `${sides.join(' and ')} ${sides.length > 1 ? 'are' : 'is'} not in .env format.`)),
      destroy() {}
    }
  }

  let showEqual = false
  const rowsFor = () => ['different', 'onlyA', 'onlyB', ...(showEqual ? ['equal'] : [])].flatMap((kind) => result[kind].map((row) => ({ ...row, kind })))
  const table = maskedTable({ rows: rowsFor(), masked, headers: [`A · ${labels[0]}`, `B · ${labels[1]}`], valuesOf: (row) => [row.a, row.b] })
  const equalToggle = h(
    'label',
    { class: 'checkbox checkbox--inline' },
    h('input', {
      type: 'checkbox',
      name: 'showEqual',
      onChange: (event) => {
        showEqual = event.target.checked
        table.setRows(rowsFor())
      }
    }),
    h('span', {}, `Show ${result.equal.length} equal`)
  )
  const identical = result.different.length + result.onlyA.length + result.onlyB.length === 0
  const el = h(
    'div',
    { class: 'diff compare-view' },
    h('div', { class: 'diff__summary' }, chip('different', `${result.different.length} different`), chip('onlyA', `${result.onlyA.length} only in A`), chip('onlyB', `${result.onlyB.length} only in B`), chip('equal', `${result.equal.length} equal`), h('span', { class: 'spacer' }), equalToggle, table.toggle),
    identical ? h('p', { class: 'diff__empty' }, 'Both parameters define the same variables with the same values.') : null,
    table.el
  )
  return { el, destroy() {} }
}

function renderKeyDiff(diff, masked) {
  const rows = [
    ...diff.added.map((r) => ({ kind: 'added', key: r.key, before: null, after: r.value })),
    ...diff.changed.map((r) => ({ kind: 'changed', key: r.key, before: r.oldValue, after: r.newValue })),
    ...diff.removed.map((r) => ({ kind: 'removed', key: r.key, before: r.value, after: null }))
  ]
  const summary = h('div', { class: 'diff__summary' }, chip('added', `+${diff.added.length} added`), chip('changed', `~${diff.changed.length} changed`), chip('removed', `−${diff.removed.length} removed`), h('span', { class: 'diff__unchanged' }, `${diff.unchanged} unchanged`))
  if (rows.length === 0) {
    const message = diff.textChanged ? 'No variable changes — only comments or formatting changed.' : 'No changes.'
    return { el: h('div', { class: 'diff' }, summary, h('p', { class: 'diff__empty' }, message)), destroy() {} }
  }
  const table = maskedTable({ rows, masked, headers: ['Before', 'After'], valuesOf: (row) => [row.before, row.after] })
  if (table.toggle) summary.append(h('span', { class: 'spacer' }), table.toggle)
  return { el: h('div', { class: 'diff' }, summary, table.el), destroy() {} }
}

function renderLineDiff(diff, masked) {
  const note = h('p', { class: 'diff__note' }, 'One of the values is not in .env format, so the change is shown line by line.')
  const el = h('div', { class: 'diff diff--lines' }, note)
  let merge = null
  const mount = () => {
    const host = h('div', { class: 'diff__merge' })
    el.replaceChildren(note, host)
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), envSupport()]
    merge = new MergeView({ a: { doc: diff.oldText ?? '', extensions }, b: { doc: diff.newText ?? '', extensions }, parent: host, highlightChanges: true, gutter: true })
  }
  if (masked) {
    el.append(h('div', { class: 'diff__masked' }, icon('eyeOff', 20), h('span', {}, 'Values are hidden.'), h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'reveal-lines' }, onClick: mount }, icon('eye', 14), 'Reveal')))
  } else {
    mount()
  }
  return { el, destroy: () => merge?.destroy() }
}

// A key/value table whose values can be masked, revealed per row, or revealed all at once.
function maskedTable({ rows, masked, headers, valuesOf }) {
  let current = rows
  let revealAll = !masked
  const revealed = new Set()
  const tbody = h('tbody')
  const toggle = masked
    ? h('button', {
        class: 'btn btn--default btn--sm diff__toggle',
        type: 'button',
        onClick: () => {
          revealAll = !revealAll
          draw()
        }
      })
    : null
  const el = h('table', { class: 'diff__table' }, h('thead', {}, h('tr', {}, h('th', { class: 'diff__kind-col' }), h('th', {}, 'Key'), headers.map((label) => h('th', { title: label }, label)), masked ? h('th', { class: 'diff__eye-col' }) : null)), tbody)
  draw()
  return {
    el,
    toggle,
    setRows(next) {
      current = next
      draw()
    }
  }

  function draw() {
    toggle?.replaceChildren(icon(revealAll ? 'eyeOff' : 'eye', 14), revealAll ? 'Hide values' : 'Reveal values')
    tbody.replaceChildren(
      ...current.map((row) => {
        const show = revealAll || revealed.has(row.key)
        const flip = () => {
          if (show) revealed.delete(row.key)
          else revealed.add(row.key)
          draw()
        }
        return h(
          'tr',
          { class: ['diff__row', `diff__row--${row.kind}`], dataset: { key: row.key, kind: row.kind } },
          h('td', {}, h('span', { class: ['diff-kind', `diff-kind--${row.kind}`] }, KIND_LABEL[row.kind])),
          h('td', { class: 'mono diff__key' }, row.key),
          valuesOf(row).map((value) => h('td', { class: 'mono diff__value' }, value === null ? h('span', { class: 'muted' }, '—') : show ? value : MASK)),
          masked ? h('td', {}, revealAll ? null : h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `${show ? 'Hide' : 'Reveal'} ${row.key}`, onClick: flip }, icon(show ? 'eyeOff' : 'eye', 14))) : null
        )
      })
    )
  }
}

function chip(kind, text) {
  return h('span', { class: ['diff-chip', `diff-chip--${kind}`] }, text)
}
```

`src/renderer/styles/diff.css`:

```css
.diff {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.diff__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.diff-chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.diff-chip--added,
.diff-chip--onlyB {
  background: var(--diff-added-bg);
  color: var(--diff-added-text);
}
.diff-chip--changed,
.diff-chip--different {
  background: var(--diff-changed-bg);
  color: var(--diff-changed-text);
}
.diff-chip--removed,
.diff-chip--onlyA {
  background: var(--diff-removed-bg);
  color: var(--diff-removed-text);
}
.diff-chip--equal {
  background: var(--bg-muted);
  color: var(--text-muted);
}
.diff__unchanged,
.diff__empty,
.diff__note {
  color: var(--text-muted);
}
.diff__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.diff__table th {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff__table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-all;
}
.diff__kind-col {
  width: 96px;
}
.diff__eye-col {
  width: 44px;
}
.diff__key {
  font-weight: 600;
}
.diff-kind {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.diff-kind--added,
.diff-kind--onlyB {
  color: var(--diff-added-text);
}
.diff-kind--changed,
.diff-kind--different {
  color: var(--diff-changed-text);
}
.diff-kind--removed,
.diff-kind--onlyA {
  color: var(--diff-removed-text);
}
.diff-kind--equal {
  color: var(--text-muted);
}
.diff__masked {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  color: var(--text-muted);
}
.diff__merge {
  max-height: 50vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/diff-view.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/diff-view.js src/renderer/styles/diff.css test/renderer/diff-view.test.js
git commit -m "feat: add masked key-level diff, line diff, and compare views

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 16: Version history panel

**Files:**
- Create: `src/renderer/views/history-panel.js`, `src/renderer/styles/parameter.css`
- Test: `test/renderer/history-panel.test.js`

**Interfaces:**
- Consumes: `diffEnv` (Task 3); `formatDate` (Task 4); `h`, `icon`, `toastError` (Tasks 12–13); `renderDiff` (Task 15).
- Produces: `createHistoryPanel({ api, connection, name, canRestore, getSettings, getCurrent, onRestore })` → `{ el, reload(), destroy() }`.
  - `getCurrent()` returns the tab's current `{ version, value }`, where `value` is `null` while still encrypted.
  - History is fetched with `decrypt: true` only when the current value is visible.
  - The default selection is the version before the current one.
  - The **Restore this version** button (`[data-action="restore"]`) calls `onRestore(entry)`.
- Produces: `parameter.css`, which holds the styles for the parameter tab and the history panel (Task 17 uses the same file).

- [ ] **Step 1: Write the failing test**

`test/renderer/history-panel.test.js`:

```js
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHistoryPanel } from '../../src/renderer/views/history-panel.js'

const entry = (version, value, labels = []) => ({ version, value, type: 'String', tier: 'Standard', keyId: null, description: '', lastModifiedDate: `2026-09-0${version}T00:00:00.000Z`, lastModifiedUser: 'arn:aws:iam::1:user/leo', labels })
const entries = [entry(3, 'A=3'), entry(2, 'A=2\nB=1', ['stable']), entry(1, 'A=1')]

function mount({ current = { version: 3, value: 'A=3' }, canRestore = true, history = vi.fn(async () => entries) } = {}) {
  const api = { ssm: { history } }
  const onRestore = vi.fn()
  const panel = createHistoryPanel({ api, connection: { id: 'c1' }, name: '/a', canRestore, getSettings: () => ({ maskValuesInDiff: false }), getCurrent: () => current, onRestore })
  document.body.append(panel.el)
  return { api, panel, onRestore }
}
const items = (panel) => [...panel.el.querySelectorAll('.history__item')]

afterEach(() => document.body.replaceChildren())

describe('createHistoryPanel', () => {
  it('loads decrypted history, marks the current version, and preselects the previous one', async () => {
    const { api, panel } = mount()
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(api.ssm.history).toHaveBeenCalledWith('c1', '/a', { decrypt: true })
    expect(items(panel)[0].textContent).toContain('Current')
    expect(items(panel)[1].classList.contains('is-selected')).toBe(true)
    expect(items(panel)[1].textContent).toContain('stable')
    expect(panel.el.querySelector('.history__detail h3').textContent).toBe('Changes from version 2 to the current version (3)')
    expect([...panel.el.querySelectorAll('.diff__row')].map((r) => r.dataset.key)).toEqual(['A', 'B'])
  })

  it('restores the selected version through onRestore', async () => {
    const { panel, onRestore } = mount()
    await vi.waitFor(() => expect(panel.el.querySelector('[data-action="restore"]')).not.toBeNull())
    panel.el.querySelector('[data-action="restore"]').click()
    expect(onRestore).toHaveBeenCalledWith(entries[1])
  })

  it('hides restore on read-only connections', async () => {
    const { panel } = mount({ canRestore: false })
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(panel.el.querySelector('[data-action="restore"]')).toBeNull()
  })

  it('explains when the current version is selected', async () => {
    const { panel } = mount()
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    items(panel)[0].click()
    expect(panel.el.querySelector('.history__detail').textContent).toContain('Version 3 is the current version.')
  })

  it('asks to decrypt first while the value is encrypted', async () => {
    const history = vi.fn(async () => entries.map((e) => ({ ...e, value: null })))
    const { panel } = mount({ current: { version: 3, value: null }, history })
    await vi.waitFor(() => expect(items(panel)).toHaveLength(3))
    expect(history).toHaveBeenCalledWith('c1', '/a', { decrypt: false })
    expect(panel.el.querySelector('.history__detail').textContent).toContain('Values are encrypted')
  })

  it('shows load errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { panel } = mount({ history: vi.fn(async () => Promise.reject(Object.assign(new Error('Not allowed to read the history of /a.'), { code: 'AccessDenied' }))) })
    await vi.waitFor(() => expect(panel.el.querySelector('.history__list').textContent).toContain('Not allowed to read the history of /a.'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/history-panel.test.js`
Expected: FAIL, because `history-panel.js` does not exist.

- [ ] **Step 3: Implement the panel and the parameter styles**

`src/renderer/views/history-panel.js`:

```js
import { diffEnv } from '@shared/diff.js'
import { formatDate } from '@shared/format.js'
import { h } from '../lib/dom.js'
import { renderDiff } from '../components/diff-view.js'
import { icon } from '../components/icons.js'
import { toastError } from '../components/toast.js'

export function createHistoryPanel({ api, connection, name, canRestore, getSettings, getCurrent, onRestore }) {
  let entries = []
  let selected = null
  let diffView = null
  const list = h('ol', { class: 'history__list', 'aria-label': 'Versions' })
  const detail = h('div', { class: 'history__detail' })
  const el = h('div', { class: 'history' }, list, detail)
  reload()
  return {
    el,
    reload,
    destroy: () => diffView?.destroy()
  }

  async function reload() {
    list.replaceChildren(h('li', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading history…'))
    detail.replaceChildren()
    try {
      const value = getCurrent()?.value
      entries = await api.ssm.history(connection.id, name, { decrypt: value !== null && value !== undefined })
      selected = entries.find((e) => e.version === selected?.version) ?? entries[1] ?? entries[0] ?? null
      drawList()
      drawDetail()
    } catch (err) {
      list.replaceChildren(h('li', { class: 'empty-state empty-state--error' }, err.message))
      toastError(err, 'Could not load history')
    }
  }

  function drawList() {
    const currentVersion = getCurrent()?.version
    list.replaceChildren(
      ...entries.map((entry) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: ['history__item', entry.version === selected?.version && 'is-selected'],
              type: 'button',
              dataset: { version: String(entry.version) },
              onClick: () => {
                selected = entry
                drawList()
                drawDetail()
              }
            },
            h('span', { class: 'history__version' }, `Version ${entry.version}`, entry.version === currentVersion ? h('span', { class: 'badge badge--current' }, 'Current') : null),
            h('span', { class: 'history__meta' }, formatDate(entry.lastModifiedDate)),
            h('span', { class: 'history__meta mono', title: entry.lastModifiedUser ?? '' }, shortUser(entry.lastModifiedUser)),
            entry.labels.length ? h('span', { class: 'history__labels' }, entry.labels.map((label) => h('span', { class: 'tag' }, label))) : null
          )
        )
      )
    )
  }

  function drawDetail() {
    diffView?.destroy()
    diffView = null
    const current = getCurrent()
    if (!selected) {
      detail.replaceChildren(h('p', { class: 'muted' }, 'This parameter has no history.'))
      return
    }
    if (selected.version === current?.version) {
      detail.replaceChildren(h('div', { class: 'empty-state' }, h('strong', {}, `Version ${selected.version} is the current version.`), h('span', { class: 'muted' }, 'Pick an older version to see what changed since then.')))
      return
    }
    if (selected.value === null || current?.value === null || current?.value === undefined) {
      detail.replaceChildren(h('div', { class: 'empty-state' }, icon('lock', 20), h('strong', {}, 'Values are encrypted'), h('span', { class: 'muted' }, 'Decrypt the value in the Value tab to compare versions.')))
      return
    }
    diffView = renderDiff(diffEnv(selected.value, current.value), { masked: getSettings().maskValuesInDiff })
    const restore = canRestore ? h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'restore' }, onClick: () => onRestore(selected) }, icon('history', 14), 'Restore this version') : null
    detail.replaceChildren(h('div', { class: 'history__detail-header' }, h('h3', {}, `Changes from version ${selected.version} to the current version (${current.version})`), restore), diffView.el)
  }
}

function shortUser(arn) {
  return arn ? arn.split(/[/:]/).pop() : '—'
}
```

`src/renderer/styles/parameter.css`:

```css
.param {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.param__header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.param__title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.param__title h2 {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.param__badges,
.param__actions {
  display: flex;
  gap: 8px;
}
.param__version {
  font-size: 12px;
  white-space: nowrap;
}
.param__dirty {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--tint-yellow-bg);
  color: var(--tint-yellow-text);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.overview {
  margin: 16px 20px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-subtle);
}
.overview > summary {
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
}
.overview__grid {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content minmax(0, 1fr);
  gap: 8px 20px;
  margin: 0;
  padding: 4px 16px 16px;
}
.overview__grid dt {
  color: var(--text-muted);
  font-size: 12px;
}
.overview__grid dd {
  min-width: 0;
  margin: 0;
}
.subtabs {
  display: flex;
  gap: 4px;
  margin: 16px 20px 0;
  border-bottom: 1px solid var(--border);
}
.subtab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent;
}
.subtab.is-active {
  color: var(--tint-green-text);
  box-shadow: inset 0 -2px 0 var(--green-dark1);
}
.param__panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 360px;
  padding: 16px 20px 20px;
}
.param__panel > .env-editor {
  flex: 1;
  min-height: 320px;
}
.encrypted {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-muted);
}
.encrypted strong {
  color: var(--text);
  font-size: 15px;
}
.save-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* History */
.history {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  min-height: 320px;
}
.history__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 12px 0 0;
  border-right: 1px solid var(--border);
  list-style: none;
}
.history__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.history__item:hover {
  background: var(--bg-subtle);
}
.history__item.is-selected {
  border-color: var(--tint-green-border);
  background: var(--tint-green-bg);
}
.history__version {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.history__meta {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history__labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.history__detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.history__detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/history-panel.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/history-panel.js src/renderer/styles/parameter.css test/renderer/history-panel.test.js
git commit -m "feat: add version history panel with diff against the current value

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Parameter tab — overview, editor, save, revert, and delete

**Files:**
- Create: `src/renderer/lib/save-plan.js`, `src/renderer/views/parameter.js`
- Test: `test/renderer/save-plan.test.js`, `test/renderer/parameter.test.js`

**Interfaces:**
- Consumes: `normalizeEol` (Task 2); `diffEnv` (Task 3); `TIER_LIMITS`, `byteLength`, `formatDate`, `formatNumber`, `formatCount` (Task 4); `h` (Task 12); `icon`, badges, `toast`/`toastError`, `openModal`, `choiceDialog`, `confirmDialog`, `typeToConfirm` (Task 13); `createEnvEditor` (Task 14); `renderDiff` (Task 15); `createHistoryPanel` (Task 16).
- Produces from `save-plan.js`: `planSave({ original, text, tier })` → `{ blocked: true, reason }` or `{ blocked: false, bytes, needsUpgrade }`.
- Produces from `parameter.js`: `createParameterTab({ api, connection, meta, getSettings, onChanged?(event), onDirtyChange?(dirty) })` → `{ el, isDirty(), focus(), destroy() }`.
  - `event` is `{ type: 'saved', name, version }`, `{ type: 'deleted', name }`, or `{ type: 'missing', name }`.
  - Buttons carry `data-action` values `save`, `revert`, `delete`, and `decrypt`.
  - Sub-tab buttons carry `data-subtab` values `value` and `history`.

- [ ] **Step 1: Write the failing tests**

`test/renderer/save-plan.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { planSave } from '../../src/renderer/lib/save-plan.js'

describe('planSave', () => {
  it('blocks saving a value that was never decrypted', () => {
    expect(planSave({ original: null, text: 'A=1', tier: 'Standard' })).toEqual({ blocked: true, reason: 'Decrypt the value before saving changes.' })
  })

  it('blocks an empty value', () => {
    expect(planSave({ original: 'A=1', text: '', tier: 'Standard' }).reason).toBe('The value cannot be empty. Parameter Store requires at least one character.')
  })

  it('blocks when nothing changed, ignoring line endings', () => {
    expect(planSave({ original: 'A=1\r\nB=2', text: 'A=1\nB=2', tier: 'Standard' }).reason).toBe('There are no changes to save.')
  })

  it('blocks values over the Advanced limit', () => {
    expect(planSave({ original: 'A=1', text: 'x'.repeat(8193), tier: 'Advanced' }).reason).toBe('The value is 8,193 bytes. The maximum, even on the Advanced tier, is 8,192 bytes.')
  })

  it('asks for a tier upgrade between 4 KB and 8 KB on Standard only', () => {
    expect(planSave({ original: 'A=1', text: 'x'.repeat(5000), tier: 'Standard' })).toEqual({ blocked: false, bytes: 5000, needsUpgrade: true })
    expect(planSave({ original: 'A=1', text: 'x'.repeat(5000), tier: 'Advanced' }).needsUpgrade).toBe(false)
  })

  it('allows a normal save', () => {
    expect(planSave({ original: 'A=1', text: 'A=2', tier: 'Standard' })).toEqual({ blocked: false, bytes: 3, needsUpgrade: false })
  })
})
```

`test/renderer/parameter.test.js`:

```js
// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { createParameterTab } from '../../src/renderer/views/parameter.js'

const NAME = '/myapp/prod/env'
const ARN = 'arn:aws:ssm:sa-east-1:1:parameter/myapp/prod/env'
const meta = { name: NAME, type: 'SecureString', tier: 'Standard', dataType: 'text', version: 3, lastModifiedDate: '2026-09-03T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: 'Prod env', keyId: 'alias/aws/ssm', allowedPattern: null }
const historyEntry = (version, value) => ({ version, value, type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: '', lastModifiedDate: '2026-09-03T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', labels: [] })

// A tiny stateful backend: put bumps the version, get returns the latest value.
function backend(overrides = {}) {
  const stored = { value: 'A=1\nB=2', version: 3 }
  return {
    get: vi.fn(async (_c, _name, { decrypt }) => ({ name: NAME, type: 'SecureString', value: decrypt ? stored.value : null, version: stored.version, lastModifiedDate: '2026-09-03T00:00:00.000Z', dataType: 'text', arn: ARN })),
    tags: vi.fn(async () => [{ key: 'team', value: 'platform' }]),
    put: vi.fn(async (_c, input) => {
      stored.value = input.value
      stored.version += 1
      return { version: stored.version, tier: input.tier }
    }),
    delete: vi.fn(async () => ({ deleted: true })),
    history: vi.fn(async () => [historyEntry(3, 'A=1\nB=2'), historyEntry(2, 'A=0')]),
    ...overrides
  }
}

function setup({ readOnly = false, autoDecrypt = true, ...overrides } = {}) {
  const api = { ssm: backend(overrides) }
  const onChanged = vi.fn()
  const onDirtyChange = vi.fn()
  const tab = createParameterTab({ api, connection: { id: 'c1', name: 'Prod', readOnly }, meta, getSettings: () => ({ autoDecrypt, maskValuesInDiff: false }), onChanged, onDirtyChange })
  document.body.append(tab.el)
  tabs.push(tab)
  return { api, tab, onChanged, onDirtyChange }
}

const tabs = []
const view = (tab) => EditorView.findFromDOM(tab.el.querySelector('.cm-editor'))
const setText = (tab, text) => view(tab).dispatch({ changes: { from: 0, to: view(tab).state.doc.length, insert: text } })
const ready = (tab) => vi.waitFor(() => expect(tab.el.querySelector('.cm-editor')).not.toBeNull())
const modal = () => document.querySelector('.modal')
const inModal = (action) => document.querySelector(`.modal [data-action="${action}"]`)
const ctrlS = (tab) => view(tab).contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true, bubbles: true, cancelable: true }))

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})
afterEach(() => tabs.splice(0).forEach((t) => t.destroy()))

describe('loading', () => {
  it('loads the decrypted value, tags, and overview', async () => {
    const { api, tab } = setup()
    await ready(tab)
    expect(api.ssm.get).toHaveBeenCalledWith('c1', NAME, { decrypt: true })
    expect(view(tab).state.doc.toString()).toBe('A=1\nB=2')
    expect(tab.el.querySelector('.overview').textContent).toContain(ARN)
    expect(tab.el.querySelector('.overview').textContent).toContain('team = platform')
    expect(tab.el.querySelector('.param__version').textContent).toBe('Version 3')
    expect(tab.isDirty()).toBe(false)
  })

  it('keeps an encrypted value hidden until "Decrypt & show"', async () => {
    const { api, tab } = setup({ autoDecrypt: false })
    await vi.waitFor(() => expect(tab.el.querySelector('[data-action="decrypt"]')).not.toBeNull())
    expect(tab.el.querySelector('.cm-editor')).toBeNull()
    expect(tab.el.querySelector('[data-action="save"]').disabled).toBe(true)
    tab.el.querySelector('[data-action="decrypt"]').click()
    await ready(tab)
    expect(api.ssm.get).toHaveBeenLastCalledWith('c1', NAME, { decrypt: true })
  })

  it('gives read-only connections no write actions and a read-only editor', async () => {
    const { tab } = setup({ readOnly: true })
    await ready(tab)
    expect(tab.el.querySelector('[data-action="save"]')).toBeNull()
    expect(tab.el.querySelector('[data-action="delete"]')).toBeNull()
    expect(view(tab).state.readOnly).toBe(true)
  })

  it('still loads when reading tags is not allowed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tags = vi.fn(async () => Promise.reject(Object.assign(new Error('Not allowed to read the tags of /myapp/prod/env.'), { code: 'AccessDenied' })))
    const { tab } = setup({ tags })
    await ready(tab)
    expect(document.querySelector('.toast--error').textContent).toContain('Could not load tags')
  })
})

describe('saving', () => {
  it('saves through the diff dialog with the loaded version and the metadata', async () => {
    const { api, tab, onChanged, onDirtyChange } = setup()
    await ready(tab)
    setText(tab, 'A=1\nB=3')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(modal()).not.toBeNull())
    expect([...modal().querySelectorAll('.diff__row')].map((r) => r.dataset.key)).toEqual(['B'])
    inModal('confirm').click()
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith({ type: 'saved', name: NAME, version: 4 }))
    expect(api.ssm.put).toHaveBeenCalledWith('c1', { name: NAME, value: 'A=1\nB=3', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: 'Prod env', dataType: 'text', allowedPattern: null, overwrite: true, expectedVersion: 3 })
    expect(tab.el.querySelector('.param__version').textContent).toBe('Version 4')
    expect(tab.isDirty()).toBe(false)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('opens one dialog and writes once, however often save is triggered', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, 'A=1\nB=3')
    ctrlS(tab)
    ctrlS(tab)
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(modal()).not.toBeNull())
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    inModal('confirm').click()
    await vi.waitFor(() => expect(tab.el.querySelector('.param__version').textContent).toBe('Version 4'))
    expect(api.ssm.put).toHaveBeenCalledTimes(1)
  })

  it('blocks an empty value before any dialog or AWS call', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, '')
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(document.querySelector('.toast').textContent).toContain('cannot be empty'))
    expect(modal()).toBeNull()
    expect(api.ssm.put).not.toHaveBeenCalled()
  })

  it('offers to overwrite after a version conflict', async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error(`${NAME} changed since you opened it: it is now at version 4, and you loaded version 3.`), { code: 'VersionConflict' }))
      .mockResolvedValueOnce({ version: 5, tier: 'Standard' })
    const { tab } = setup({ put })
    await ready(tab)
    setText(tab, 'A=9')
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(inModal('confirm')).not.toBeNull())
    inModal('confirm').click()
    await vi.waitFor(() => expect(inModal('overwrite')).not.toBeNull())
    inModal('overwrite').click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls[0][1].expectedVersion).toBe(3)
    expect(put.mock.calls[1][1]).not.toHaveProperty('expectedVersion')
  })

  it('requires an explicit tier upgrade for values over 4 KB on Standard', async () => {
    const { api, tab } = setup()
    await ready(tab)
    setText(tab, 'x'.repeat(5000))
    tab.el.querySelector('[data-action="save"]').click()
    await vi.waitFor(() => expect(inModal('confirm')).not.toBeNull())
    expect(inModal('confirm').disabled).toBe(true)
    const box = modal().querySelector('input[name="upgrade"]')
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(inModal('confirm').disabled).toBe(false)
    inModal('confirm').click()
    await vi.waitFor(() => expect(api.ssm.put).toHaveBeenCalled())
    expect(api.ssm.put.mock.calls[0][1].tier).toBe('Advanced')
  })
})

describe('delete and restore', () => {
  it('deletes after typing the full name', async () => {
    const { api, tab, onChanged } = setup()
    await ready(tab)
    tab.el.querySelector('[data-action="delete"]').click()
    const input = await vi.waitFor(() => {
      const el = document.querySelector('.modal input')
      expect(el).not.toBeNull()
      return el
    })
    input.value = NAME
    input.dispatchEvent(new Event('input'))
    inModal('confirm').click()
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith({ type: 'deleted', name: NAME }))
    expect(api.ssm.delete).toHaveBeenCalledWith('c1', NAME)
  })

  it('restores an old version into the editor as unsaved changes', async () => {
    const { tab } = setup()
    await ready(tab)
    tab.el.querySelector('[data-subtab="history"]').click()
    await vi.waitFor(() => expect(tab.el.querySelector('[data-action="restore"]')).not.toBeNull())
    tab.el.querySelector('[data-action="restore"]').click()
    expect(view(tab).state.doc.toString()).toBe('A=0')
    expect(tab.isDirty()).toBe(true)
    expect(tab.el.querySelector('[data-subtab="value"]').classList.contains('is-active')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/renderer/save-plan.test.js test/renderer/parameter.test.js`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the save plan**

`src/renderer/lib/save-plan.js`:

```js
import { normalizeEol } from '@shared/env.js'
import { formatNumber } from '@shared/format.js'
import { TIER_LIMITS, byteLength } from '@shared/names.js'

// Decides, before any dialog or AWS call, whether the editor text can be saved.
export function planSave({ original, text, tier }) {
  if (original === null || original === undefined) return { blocked: true, reason: 'Decrypt the value before saving changes.' }
  if (text.length === 0) return { blocked: true, reason: 'The value cannot be empty. Parameter Store requires at least one character.' }
  if (normalizeEol(text) === normalizeEol(original)) return { blocked: true, reason: 'There are no changes to save.' }
  const bytes = byteLength(text)
  if (bytes > TIER_LIMITS.Advanced) {
    return { blocked: true, reason: `The value is ${formatNumber(bytes)} bytes. The maximum, even on the Advanced tier, is ${formatNumber(TIER_LIMITS.Advanced)} bytes.` }
  }
  return { blocked: false, bytes, needsUpgrade: tier !== 'Advanced' && bytes > TIER_LIMITS.Standard }
}
```

- [ ] **Step 4: Implement the parameter tab**

`src/renderer/views/parameter.js`:

```js
import '../styles/parameter.css'
import { diffEnv } from '@shared/diff.js'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'
import { h } from '../lib/dom.js'
import { planSave } from '../lib/save-plan.js'
import { tierBadge, typeBadge } from '../components/badges.js'
import { renderDiff } from '../components/diff-view.js'
import { createEnvEditor } from '../components/env-editor.js'
import { icon } from '../components/icons.js'
import { choiceDialog, confirmDialog, openModal, typeToConfirm } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'
import { createHistoryPanel } from './history-panel.js'

export function createParameterTab({ api, connection, meta: initialMeta, getSettings, onChanged = () => {}, onDirtyChange = () => {} }) {
  const canWrite = !connection.readOnly
  let meta = { ...initialMeta }
  let current = null // the last value read from AWS: { value (null while encrypted), version, arn, … }
  let tags = []
  let editor = null
  let history = null
  let saving = false
  let wasDirty = false
  let destroyed = false

  const badges = h('span', { class: 'param__badges' })
  const version = h('span', { class: 'param__version muted' })
  const dirtyFlag = h('span', { class: 'param__dirty', hidden: true }, 'Unsaved changes')
  const saveButton = h('button', { class: 'btn btn--primary', type: 'button', disabled: true, dataset: { action: 'save' }, onClick: () => save() }, icon('save', 14), 'Save')
  const revertButton = h('button', { class: 'btn btn--default', type: 'button', disabled: true, dataset: { action: 'revert' }, onClick: () => revert() }, icon('undo', 14), 'Revert')
  const deleteButton = h('button', { class: 'btn btn--ghost-danger', type: 'button', dataset: { action: 'delete' }, onClick: () => remove() }, icon('trash', 14), 'Delete')
  const overview = h('dl', { class: 'overview__grid' })
  const valuePanel = h('div', { class: 'param__panel', role: 'tabpanel' }, loading('Loading value…'))
  const historyPanel = h('div', { class: 'param__panel', role: 'tabpanel', hidden: true })
  const subtabs = { value: subtab('value', 'Value', 'file'), history: subtab('history', 'History', 'history') }

  const el = h(
    'section',
    { class: 'param' },
    h(
      'header',
      { class: 'param__header' },
      h('div', { class: 'param__title' }, h('h2', { class: 'mono', title: meta.name }, meta.name), badges, version, dirtyFlag),
      canWrite ? h('div', { class: 'param__actions' }, revertButton, saveButton, deleteButton) : h('span', { class: 'muted' }, 'Read-only connection')
    ),
    h('details', { class: 'overview', open: true }, h('summary', {}, 'Overview'), overview),
    h('nav', { class: 'subtabs', role: 'tablist' }, subtabs.value, subtabs.history),
    valuePanel,
    historyPanel
  )

  renderHeader()
  renderOverview()
  load()

  return {
    el,
    isDirty: () => Boolean(editor?.isDirty()),
    focus: () => editor?.focus(),
    destroy() {
      destroyed = true
      editor?.destroy()
      history?.destroy()
    }
  }

  async function load() {
    const decrypt = meta.type !== 'SecureString' || getSettings().autoDecrypt
    try {
      const [value, tagList] = await Promise.all([
        api.ssm.get(connection.id, meta.name, { decrypt }),
        api.ssm.tags(connection.id, meta.name).catch((err) => {
          toastError(err, 'Could not load tags')
          return []
        })
      ])
      if (destroyed) return
      current = value
      tags = tagList
      meta = { ...meta, version: value.version, lastModifiedDate: value.lastModifiedDate }
      renderHeader()
      renderOverview()
      renderValue()
    } catch (err) {
      if (!destroyed) showLoadError(err)
    }
  }

  function renderValue() {
    if (current.value === null) {
      valuePanel.replaceChildren(
        h(
          'div',
          { class: 'encrypted' },
          icon('lock', 28),
          h('strong', {}, 'Encrypted value'),
          h('p', {}, 'This SecureString is not decrypted yet, because auto-decrypt is off in Settings.'),
          h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'decrypt' }, onClick: () => decrypt() }, icon('eye', 14), 'Decrypt & show')
        )
      )
      return
    }
    if (editor) {
      editor.setValue(current.value)
      editor.setTier(meta.tier)
      return
    }
    editor = createEnvEditor({ value: current.value, tier: meta.tier, readOnly: !canWrite, onChange: (dirty) => setDirty(dirty), onSave: () => save() })
    valuePanel.replaceChildren(editor.el)
  }

  async function decrypt() {
    try {
      current = await api.ssm.get(connection.id, meta.name, { decrypt: true })
      renderValue()
      history?.reload()
    } catch (err) {
      handleError(err, 'Could not decrypt the value')
    }
  }

  function setDirty(dirty) {
    saveButton.disabled = !dirty || saving
    revertButton.disabled = !dirty
    dirtyFlag.hidden = !dirty
    if (dirty !== wasDirty) {
      wasDirty = dirty
      onDirtyChange(dirty)
    }
  }

  async function save() {
    if (!canWrite || !editor || saving) return
    const text = editor.getValue()
    const plan = planSave({ original: current?.value ?? null, text, tier: meta.tier })
    if (plan.blocked) {
      toast({ kind: 'info', message: plan.reason })
      return
    }
    saving = true
    saveButton.disabled = true
    try {
      const choice = await confirmSave(diffEnv(current.value, text), plan)
      if (!choice) return
      const result = await putWithConflictHandling(text, choice.upgrade ? 'Advanced' : meta.tier)
      if (!result) return
      meta = { ...meta, tier: result.tier, version: result.version }
      await reloadValue()
      toast({ kind: 'success', message: `Saved ${meta.name} as version ${result.version}.` })
      onChanged({ type: 'saved', name: meta.name, version: result.version })
    } catch (err) {
      handleError(err, 'Save failed')
    } finally {
      saving = false
      saveButton.disabled = !editor?.isDirty()
    }
  }

  function confirmSave(diff, plan) {
    return new Promise((resolve) => {
      const view = renderDiff(diff, { masked: getSettings().maskValuesInDiff })
      const upgrade = plan.needsUpgrade ? h('input', { type: 'checkbox', name: 'upgrade' }) : null
      const modal = openModal({
        title: `Save ${meta.name}?`,
        size: 'lg',
        body: h(
          'div',
          { class: 'save-dialog' },
          h('p', { class: 'muted' }, `Saving creates version ${current.version + 1} in ${connection.name}.`),
          view.el,
          upgrade
            ? h('label', { class: 'checkbox callout callout--warning' }, upgrade, h('span', {}, h('strong', {}, 'Upgrade to the Advanced tier (charges apply)'), `The value is ${formatNumber(plan.bytes)} bytes, over the 4,096-byte Standard limit. Advanced parameters cannot be downgraded later.`))
            : null
        ),
        onClose: (result) => {
          view.destroy()
          resolve(result ?? null)
        },
        actions: [
          { id: 'cancel', label: 'Cancel', onClick: (m) => m.close(null) },
          { id: 'confirm', label: 'Save new version', kind: 'primary', disabled: Boolean(upgrade), onClick: (m) => m.close({ upgrade: Boolean(upgrade?.checked) }) }
        ]
      })
      upgrade?.addEventListener('change', () => {
        modal.button('confirm').disabled = !upgrade.checked
      })
    })
  }

  async function putWithConflictHandling(text, tier) {
    const input = { name: meta.name, value: text, type: meta.type, tier, keyId: meta.keyId, description: meta.description, dataType: meta.dataType, allowedPattern: meta.allowedPattern, overwrite: true }
    try {
      return await api.ssm.put(connection.id, { ...input, expectedVersion: current.version })
    } catch (err) {
      if (err?.code !== 'VersionConflict') throw err
      const choice = await choiceDialog({
        title: 'This parameter changed',
        message: h('div', {}, h('p', {}, err.message), h('p', { class: 'muted' }, 'Reload discards your edits and loads the latest version. Overwrite replaces it with yours.')),
        choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'reload', label: 'Reload latest' }, { id: 'overwrite', label: 'Overwrite anyway', kind: 'danger' }]
      })
      if (choice === 'reload') {
        await reloadValue()
        toast({ kind: 'info', message: `Loaded version ${current.version}. Your edits were discarded.` })
        return null
      }
      if (choice !== 'overwrite') return null
      return api.ssm.put(connection.id, input)
    }
  }

  async function reloadValue() {
    current = await api.ssm.get(connection.id, meta.name, { decrypt: true })
    meta = { ...meta, version: current.version, lastModifiedDate: current.lastModifiedDate }
    editor?.setValue(current.value)
    editor?.setTier(meta.tier)
    renderHeader()
    renderOverview()
    history?.reload()
  }

  async function revert() {
    if (!editor?.isDirty()) return
    if (!(await confirmDialog({ title: 'Revert changes?', message: 'Your unsaved edits will be lost.', confirmLabel: 'Revert', kind: 'danger' }))) return
    editor.setValue(current.value)
  }

  async function remove() {
    const confirmed = await typeToConfirm({
      title: 'Delete parameter',
      message: `This permanently deletes ${meta.name} and its history (${formatCount(meta.version, 'version')}) from ${connection.name}.`,
      expected: meta.name,
      confirmLabel: 'Delete parameter'
    })
    if (!confirmed) return
    try {
      await api.ssm.delete(connection.id, meta.name)
      toast({ kind: 'success', message: `Deleted ${meta.name}.` })
      onChanged({ type: 'deleted', name: meta.name })
    } catch (err) {
      handleError(err, 'Delete failed')
    }
  }

  function restore(entry) {
    if (!editor) {
      toast({ kind: 'info', message: 'Decrypt the value before restoring a version.' })
      return
    }
    editor.setValue(entry.value, { markClean: false })
    showSubtab('value')
    toast({ kind: 'info', message: `Version ${entry.version} is in the editor. Review it and save to make it current.` })
  }

  function handleError(err, title) {
    toastError(err, title)
    if (err?.code === 'ParameterNotFound') onChanged({ type: 'missing', name: meta.name })
  }

  function showLoadError(err) {
    const retryLoad = () => {
      valuePanel.replaceChildren(loading('Loading value…'))
      load()
    }
    const retry = h('button', { class: 'btn btn--default', type: 'button', onClick: retryLoad }, icon('refresh', 14), 'Try again')
    valuePanel.replaceChildren(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load this parameter'), h('span', {}, err.message), err.hint ? h('span', { class: 'muted' }, err.hint) : null, retry))
    if (err?.code === 'ParameterNotFound') onChanged({ type: 'missing', name: meta.name })
  }

  function renderHeader() {
    badges.replaceChildren(typeBadge(meta.type), tierBadge(meta.tier))
    version.textContent = `Version ${meta.version}`
  }

  function renderOverview() {
    const item = (label, value, cls) => [h('dt', {}, label), h('dd', { class: cls }, value || h('span', { class: 'muted' }, '—'))]
    const tagList = tags.length ? h('span', { class: 'tag-list' }, tags.map((t) => h('span', { class: 'tag' }, h('strong', {}, t.key), t.value ? ` = ${t.value}` : ''))) : null
    overview.replaceChildren(
      ...item('ARN', current?.arn, 'mono break'),
      ...item('Description', meta.description),
      ...item('Type', meta.type),
      ...item('Tier', meta.tier),
      ...item('Data type', meta.dataType),
      ...item('KMS key', meta.type === 'SecureString' ? meta.keyId : null, 'mono'),
      ...item('Version', String(meta.version)),
      ...item('Last modified', formatDate(meta.lastModifiedDate)),
      ...item('Last modified user', meta.lastModifiedUser, 'mono break'),
      ...item('Tags', tagList)
    )
  }

  function subtab(id, label, iconName) {
    return h('button', { class: ['subtab', id === 'value' && 'is-active'], type: 'button', role: 'tab', dataset: { subtab: id }, onClick: () => showSubtab(id) }, icon(iconName, 14), label)
  }

  function showSubtab(id) {
    for (const [key, button] of Object.entries(subtabs)) button.classList.toggle('is-active', key === id)
    valuePanel.hidden = id !== 'value'
    historyPanel.hidden = id !== 'history'
    if (id === 'history' && !history) {
      history = createHistoryPanel({ api, connection, name: meta.name, canRestore: canWrite, getSettings, getCurrent: () => current, onRestore: restore })
      historyPanel.replaceChildren(history.el)
    }
  }
}

function loading(text) {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/renderer/save-plan.test.js test/renderer/parameter.test.js`
Expected: PASS (6 + 11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/save-plan.js src/renderer/views/parameter.js test/renderer/save-plan.test.js test/renderer/parameter.test.js
git commit -m "feat: add parameter tab with overview, guarded save flow, revert, delete, and restore

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 18: Create-parameter dialog

**Files:**
- Create: `src/renderer/views/create-parameter.js`, `src/renderer/styles/dialogs.css`
- Test: `test/renderer/create-parameter.test.js`

**Interfaces:**
- Consumes: `PARAMETER_TYPES`, `validateName`, `byteLength`, `tierLimit` (Task 4); `h`, `field` (Task 12); `openModal`, `toast`, `toastError` (Task 13); `createEnvEditor` (Task 14).
- Produces: `openCreateParameter({ api, connection, prefix?, onCreated?(name) }) → modal controller`.
  - Fields: `input[name=name]`, `input[name=description]`, `select[name=type]` (default `SecureString`), `select[name=tier]`, `input[name=keyId]` (only shown for SecureString, default `alias/aws/ssm`), and a value editor.
  - It submits `ssm.put(connection.id, { …, overwrite: false })`. A `ParameterAlreadyExists` error is shown inline on the name field.
- Produces: `dialogs.css`, which holds the create form and settings form styles (Task 22 uses it).

- [ ] **Step 1: Write the failing test**

`test/renderer/create-parameter.test.js`:

```js
// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { openCreateParameter } from '../../src/renderer/views/create-parameter.js'

const q = (selector) => document.querySelector(`.modal ${selector}`)
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const choose = (select, value) => {
  select.value = value
  select.dispatchEvent(new Event('change'))
}
const setValue = (text) => {
  const view = EditorView.findFromDOM(q('.cm-editor'))
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}
function open(put = vi.fn(async () => ({ version: 1, tier: 'Standard' }))) {
  const onCreated = vi.fn()
  openCreateParameter({ api: { ssm: { put } }, connection: { id: 'c1', name: 'Prod' }, prefix: '/myapp/prod', onCreated })
  return { put, onCreated }
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('openCreateParameter', () => {
  it('prefills the folder and keeps Create disabled until name and value are valid', () => {
    open()
    expect(q('input[name="name"]').value).toBe('/myapp/prod/')
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    type(q('input[name="name"]'), '/myapp/prod/env')
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    setValue('A=1')
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('shows name errors only after the user types', () => {
    open()
    expect(q('.field__error').textContent).toBe('')
    type(q('input[name="name"]'), 'bad name')
    expect(q('.field__error').textContent).toBe('Only letters, numbers, and _ . - / are allowed')
  })

  it('shows the KMS key field only for SecureString', () => {
    open()
    const keyField = q('input[name="keyId"]').closest('.field')
    expect(keyField.hidden).toBe(false)
    choose(q('select[name="type"]'), 'String')
    expect(keyField.hidden).toBe(true)
  })

  it('blocks values over the tier limit until the tier allows them', () => {
    open()
    type(q('input[name="name"]'), '/a/b')
    setValue('x'.repeat(4097))
    expect(q('[data-action="confirm"]').disabled).toBe(true)
    choose(q('select[name="tier"]'), 'Advanced')
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('creates without overwriting and reports the new name', async () => {
    const { put, onCreated } = open()
    type(q('input[name="name"]'), '/myapp/prod/new')
    type(q('input[name="description"]'), ' New one ')
    setValue('A=1')
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('/myapp/prod/new'))
    expect(put).toHaveBeenCalledWith('c1', { name: '/myapp/prod/new', value: 'A=1', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', description: 'New one', dataType: 'text', overwrite: false })
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('keeps the dialog open and points at the name when it already exists', async () => {
    const put = vi.fn(async () => Promise.reject(Object.assign(new Error('A parameter named /myapp/prod/env already exists.'), { code: 'ParameterAlreadyExists' })))
    open(put)
    type(q('input[name="name"]'), '/myapp/prod/env')
    setValue('A=1')
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(q('.field__error').textContent).toBe('A parameter named /myapp/prod/env already exists.'))
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/create-parameter.test.js`
Expected: FAIL, because `create-parameter.js` does not exist.

- [ ] **Step 3: Implement the dialog and its styles**

`src/renderer/views/create-parameter.js`:

```js
import '../styles/dialogs.css'
import { PARAMETER_TYPES, byteLength, tierLimit, validateName } from '@shared/names.js'
import { h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { createEnvEditor } from '../components/env-editor.js'
import { openModal } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

export function openCreateParameter({ api, connection, prefix = '', onCreated = () => {} }) {
  const state = { name: prefix ? `${prefix.replace(/\/+$/, '')}/` : '', description: '', type: 'SecureString', tier: 'Standard', keyId: 'alias/aws/ssm', value: '', touched: false, busy: false }
  let modal = null

  const nameError = h('span', { class: 'field__error', role: 'alert' })
  const nameInput = h('input', {
    class: 'input mono',
    name: 'name',
    value: state.name,
    autofocus: true,
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '/myapp/prod/env',
    onInput: (event) => {
      state.name = event.target.value.trim()
      state.touched = true
      validate()
    }
  })
  const keyField = field(
    'KMS key',
    h('input', {
      class: 'input mono',
      name: 'keyId',
      value: state.keyId,
      spellcheck: 'false',
      onInput: (event) => {
        state.keyId = event.target.value.trim()
        validate()
      }
    }),
    'Key ID, key ARN, or alias used to encrypt the value.'
  )
  const typeSelect = h(
    'select',
    {
      class: 'input',
      name: 'type',
      onChange: (event) => {
        state.type = event.target.value
        keyField.hidden = state.type !== 'SecureString'
        validate()
      }
    },
    PARAMETER_TYPES.map((t) => h('option', { value: t }, t))
  )
  const editor = createEnvEditor({
    value: '',
    tier: state.tier,
    onChange: (_dirty, text) => {
      state.value = text
      validate()
    },
    onSave: () => submit()
  })
  const tierSelect = h(
    'select',
    {
      class: 'input',
      name: 'tier',
      onChange: (event) => {
        state.tier = event.target.value
        editor.setTier(state.tier)
        validate()
      }
    },
    h('option', { value: 'Standard' }, 'Standard — up to 4 KB, free'),
    h('option', { value: 'Advanced' }, 'Advanced — up to 8 KB, charges apply')
  )
  typeSelect.value = state.type

  const body = h(
    'form',
    {
      class: 'create-form',
      onSubmit: (event) => {
        event.preventDefault()
        submit()
      }
    },
    field('Name', nameInput, 'Use "/" to build a path, for example /myapp/prod/env.', nameError),
    field('Description', h('input', { class: 'input', name: 'description', placeholder: 'Optional', onInput: (event) => (state.description = event.target.value) })),
    h('div', { class: 'field-row' }, field('Type', typeSelect), field('Tier', tierSelect)),
    keyField,
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Value'), h('div', { class: 'create-form__editor' }, editor.el))
  )

  modal = openModal({
    title: `Create parameter in ${connection.name}`,
    size: 'lg',
    body,
    onClose: () => editor.destroy(),
    actions: [
      { id: 'cancel', label: 'Cancel', onClick: (m) => m.close() },
      { id: 'confirm', label: 'Create parameter', kind: 'primary', disabled: true, onClick: () => submit() }
    ]
  })
  validate()
  return modal

  function validate() {
    const nameProblem = validateName(state.name)
    nameError.textContent = state.touched && nameProblem ? nameProblem : ''
    const ok = !nameProblem && state.value.length > 0 && byteLength(state.value) <= tierLimit(state.tier) && (state.type !== 'SecureString' || state.keyId !== '')
    if (modal && !state.busy) modal.button('confirm').disabled = !ok
    return ok
  }

  async function submit() {
    if (state.busy || !validate()) return
    state.busy = true
    modal.setBusy(true)
    try {
      const result = await api.ssm.put(connection.id, {
        name: state.name,
        value: state.value,
        type: state.type,
        tier: state.tier,
        keyId: state.type === 'SecureString' ? state.keyId : null,
        description: state.description.trim(),
        dataType: 'text',
        overwrite: false
      })
      toast({ kind: 'success', message: `Created ${state.name} (version ${result.version}).` })
      modal.close()
      onCreated(state.name)
    } catch (err) {
      state.busy = false
      modal.setBusy(false)
      validate()
      if (err?.code === 'ParameterAlreadyExists') {
        nameError.textContent = err.message
        nameInput.focus()
      } else {
        toastError(err, 'Could not create the parameter')
      }
    }
  }
}
```

`src/renderer/styles/dialogs.css`:

```css
.create-form,
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.create-form__editor {
  height: 240px;
}
.settings-form__section {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/create-parameter.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/create-parameter.js src/renderer/styles/dialogs.css test/renderer/create-parameter.test.js
git commit -m "feat: add create-parameter dialog with live validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Compare tab

**Files:**
- Create: `src/renderer/views/compare.js`, `src/renderer/styles/compare.css`
- Test: `test/renderer/compare.test.js`

**Interfaces:**
- Consumes: `compareEnv` (Task 3); `h`, `icon`, `toastError` (Tasks 12–13); `renderCompare` (Task 15).
- Produces: `createCompareTab({ api, connections, getSettings, initial: { a: { connectionId, name }, b: { connectionId, name } } })` → `{ el, isDirty: () => false, destroy() }`.
  - Each side has a connection `<select>` and a parameter `<input aria-label="Parameter A|B">` backed by a `<datalist>`. Names are loaded with `ssm.list` once per connection.
  - `[data-action="compare"]` fetches both values with `decrypt: true` and renders `renderCompare`.

- [ ] **Step 1: Write the failing test**

`test/renderer/compare.test.js`:

```js
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCompareTab } from '../../src/renderer/views/compare.js'

const connections = [{ id: 'c1', name: 'Prod' }, { id: 'c2', name: 'Staging' }]
const type = (input, value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const choose = (select, value) => {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

function setup(get = vi.fn(async (connId) => ({ value: connId === 'c1' ? 'A=1\nB=1' : 'A=2\nC=3' }))) {
  const api = { ssm: { list: vi.fn(async (id) => [{ name: id === 'c1' ? '/prod/env' : '/stg/env' }]), get } }
  const tab = createCompareTab({ api, connections, getSettings: () => ({ maskValuesInDiff: false }), initial: { a: { connectionId: 'c1', name: '/prod/env' }, b: { connectionId: 'c2', name: '' } } })
  document.body.append(tab.el)
  return { api, tab }
}

afterEach(() => document.body.replaceChildren())

describe('createCompareTab', () => {
  it('fills the pickers and loads parameter names once per connection', async () => {
    const { api, tab } = setup()
    const selects = tab.el.querySelectorAll('select')
    expect([...selects].map((s) => s.value)).toEqual(['c1', 'c2'])
    expect(tab.el.querySelector('input[aria-label="Parameter A"]').value).toBe('/prod/env')
    await vi.waitFor(() => expect(tab.el.querySelectorAll('datalist option')).toHaveLength(2))
    choose(selects[1], 'c1')
    await vi.waitFor(() => expect([...tab.el.querySelectorAll('datalist')[1].options].map((o) => o.value)).toEqual(['/prod/env']))
    expect(api.ssm.list).toHaveBeenCalledTimes(2)
  })

  it('asks for a parameter on both sides', () => {
    const { tab } = setup()
    tab.el.querySelector('[data-action="compare"]').click()
    expect(tab.el.querySelector('.compare__result').textContent).toBe('Pick a parameter on both sides.')
  })

  it('compares decrypted values from two connections', async () => {
    const { api, tab } = setup()
    type(tab.el.querySelector('input[aria-label="Parameter B"]'), '/stg/env')
    tab.el.querySelector('[data-action="compare"]').click()
    await vi.waitFor(() => expect(tab.el.querySelectorAll('.diff-chip')).toHaveLength(4))
    expect(api.ssm.get).toHaveBeenCalledWith('c1', '/prod/env', { decrypt: true })
    expect(api.ssm.get).toHaveBeenCalledWith('c2', '/stg/env', { decrypt: true })
    expect([...tab.el.querySelectorAll('.diff-chip')].map((c) => c.textContent)).toEqual(['1 different', '1 only in A', '1 only in B', '0 equal'])
    expect(tab.el.textContent).toContain('A · /prod/env (Prod)')
  })

  it('shows an error when a value cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const get = vi.fn(async () => Promise.reject(Object.assign(new Error('/stg/env no longer exists.'), { code: 'ParameterNotFound' })))
    const { tab } = setup(get)
    type(tab.el.querySelector('input[aria-label="Parameter B"]'), '/stg/env')
    tab.el.querySelector('[data-action="compare"]').click()
    await vi.waitFor(() => expect(tab.el.querySelector('.compare__result').textContent).toContain('/stg/env no longer exists.'))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/compare.test.js`
Expected: FAIL, because `compare.js` does not exist.

- [ ] **Step 3: Implement the tab and its styles**

`src/renderer/views/compare.js`:

```js
import '../styles/compare.css'
import { compareEnv } from '@shared/diff.js'
import { h } from '../lib/dom.js'
import { renderCompare } from '../components/diff-view.js'
import { icon } from '../components/icons.js'
import { toastError } from '../components/toast.js'

let pickerCount = 0

export function createCompareTab({ api, connections, getSettings, initial }) {
  const names = new Map() // connection id → Promise<string[]>
  const sides = { a: { ...initial.a }, b: { ...initial.b } }
  const result = h('div', { class: 'compare__result' }, h('p', { class: 'muted' }, 'Pick two parameters and press Compare.'))
  const compareButton = h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'compare' }, onClick: () => run() }, icon('compare', 14), 'Compare')
  const el = h('section', { class: 'compare' }, h('div', { class: 'compare__pickers' }, picker('a', 'A'), h('span', { class: 'compare__vs' }, 'vs'), picker('b', 'B'), compareButton), result)
  return { el, isDirty: () => false, destroy() {} }

  function picker(side, label) {
    const datalist = h('datalist', { id: `compare-names-${++pickerCount}` })
    const connectionSelect = h(
      'select',
      {
        class: 'input',
        'aria-label': `Connection ${label}`,
        onChange: (event) => {
          sides[side].connectionId = event.target.value
          loadNames(side, datalist)
        }
      },
      connections.map((c) => h('option', { value: c.id }, c.name))
    )
    connectionSelect.value = sides[side].connectionId
    const nameInput = h('input', {
      class: 'input mono',
      list: datalist.id,
      value: sides[side].name,
      placeholder: 'Parameter name',
      spellcheck: 'false',
      'aria-label': `Parameter ${label}`,
      onInput: (event) => (sides[side].name = event.target.value.trim()),
      onKeydown: (event) => event.key === 'Enter' && run()
    })
    loadNames(side, datalist)
    return h('div', { class: 'compare__picker' }, h('span', { class: 'compare__label' }, label), connectionSelect, nameInput, datalist)
  }

  function loadNames(side, datalist) {
    const id = sides[side].connectionId
    if (!names.has(id)) {
      names.set(
        id,
        api.ssm
          .list(id)
          .then((rows) => rows.map((r) => r.name))
          .catch((err) => {
            names.delete(id)
            toastError(err, 'Could not list parameters')
            return []
          })
      )
    }
    names.get(id).then((list) => {
      if (sides[side].connectionId === id) datalist.replaceChildren(...list.map((name) => h('option', { value: name })))
    })
  }

  async function run() {
    const { a, b } = sides
    if (!a.name || !b.name) {
      result.replaceChildren(h('p', { class: 'muted' }, 'Pick a parameter on both sides.'))
      return
    }
    compareButton.disabled = true
    result.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading values…'))
    try {
      const [va, vb] = await Promise.all([api.ssm.get(a.connectionId, a.name, { decrypt: true }), api.ssm.get(b.connectionId, b.name, { decrypt: true })])
      result.replaceChildren(renderCompare(compareEnv(va.value, vb.value), { masked: getSettings().maskValuesInDiff, labels: [describe(a), describe(b)] }).el)
    } catch (err) {
      result.replaceChildren(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load both values'), h('span', {}, err.message)))
      toastError(err, 'Compare failed')
    } finally {
      compareButton.disabled = false
    }
  }

  function describe(side) {
    const connection = connections.find((c) => c.id === side.connectionId)
    return `${side.name} (${connection?.name ?? 'unknown connection'})`
  }
}
```

`src/renderer/styles/compare.css`:

```css
.compare {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}
.compare__pickers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.compare__picker {
  flex: 1;
  display: grid;
  grid-template-columns: auto 200px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 380px;
}
.compare__label {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--black);
  color: var(--white);
  font-size: 12px;
  font-weight: 700;
}
:root[data-theme='dark'] .compare__label {
  background: var(--gray-light2);
  color: var(--black);
}
.compare__vs {
  color: var(--text-muted);
  font-weight: 600;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/compare.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/compare.js src/renderer/styles/compare.css test/renderer/compare.test.js
git commit -m "feat: add compare tab for two parameters across connections

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 20: Parameters table tab

**Files:**
- Create: `src/renderer/views/parameters.js`, `src/renderer/styles/parameters.css`
- Test: `test/renderer/parameters.test.js`

**Interfaces:**
- Consumes: `COLUMNS`, `filterRows`, `sortRows` (Task 5); `formatCount`, `formatDate`, `formatNumber` (Task 4); `h`, `icon`, badges (Tasks 12–13).
- Produces: `PAGE_SIZE` (500) and `createParametersTab({ canWrite, onOpen(row), onRefresh(), onCreate(prefix), onClearPrefix?() })` → `{ el, setRows(rows), setLoading(bool), setError(err), setPrefix(prefix), focusSearch() }`.
  - Rows render as `tr.data-row[data-name]`.
  - Toolbar buttons carry `data-action` values `refresh`, `create`, and `clear-prefix`.
  - The count is `.parameters__count`, and "Show more" lives in `.parameters__footer button`.

- [ ] **Step 1: Write the failing test**

`test/renderer/parameters.test.js`:

```js
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE, createParametersTab } from '../../src/renderer/views/parameters.js'

const row = (i, extra = {}) => ({ name: `/app/p${String(i).padStart(4, '0')}`, type: 'String', tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: '2026-09-01T00:00:00.000Z', lastModifiedUser: 'arn:aws:iam::1:user/leo', description: '', keyId: null, allowedPattern: null, ...extra })
const many = (n) => Array.from({ length: n }, (_, i) => row(i))

function setup({ canWrite = true } = {}) {
  const handlers = { onOpen: vi.fn(), onRefresh: vi.fn(), onCreate: vi.fn(), onClearPrefix: vi.fn() }
  const tab = createParametersTab({ canWrite, ...handlers })
  document.body.append(tab.el)
  return { tab, ...handlers }
}
const names = (tab) => [...tab.el.querySelectorAll('.data-row')].map((tr) => tr.dataset.name)
const count = (tab) => tab.el.querySelector('.parameters__count').textContent
const search = (tab, value) => {
  const input = tab.el.querySelector('input[type="search"]')
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const more = (tab) => tab.el.querySelector('.parameters__footer button')
const header = (tab, label) => [...tab.el.querySelectorAll('th')].find((th) => th.textContent === label)

afterEach(() => document.body.replaceChildren())

describe('createParametersTab', () => {
  it('shows skeleton rows while loading, then the AWS console columns', () => {
    const { tab } = setup()
    expect(tab.el.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0)
    tab.setRows([row(1, { type: 'SecureString', description: 'Main env' })])
    expect([...tab.el.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Name', 'Tier', 'Type', 'Data type', 'Version', 'Last modified', 'Last modified user', 'Description'])
    const cells = [...tab.el.querySelectorAll('.data-row td')].map((td) => td.textContent)
    expect([cells[0], cells[1], cells[2], cells[3], cells[4], cells[7]]).toEqual(['/app/p0001', 'Standard', 'SecureString', 'text', '1', 'Main env'])
    expect(count(tab)).toBe('1 parameter')
  })

  it('opens a parameter on click and on Enter', () => {
    const { tab, onOpen } = setup()
    const rows = [row(1)]
    tab.setRows(rows)
    const tr = tab.el.querySelector('.data-row')
    tr.click()
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledWith(rows[0])
  })

  it('renders 500 rows at a time with a "Show more" button', () => {
    const { tab } = setup()
    tab.setRows(many(1200))
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(PAGE_SIZE)
    expect(more(tab).textContent).toBe('Show 500 more (700 remaining)')
    more(tab).click()
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(1000)
    expect(more(tab).textContent).toBe('Show 200 more (200 remaining)')
    more(tab).click()
    expect(tab.el.querySelectorAll('.data-row')).toHaveLength(1200)
    expect(more(tab)).toBeNull()
  })

  it('searches every row, not only the rendered ones', () => {
    const { tab } = setup()
    tab.setRows(many(1200))
    search(tab, 'p1199')
    expect(names(tab)).toEqual(['/app/p1199'])
    expect(count(tab)).toBe('1 match of 1,200')
  })

  it('sorts by a column header and toggles the direction', () => {
    const { tab } = setup()
    tab.setRows([row(1, { version: 10 }), row(2, { version: 2 }), row(3, { version: 3 })])
    header(tab, 'Version').querySelector('button').click()
    expect(names(tab)).toEqual(['/app/p0002', '/app/p0003', '/app/p0001'])
    header(tab, 'Version').querySelector('button').click()
    expect(names(tab)).toEqual(['/app/p0001', '/app/p0003', '/app/p0002'])
    expect(header(tab, 'Version').getAttribute('aria-sort')).toBe('descending')
  })

  it('filters to a folder and clears it from the chip', () => {
    const { tab, onClearPrefix } = setup()
    tab.setRows([row(1, { name: '/a/x' }), row(2, { name: '/b/y' })])
    tab.setPrefix('/a')
    expect(names(tab)).toEqual(['/a/x'])
    expect(tab.el.querySelector('.prefix-chip').hidden).toBe(false)
    tab.el.querySelector('[data-action="clear-prefix"]').click()
    expect(names(tab)).toEqual(['/a/x', '/b/y'])
    expect(onClearPrefix).toHaveBeenCalled()
  })

  it('shows empty and error states', () => {
    const { tab } = setup()
    tab.setRows([])
    expect(tab.el.textContent).toContain('No parameters in this connection')
    tab.setRows([row(1)])
    search(tab, 'zzz')
    expect(tab.el.textContent).toContain('No parameters match')
    tab.setError({ message: 'Not allowed to list parameters.', hint: 'Check IAM' })
    expect(tab.el.textContent).toContain('Could not load parameters')
    expect(tab.el.textContent).toContain('Check IAM')
  })

  it('hides Create on read-only connections and passes the folder to onCreate', () => {
    expect(setup({ canWrite: false }).tab.el.querySelector('[data-action="create"]')).toBeNull()
    const { tab, onCreate, onRefresh } = setup()
    tab.setPrefix('/a')
    tab.el.querySelector('[data-action="create"]').click()
    tab.el.querySelector('[data-action="refresh"]').click()
    expect(onCreate).toHaveBeenCalledWith('/a')
    expect(onRefresh).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/parameters.test.js`
Expected: FAIL, because `parameters.js` does not exist.

- [ ] **Step 3: Implement the tab and its styles**

`src/renderer/views/parameters.js`:

```js
import '../styles/parameters.css'
import { formatCount, formatDate, formatNumber } from '@shared/format.js'
import { COLUMNS, filterRows, sortRows } from '@shared/table.js'
import { h } from '../lib/dom.js'
import { tierBadge, typeBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'

// Rendering thousands of rows at once freezes the window; search and sort still use every row.
export const PAGE_SIZE = 500

export function createParametersTab({ canWrite, onOpen, onRefresh, onCreate, onClearPrefix = () => {} }) {
  const state = { rows: [], loading: true, error: null, query: '', prefix: '', sort: { column: 'name', direction: 'asc' }, limit: PAGE_SIZE }

  const searchInput = h('input', {
    class: 'input input--search',
    type: 'search',
    placeholder: 'Search name or description',
    'aria-label': 'Search parameters',
    onInput: (event) => {
      state.query = event.target.value
      state.limit = PAGE_SIZE
      draw()
    }
  })
  const prefixChip = h('span', { class: 'prefix-chip', hidden: true })
  const count = h('span', { class: 'parameters__count muted' })
  const thead = h('thead')
  const tbody = h('tbody')
  const footer = h('div', { class: 'parameters__footer' })
  const el = h(
    'section',
    { class: 'parameters' },
    h(
      'div',
      { class: 'toolbar' },
      h('h2', { class: 'toolbar__title' }, 'Parameters'),
      prefixChip,
      count,
      h('span', { class: 'spacer' }),
      h('div', { class: 'search-box' }, icon('search', 14), searchInput),
      h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'refresh' }, onClick: () => onRefresh() }, icon('refresh', 14), 'Refresh'),
      canWrite ? h('button', { class: 'btn btn--primary', type: 'button', dataset: { action: 'create' }, onClick: () => onCreate(state.prefix) }, icon('plus', 14), 'Create parameter') : null
    ),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' }, thead, tbody)),
    footer
  )
  draw()

  return {
    el,
    setRows(rows) {
      Object.assign(state, { rows, loading: false, error: null })
      draw()
    },
    setLoading(loading) {
      state.loading = loading
      draw()
    },
    setError(error) {
      Object.assign(state, { error, loading: false })
      draw()
    },
    setPrefix(prefix) {
      Object.assign(state, { prefix, limit: PAGE_SIZE })
      draw()
    },
    focusSearch: () => searchInput.focus()
  }

  function draw() {
    drawHeader()
    drawPrefixChip()
    footer.replaceChildren()
    if (state.loading) {
      count.textContent = ''
      tbody.replaceChildren(...skeletonRows())
      return
    }
    if (state.error) {
      count.textContent = ''
      tbody.replaceChildren(emptyRow(h('div', { class: 'empty-state empty-state--error' }, h('strong', {}, 'Could not load parameters'), h('span', {}, state.error.message), state.error.hint ? h('span', { class: 'muted' }, state.error.hint) : null)))
      return
    }

    const filtered = sortRows(filterRows(state.rows, { query: state.query, prefix: state.prefix }), state.sort.column, state.sort.direction)
    count.textContent = filtered.length === state.rows.length ? formatCount(state.rows.length, 'parameter') : `${formatCount(filtered.length, 'match', 'matches')} of ${formatNumber(state.rows.length)}`
    if (filtered.length === 0) {
      const none = state.rows.length === 0
      tbody.replaceChildren(
        emptyRow(h('div', { class: 'empty-state' }, h('strong', {}, none ? 'No parameters in this connection' : 'No parameters match'), h('span', { class: 'muted' }, none ? 'Check the connection path prefix, or create a parameter.' : 'Try another search or clear the folder filter.')))
      )
      return
    }

    tbody.replaceChildren(...filtered.slice(0, state.limit).map(renderRow))
    const remaining = filtered.length - state.limit
    if (remaining > 0) {
      footer.append(
        h(
          'button',
          {
            class: 'btn btn--default',
            type: 'button',
            onClick: () => {
              state.limit += PAGE_SIZE
              draw()
            }
          },
          `Show ${formatNumber(Math.min(PAGE_SIZE, remaining))} more (${formatNumber(remaining)} remaining)`
        )
      )
    }
  }

  function drawHeader() {
    thead.replaceChildren(
      h(
        'tr',
        {},
        COLUMNS.map((column) => {
          const active = state.sort.column === column.key
          const direction = active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
          return h(
            'th',
            { scope: 'col', class: [`col-${column.key}`, active && 'is-sorted'], 'aria-sort': direction },
            h('button', { class: 'th-sort', type: 'button', onClick: () => toggleSort(column.key) }, column.label, active ? icon(state.sort.direction === 'asc' ? 'chevronUp' : 'chevronDown', 12) : null)
          )
        })
      )
    )
  }

  function drawPrefixChip() {
    prefixChip.hidden = !state.prefix
    prefixChip.replaceChildren(
      icon('folder', 12),
      h('span', { class: 'mono' }, state.prefix),
      h(
        'button',
        {
          class: 'prefix-chip__clear',
          type: 'button',
          'aria-label': 'Clear folder filter',
          dataset: { action: 'clear-prefix' },
          onClick: () => {
            state.prefix = ''
            draw()
            onClearPrefix()
          }
        },
        icon('close', 12)
      )
    )
  }

  function toggleSort(column) {
    const direction = state.sort.column === column && state.sort.direction === 'asc' ? 'desc' : 'asc'
    state.sort = { column, direction }
    draw()
  }

  function renderRow(row) {
    return h(
      'tr',
      { class: 'data-row', tabindex: '0', dataset: { name: row.name }, onClick: () => onOpen(row), onKeydown: (event) => event.key === 'Enter' && onOpen(row) },
      h('td', { class: 'col-name mono', title: row.name }, row.name),
      h('td', {}, tierBadge(row.tier)),
      h('td', {}, typeBadge(row.type)),
      h('td', { class: 'muted' }, row.dataType),
      h('td', { class: 'num' }, String(row.version)),
      h('td', { class: 'nowrap' }, formatDate(row.lastModifiedDate)),
      h('td', { class: 'ellipsis muted', title: row.lastModifiedUser ?? '' }, row.lastModifiedUser ?? '—'),
      h('td', { class: 'ellipsis', title: row.description }, row.description || h('span', { class: 'muted' }, '—'))
    )
  }
}

function emptyRow(content) {
  return h('tr', { class: 'empty-row' }, h('td', { colspan: String(COLUMNS.length) }, content))
}

function skeletonRows() {
  return Array.from({ length: 6 }, () => h('tr', { class: 'skeleton-row' }, COLUMNS.map(() => h('td', {}, h('span', { class: 'skeleton' })))))
}
```

`src/renderer/styles/parameters.css`:

```css
.parameters {
  display: flex;
  flex-direction: column;
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 60px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.toolbar__title {
  font-size: 16px;
}
.parameters__count {
  font-size: 12px;
  white-space: nowrap;
}
.prefix-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px 0 8px;
  border-radius: 999px;
  background: var(--tint-green-bg);
  color: var(--tint-green-text);
}
.prefix-chip__clear {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.search-box {
  position: relative;
  width: 280px;
}
.search-box > .icon {
  position: absolute;
  top: 50%;
  left: 10px;
  color: var(--text-subtle);
  transform: translateY(-50%);
}
.input--search {
  height: 32px;
  padding-left: 30px;
}
.table-wrap {
  padding: 0 20px;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.data-table th {
  position: sticky;
  top: 60px;
  z-index: 2;
  padding: 0;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg);
  text-align: left;
}
.th-sort {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  cursor: pointer;
}
.th-sort:hover,
.is-sorted .th-sort {
  color: var(--text);
}
.data-table td {
  padding: 9px 10px;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
.data-row {
  cursor: pointer;
}
.data-row:hover td,
.data-row:focus-visible td {
  background: var(--bg-subtle);
}
.data-row:focus-visible {
  box-shadow: none;
}
.col-name {
  color: var(--text);
  font-weight: 600;
}
th.col-name {
  width: 25%;
}
th.col-tier {
  width: 10%;
}
th.col-type {
  width: 14%;
}
th.col-dataType {
  width: 7%;
}
th.col-version {
  width: 7%;
}
th.col-lastModifiedDate {
  width: 14%;
}
th.col-lastModifiedUser {
  width: 11%;
}
th.col-description {
  width: 12%;
}
.num {
  font-variant-numeric: tabular-nums;
}
.empty-row td {
  padding: 0;
}
.skeleton-row td {
  padding: 14px 10px;
}
.parameters__footer {
  display: flex;
  justify-content: center;
  padding: 16px;
}
.parameters__footer:empty {
  display: none;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/parameters.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/parameters.js src/renderer/styles/parameters.css test/renderer/parameters.test.js
git commit -m "feat: add parameters table with console columns, search, sort, and paging

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Workspace — sidebar tree, tabs, and wiring

**Files:**
- Create: `src/renderer/views/sidebar-tree.js`, `src/renderer/views/workspace.js`, `src/renderer/styles/workspace.css`
- Test: `test/renderer/sidebar-tree.test.js`, `test/renderer/workspace.test.js`

**Interfaces:**
- Consumes: `buildTree`, `filterTree` (Task 5); `h`, `clear`, `createTabModel` (Task 12); `icon`, `readOnlyBadge`, `confirmDialog`, `toast`, `toastError` (Task 13); `createParameterTab` (Task 17); `openCreateParameter` (Task 18); `createCompareTab` (Task 19); `createParametersTab` (Task 20).
- Produces from `sidebar-tree.js`: `createSidebarTree({ onSelectFolder(path), onOpenLeaf(name) })` → `{ el, setRows(rows), setQuery(q), setSelectedFolder(path), setActiveLeaf(name | null) }`.
  - Rows render as `button.tree-row[data-path]`. The root row is `.tree-row--root` ("All parameters").
  - Folders toggle open on click. A filter query expands every match.
- Produces from `workspace.js`: `renderWorkspace(root, { api, connection, getSettings, openSettings, onDisconnect })` → `{ reload(), hasUnsavedChanges(), destroy() }`.
  - Sidebar buttons carry `data-action` values `disconnect`, `compare`, and `create`.
  - Tabs render as `.tab[data-tab]` with a `.tab__title` and a `.tab__close`. Parameter tab ids are `param:<name>`, and their label is the last two path segments.
  - `Ctrl/Cmd+W` closes the active tab.

- [ ] **Step 1: Write the failing tests**

`test/renderer/sidebar-tree.test.js`:

```js
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
```

`test/renderer/workspace.test.js`:

```js
// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { renderWorkspace } from '../../src/renderer/views/workspace.js'

const connection = { id: 'c1', name: 'Prod', profile: 'prod', region: 'sa-east-1', pathPrefix: '', color: 'green', readOnly: false }
const meta = (name, type = 'String') => ({ name, type, tier: 'Standard', dataType: 'text', version: 1, lastModifiedDate: null, lastModifiedUser: null, description: '', keyId: null, allowedPattern: null })
const rows = [meta('/myapp/prod/env', 'SecureString'), meta('/myapp/dev/env')]

const workspaces = []
function setup({ readOnly = false } = {}) {
  const api = {
    ssm: {
      list: vi.fn(async () => rows),
      get: vi.fn(async (_c, name) => ({ name, type: 'String', value: 'A=1', version: 1, lastModifiedDate: null, dataType: 'text', arn: 'arn' })),
      tags: vi.fn(async () => []),
      history: vi.fn(async () => []),
      put: vi.fn(),
      delete: vi.fn()
    },
    connections: { list: vi.fn(async () => [connection]) }
  }
  const root = document.createElement('div')
  document.body.append(root)
  const onDisconnect = vi.fn()
  const openSettings = vi.fn()
  const ws = renderWorkspace(root, { api, connection: { ...connection, readOnly }, getSettings: () => ({ autoDecrypt: true, maskValuesInDiff: true }), openSettings, onDisconnect })
  workspaces.push(ws)
  return { api, root, ws, onDisconnect, openSettings }
}
const titles = (root) => [...root.querySelectorAll('.tab .tab__title')].map((t) => t.textContent)
const loaded = (root) => vi.waitFor(() => expect(root.querySelectorAll('.data-row')).toHaveLength(2))
const openRow = async (root, name) => {
  root.querySelector(`.data-row[data-name="${name}"]`).click()
  await vi.waitFor(() => expect(root.querySelector('.param:not([hidden]) .cm-editor')).not.toBeNull())
}
const edit = (root) => {
  const view = EditorView.findFromDOM(root.querySelector('.param:not([hidden]) .cm-editor'))
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\nB=2' } })
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})
afterEach(() => workspaces.splice(0).forEach((ws) => ws.destroy()))

describe('renderWorkspace', () => {
  it('lists the connection parameters and fills the tree', async () => {
    const { api, root } = setup()
    await loaded(root)
    expect(api.ssm.list).toHaveBeenCalledWith('c1')
    expect(root.querySelector('.sidebar__conn-name').textContent).toBe('Prod')
    expect(root.querySelector('.tree-row--root .tree-row__count').textContent).toBe('2')
    expect(titles(root)).toEqual(['Parameters'])
  })

  it('opens one tab per parameter and reuses it', async () => {
    const { root } = setup()
    await loaded(root)
    await openRow(root, '/myapp/prod/env')
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    expect(root.querySelector('.parameters').hidden).toBe(true)
    root.querySelector('.tab[data-tab="parameters"]').click()
    root.querySelector('.data-row[data-name="/myapp/prod/env"]').click()
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    expect(root.querySelector('.tab.is-active').dataset.tab).toBe('param:/myapp/prod/env')
  })

  it('asks before closing a tab with unsaved changes', async () => {
    const { root, ws } = setup()
    await loaded(root)
    await openRow(root, '/myapp/prod/env')
    edit(root)
    expect(ws.hasUnsavedChanges()).toBe(true)
    await vi.waitFor(() => expect(root.querySelector('.tab.is-dirty')).not.toBeNull())
    root.querySelector('.tab.is-active .tab__close').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="cancel"]').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).toBeNull())
    expect(titles(root)).toEqual(['Parameters', 'prod/env'])
    root.querySelector('.tab.is-active .tab__close').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="confirm"]').click()
    await vi.waitFor(() => expect(titles(root)).toEqual(['Parameters']))
    expect(ws.hasUnsavedChanges()).toBe(false)
  })

  it('filters the table when a folder is selected in the tree', async () => {
    const { root } = setup()
    await loaded(root)
    root.querySelector('.tree-row[data-path="/myapp"]').click()
    root.querySelector('.tree-row[data-path="/myapp/dev"]').click()
    expect([...root.querySelectorAll('.data-row')].map((r) => r.dataset.name)).toEqual(['/myapp/dev/env'])
  })

  it('hides create actions on read-only connections', async () => {
    const { root } = setup({ readOnly: true })
    await vi.waitFor(() => expect(root.querySelectorAll('.data-row')).toHaveLength(2))
    expect(root.querySelector('[data-action="create"]')).toBeNull()
    expect(root.querySelector('.sidebar .badge--readonly')).not.toBeNull()
  })

  it('opens a compare tab and hands disconnect and settings to the app', async () => {
    const { api, root, onDisconnect, openSettings } = setup()
    await loaded(root)
    root.querySelector('.sidebar [data-action="compare"]').click()
    await vi.waitFor(() => expect(titles(root)).toEqual(['Parameters', 'Compare']))
    expect(api.connections.list).toHaveBeenCalled()
    root.querySelector('[data-action="disconnect"]').click()
    root.querySelector('.tabbar-row [aria-label="Settings"]').click()
    expect(onDisconnect).toHaveBeenCalled()
    expect(openSettings).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/renderer/sidebar-tree.test.js test/renderer/workspace.test.js`
Expected: FAIL, because the modules do not exist.

- [ ] **Step 3: Implement the sidebar tree**

`src/renderer/views/sidebar-tree.js`:

```js
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
```

- [ ] **Step 4: Implement the workspace**

`src/renderer/views/workspace.js`:

```js
import '../styles/workspace.css'
import { clear, h } from '../lib/dom.js'
import { createTabModel } from '../tabs.js'
import { readOnlyBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'
import { confirmDialog } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'
import { createCompareTab } from './compare.js'
import { openCreateParameter } from './create-parameter.js'
import { createParameterTab } from './parameter.js'
import { createParametersTab } from './parameters.js'
import { createSidebarTree } from './sidebar-tree.js'

const PARAMETERS_TAB = 'parameters'

export function renderWorkspace(root, { api, connection, getSettings, openSettings, onDisconnect }) {
  const canWrite = !connection.readOnly
  const tabs = createTabModel([{ id: PARAMETERS_TAB, title: 'Parameters', icon: 'folder', closable: false }])
  const panels = new Map() // tab id → controller with { el, isDirty?, destroy? }
  let rows = []
  let compareCount = 0

  const parametersTab = createParametersTab({
    canWrite,
    onOpen: (row) => openParameter(row.name),
    onRefresh: () => reload(),
    onCreate: (prefix) => create(prefix),
    onClearPrefix: () => tree.setSelectedFolder('')
  })
  const tree = createSidebarTree({
    onSelectFolder: (path) => {
      parametersTab.setPrefix(path)
      tree.setSelectedFolder(path)
      tabs.activate(PARAMETERS_TAB)
    },
    onOpenLeaf: (name) => openParameter(name)
  })
  const tabBar = h('div', { class: 'tabbar', role: 'tablist' })
  const panelHost = h('div', { class: 'tabpanels' })
  addPanel(PARAMETERS_TAB, parametersTab)

  const layout = h(
    'div',
    { class: 'workspace' },
    h(
      'aside',
      { class: 'sidebar' },
      h(
        'div',
        { class: 'sidebar__connection', style: { '--conn-color': `var(--conn-${connection.color})` } },
        h(
          'div',
          { class: 'sidebar__conn-text' },
          h('span', { class: 'sidebar__conn-name', title: connection.name }, connection.name),
          h('span', { class: 'sidebar__conn-meta' }, `${connection.profile} · ${connection.region}`),
          connection.pathPrefix ? h('span', { class: 'sidebar__conn-meta mono', title: 'Path prefix' }, connection.pathPrefix) : null
        ),
        connection.readOnly ? readOnlyBadge() : null,
        h('button', { class: 'icon-btn icon-btn--sidebar', type: 'button', title: 'Disconnect', 'aria-label': 'Disconnect', dataset: { action: 'disconnect' }, onClick: () => onDisconnect() }, icon('logout'))
      ),
      h(
        'div',
        { class: 'sidebar__actions' },
        h('button', { class: 'btn btn--sidebar', type: 'button', dataset: { action: 'compare' }, onClick: () => openCompare() }, icon('compare', 14), 'Compare'),
        canWrite ? h('button', { class: 'btn btn--sidebar', type: 'button', dataset: { action: 'create' }, onClick: () => create('') }, icon('plus', 14), 'Create') : null
      ),
      h('div', { class: 'sidebar__filter' }, h('input', { class: 'input input--sidebar', type: 'search', placeholder: 'Filter parameters', 'aria-label': 'Filter parameters', onInput: (event) => tree.setQuery(event.target.value) })),
      tree.el
    ),
    h(
      'section',
      { class: 'workspace__main' },
      h('div', { class: 'tabbar-row' }, tabBar, h('button', { class: 'icon-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onClick: () => openSettings() }, icon('settings'))),
      panelHost
    )
  )

  clear(root).append(layout)
  const unsubscribe = tabs.subscribe(drawTabs)
  document.addEventListener('keydown', onKeydown)
  drawTabs()
  reload()

  return { reload, hasUnsavedChanges, destroy }

  function addPanel(id, controller) {
    panels.set(id, controller)
    panelHost.append(controller.el)
  }

  function removePanel(id) {
    const panel = panels.get(id)
    if (!panel) return
    panel.destroy?.()
    panel.el.remove()
    panels.delete(id)
  }

  function drawTabs() {
    tabBar.replaceChildren(...tabs.list().map(renderTab))
    for (const [id, panel] of panels) panel.el.hidden = id !== tabs.activeId
    const active = tabs.get(tabs.activeId)
    tree.setActiveLeaf(active?.kind === 'parameter' ? active.name : null)
  }

  function renderTab(tab) {
    const active = tab.id === tabs.activeId
    const dirty = panels.get(tab.id)?.isDirty?.() === true
    const close = (event) => {
      event.stopPropagation()
      closeTab(tab.id)
    }
    return h(
      'div',
      {
        class: ['tab', active && 'is-active', dirty && 'is-dirty'],
        role: 'tab',
        'aria-selected': String(active),
        title: tab.title,
        dataset: { tab: tab.id },
        onClick: () => tabs.activate(tab.id),
        onAuxclick: (event) => event.button === 1 && closeTab(tab.id)
      },
      tab.icon ? icon(tab.icon, 13) : null,
      h('span', { class: 'tab__title' }, tab.label ?? tab.title),
      dirty ? h('span', { class: 'tab__dirty', title: 'Unsaved changes' }) : null,
      tab.closable ? h('button', { class: 'tab__close', type: 'button', 'aria-label': `Close ${tab.title}`, onClick: close }, icon('close', 12)) : null
    )
  }

  function openParameter(name) {
    const id = `param:${name}`
    const meta = rows.find((r) => r.name === name)
    if (!panels.has(id)) {
      if (!meta) {
        toast({ kind: 'warning', message: `${name} is no longer in the list. Refreshing…` })
        reload()
        return
      }
      addPanel(id, createParameterTab({ api, connection, meta, getSettings, onDirtyChange: () => drawTabs(), onChanged: (event) => onParameterChanged(id, event) }))
    }
    tabs.open({ id, kind: 'parameter', name, title: name, label: shortLabel(name), icon: meta?.type === 'SecureString' ? 'lock' : 'file' })
  }

  async function onParameterChanged(id, event) {
    // A parameter deleted elsewhere keeps its tab while it holds unsaved text, so nothing is lost.
    const keepOpen = event.type === 'missing' && panels.get(id)?.isDirty?.()
    if (keepOpen) toast({ kind: 'warning', message: `${event.name} no longer exists. Your unsaved text is still in its tab.`, timeout: 0 })
    if ((event.type === 'deleted' || event.type === 'missing') && !keepOpen) {
      tabs.close(id)
      removePanel(id)
      drawTabs()
    }
    await reload()
  }

  async function closeTab(id) {
    const tab = tabs.get(id)
    if (!tab?.closable) return
    if (panels.get(id)?.isDirty?.()) {
      const discard = await confirmDialog({ title: 'Discard unsaved changes?', message: `${tab.title} has changes that are not saved.`, confirmLabel: 'Discard changes', kind: 'danger' })
      if (!discard) return
    }
    tabs.close(id)
    removePanel(id)
    drawTabs()
  }

  async function reload() {
    parametersTab.setLoading(true)
    try {
      rows = await api.ssm.list(connection.id)
      parametersTab.setRows(rows)
      tree.setRows(rows)
    } catch (err) {
      parametersTab.setError(err)
      toastError(err, 'Could not list parameters')
    }
  }

  function create(prefix) {
    openCreateParameter({
      api,
      connection,
      prefix: prefix || connection.pathPrefix,
      onCreated: async (name) => {
        await reload()
        openParameter(name)
      }
    })
  }

  async function openCompare() {
    let connections
    try {
      connections = await api.connections.list()
    } catch (err) {
      toastError(err, 'Could not load connections')
      return
    }
    compareCount += 1
    const id = `compare:${compareCount}`
    const active = tabs.get(tabs.activeId)
    const initial = { a: { connectionId: connection.id, name: active?.kind === 'parameter' ? active.name : '' }, b: { connectionId: connection.id, name: '' } }
    addPanel(id, createCompareTab({ api, connections, getSettings, initial }))
    tabs.open({ id, kind: 'compare', title: compareCount === 1 ? 'Compare' : `Compare ${compareCount}`, icon: 'compare' })
  }

  function hasUnsavedChanges() {
    return [...panels.values()].some((panel) => panel.isDirty?.() === true)
  }

  function onKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
      event.preventDefault()
      closeTab(tabs.activeId)
    }
  }

  function destroy() {
    unsubscribe()
    document.removeEventListener('keydown', onKeydown)
    for (const id of [...panels.keys()]) removePanel(id)
  }
}

function shortLabel(name) {
  return name.split('/').filter(Boolean).slice(-2).join('/') || name
}
```

`src/renderer/styles/workspace.css`:

```css
.workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  height: 100%;
}
.sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
}
.sidebar__connection {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 10px 14px 16px;
  border-bottom: 1px solid var(--sidebar-border);
  box-shadow: inset 4px 0 0 var(--conn-color);
}
.sidebar__conn-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.sidebar__conn-name {
  overflow: hidden;
  color: var(--white);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar__conn-meta {
  overflow: hidden;
  color: var(--sidebar-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn--sidebar {
  color: var(--sidebar-muted);
}
.icon-btn--sidebar:hover {
  background: var(--sidebar-active);
  color: var(--white);
}
.sidebar__actions {
  display: flex;
  gap: 8px;
  padding: 12px 14px 4px;
}
.btn--sidebar {
  flex: 1;
  height: 30px;
  border-color: var(--gray-dark2);
  background: transparent;
  color: var(--sidebar-text);
}
.btn--sidebar:hover:not(:disabled) {
  background: var(--sidebar-active);
}
.sidebar__filter {
  padding: 10px 14px;
}
.input--sidebar {
  height: 30px;
  border-color: var(--gray-dark2);
  background: var(--gray-dark4);
  color: var(--white);
}
.tree {
  flex: 1;
  min-height: 0;
  padding: 4px 6px 16px;
  overflow: auto;
}
.tree-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 8px 0 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--sidebar-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tree-row:hover {
  background: var(--sidebar-bg-hover);
}
.tree-row.is-selected {
  background: var(--sidebar-active);
  color: var(--white);
}
.tree-row.is-active {
  background: var(--sidebar-active);
  color: var(--green-base);
  box-shadow: inset 2px 0 0 var(--green-base);
}
.tree-row .icon {
  color: var(--sidebar-muted);
}
.tree-row--folder .icon--folder,
.tree-row--root .icon--folder {
  color: var(--green-dark1);
}
.tree-row--root {
  font-weight: 600;
}
.tree-row__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-row__count {
  color: var(--sidebar-muted);
  font-size: 11px;
}
.tree-empty {
  padding: 12px;
  color: var(--sidebar-muted);
}
.workspace__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}
.tabbar-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 10px 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-subtle);
}
.tabbar-row > .icon-btn {
  margin-bottom: 4px;
}
.tabbar {
  flex: 1;
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  height: 34px;
  padding: 0 8px 0 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--radius) var(--radius) 0 0;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: var(--bg-muted);
}
.tab.is-active {
  border-color: var(--border);
  background: var(--bg);
  color: var(--text);
  box-shadow: inset 0 2px 0 var(--green-dark1);
}
.tab__title {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab__dirty {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--yellow-base);
}
.tab__close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.tab__close:hover {
  background: var(--border);
  color: var(--text);
}
.tabpanels {
  position: relative;
  flex: 1;
  min-height: 0;
}
.tabpanels > * {
  position: absolute;
  inset: 0;
  overflow: auto;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/renderer/sidebar-tree.test.js test/renderer/workspace.test.js`
Expected: PASS (5 + 6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/views/sidebar-tree.js src/renderer/views/workspace.js src/renderer/styles/workspace.css test/renderer/sidebar-tree.test.js test/renderer/workspace.test.js
git commit -m "feat: add workspace with Compass sidebar tree, tabs, and parameter wiring

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 22: Settings dialog

**Files:**
- Create: `src/renderer/views/settings.js`
- Test: `test/renderer/settings.test.js`

**Interfaces:**
- Consumes: `h`, `field` (Task 12); `openModal`, `toast`, `toastError` (Task 13); `dialogs.css` (Task 18).
- Produces: `openSettings({ api, onSaved?(settings) }) → Promise<modal | null>`. It loads `settings.get()` and `profiles.list()` (for the default AWS file paths, which are shown as placeholders), and saves with `settings.save(draft)`.
  - Fields: `select[name=theme]`, `input[name=autoDecrypt]`, `input[name=maskValuesInDiff]`, `input[name=awsConfigFile]`, `input[name=awsCredentialsFile]`.

- [ ] **Step 1: Write the failing test**

`test/renderer/settings.test.js`:

```js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { openSettings } from '../../src/renderer/views/settings.js'

const settings = { theme: 'system', autoDecrypt: true, maskValuesInDiff: true, awsConfigFile: '', awsCredentialsFile: '' }
const q = (selector) => document.querySelector(`.modal ${selector}`)
function makeApi(save = vi.fn(async (draft) => draft)) {
  return {
    settings: { get: vi.fn(async () => ({ ...settings })), save },
    profiles: { list: vi.fn(async () => ({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials', profiles: [] })) }
  }
}

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('openSettings', () => {
  it('shows the current settings with the default AWS paths as placeholders', async () => {
    await openSettings({ api: makeApi() })
    expect(q('select[name="theme"]').value).toBe('system')
    expect(q('input[name="autoDecrypt"]').checked).toBe(true)
    expect(q('input[name="maskValuesInDiff"]').checked).toBe(true)
    expect(q('input[name="awsConfigFile"]').placeholder).toBe('/home/u/.aws/config')
  })

  it('saves the edited settings and reports them', async () => {
    const api = makeApi()
    const onSaved = vi.fn()
    await openSettings({ api, onSaved })
    const theme = q('select[name="theme"]')
    theme.value = 'dark'
    theme.dispatchEvent(new Event('change'))
    const auto = q('input[name="autoDecrypt"]')
    auto.checked = false
    auto.dispatchEvent(new Event('change'))
    const config = q('input[name="awsConfigFile"]')
    config.value = ' /tmp/aws-config '
    config.dispatchEvent(new Event('input'))
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.settings.save).toHaveBeenCalledWith({ ...settings, theme: 'dark', autoDecrypt: false, awsConfigFile: '/tmp/aws-config' })
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('stays open when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await openSettings({ api: makeApi(vi.fn(async () => Promise.reject(new Error('disk full')))) })
    q('[data-action="confirm"]').click()
    await vi.waitFor(() => expect(document.querySelector('.toast--error')).not.toBeNull())
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(q('[data-action="confirm"]').disabled).toBe(false)
  })

  it('returns null and toasts when settings cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = makeApi()
    api.settings.get = vi.fn(async () => Promise.reject(new Error('IPC closed')))
    expect(await openSettings({ api })).toBeNull()
    expect(document.querySelector('.toast--error').textContent).toContain('IPC closed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/settings.test.js`
Expected: FAIL, because `settings.js` does not exist.

- [ ] **Step 3: Implement the dialog**

`src/renderer/views/settings.js`:

```js
import '../styles/dialogs.css'
import { h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { openModal } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

export async function openSettings({ api, onSaved = () => {} }) {
  let settings
  let paths
  try {
    ;[settings, paths] = await Promise.all([api.settings.get(), api.profiles.list()])
  } catch (err) {
    toastError(err, 'Could not load settings')
    return null
  }

  const draft = { ...settings }
  const themeSelect = h('select', { class: 'input', name: 'theme', onChange: (event) => (draft.theme = event.target.value) }, h('option', { value: 'system' }, 'Match the system'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'))
  themeSelect.value = draft.theme
  const checkbox = (key, label, help) =>
    h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', name: key, checked: draft[key], onChange: (event) => (draft[key] = event.target.checked) }), h('span', {}, h('strong', {}, label), h('span', { class: 'field__help' }, help)))
  const pathInput = (key, placeholder) => h('input', { class: 'input mono', name: key, value: draft[key], placeholder, spellcheck: 'false', onInput: (event) => (draft[key] = event.target.value.trim()) })

  const body = h(
    'form',
    {
      class: 'settings-form',
      onSubmit: (event) => {
        event.preventDefault()
        save()
      }
    },
    h('h3', { class: 'settings-form__section' }, 'Appearance'),
    field('Theme', themeSelect),
    h('h3', { class: 'settings-form__section' }, 'Secrets'),
    checkbox('autoDecrypt', 'Decrypt SecureString values when a parameter opens', 'When this is off, encrypted values stay hidden until you click "Decrypt & show".'),
    checkbox('maskValuesInDiff', 'Mask values in diffs and comparisons', 'Values show as •••••••• until you reveal them.'),
    h('h3', { class: 'settings-form__section' }, 'AWS files'),
    field('Config file', pathInput('awsConfigFile', paths.configPath), 'Leave empty to use the AWS default.'),
    field('Credentials file', pathInput('awsCredentialsFile', paths.credentialsPath), 'Leave empty to use the AWS default.')
  )

  const modal = openModal({
    title: 'Settings',
    size: 'md',
    body,
    actions: [
      { id: 'cancel', label: 'Cancel', onClick: (m) => m.close() },
      { id: 'confirm', label: 'Save settings', kind: 'primary', onClick: () => save() }
    ]
  })
  return modal

  async function save() {
    modal.setBusy(true)
    try {
      const saved = await api.settings.save(draft)
      toast({ kind: 'success', message: 'Settings saved.' })
      modal.close()
      onSaved(saved)
    } catch (err) {
      modal.setBusy(false)
      toastError(err, 'Could not save settings')
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/settings.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/views/settings.js test/renderer/settings.test.js
git commit -m "feat: add settings dialog for theme, decryption, masking, and AWS file paths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Connections screen and app shell

**Files:**
- Create: `src/renderer/lib/regions.js`, `src/renderer/views/connections.js`, `src/renderer/styles/connections.css`
- Modify: `src/renderer/app.js` (replace the placeholder)
- Test: `test/renderer/connections.test.js`

**Interfaces:**
- Consumes: `CONNECTION_COLORS`, `DEFAULT_SETTINGS` (Task 7); `createApi` (Task 12); `applyTheme` (Task 12); `h`, `clear`, `field` (Task 12); `icon`, `readOnlyBadge`, `confirmDialog`, `toast`, `toastError`, `mountToasts` (Task 13); `renderWorkspace` (Task 21); `openSettings` (Task 22).
- Produces from `regions.js`: `AWS_REGIONS` (string array).
- Produces from `connections.js`: `renderConnectionsScreen(root, { api, onConnect(connection), openSettings() }) → { reload() }`.
  - Saved connections render as `li.connection-item[data-id]`.
  - Form fields: `input[name=name]`, `select[name=profile]`, `input[name=region]`, `input[name=pathPrefix]`, color swatches `button.color-swatch[data-color]`, and `input[name=readOnly]`.
  - Buttons carry `data-action` values `new`, `test`, `save`, `connect`, `delete`, and `settings`.
  - Connect saves pending edits first, so "Connect" also serves as "Save & connect".
- Produces from `app.js` (not unit-tested; covered by Task 24 e2e): boots toasts, theme, and the demo ribbon, then switches between the connections screen and the workspace.

- [ ] **Step 1: Write the failing test**

`test/renderer/connections.test.js`:

```js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountToasts } from '../../src/renderer/components/toast.js'
import { renderConnectionsScreen } from '../../src/renderer/views/connections.js'

const saved = [
  { id: 'c1', name: 'Prod', profile: 'default', region: 'sa-east-1', pathPrefix: '/myapp/prod', color: 'red', readOnly: true, createdAt: 'x' },
  { id: 'c2', name: 'Staging', profile: 'staging', region: 'us-east-1', pathPrefix: '', color: 'green', readOnly: false, createdAt: 'y' }
]
const profiles = [
  { name: 'default', region: 'sa-east-1', sources: ['config', 'credentials'], sso: false },
  { name: 'staging', region: 'us-east-1', sources: ['config'], sso: false },
  { name: 'sso-dev', region: 'us-west-2', sources: ['config'], sso: true }
]

function setup({ connections = saved, profileList = profiles } = {}) {
  let store = connections.map((c) => ({ ...c }))
  const api = {
    connections: {
      list: vi.fn(async () => store.map((c) => ({ ...c }))),
      save: vi.fn(async (draft) => {
        const conn = { ...draft, id: draft.id ?? 'c_new', name: draft.name.trim(), createdAt: 'z' }
        store = store.some((c) => c.id === conn.id) ? store.map((c) => (c.id === conn.id ? conn : c)) : [...store, conn]
        return conn
      }),
      delete: vi.fn(async (id) => {
        store = store.filter((c) => c.id !== id)
        return { deleted: true }
      }),
      test: vi.fn(async () => ({ ok: true }))
    },
    profiles: { list: vi.fn(async () => ({ configPath: '/home/u/.aws/config', credentialsPath: '/home/u/.aws/credentials', profiles: profileList })) }
  }
  const root = document.createElement('div')
  document.body.append(root)
  const onConnect = vi.fn()
  const openSettings = vi.fn()
  renderConnectionsScreen(root, { api, onConnect, openSettings })
  return { api, root, onConnect, openSettings }
}
const items = (root) => [...root.querySelectorAll('.connection-item')]
const input = (root, name) => root.querySelector(`[name="${name}"]`)
const action = (root, id) => root.querySelector(`[data-action="${id}"]`)
const type = (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('input'))
}
const choose = (el, value) => {
  el.value = value
  el.dispatchEvent(new Event('change'))
}
const ready = (root) => vi.waitFor(() => expect(items(root)).toHaveLength(2))

beforeEach(() => {
  document.body.replaceChildren()
  mountToasts()
})

describe('renderConnectionsScreen', () => {
  it('lists saved connections and edits the first one', async () => {
    const { root } = setup()
    await ready(root)
    expect(items(root).map((li) => li.querySelector('.connection-item__name').textContent)).toEqual(['Prod', 'Staging'])
    expect(items(root)[0].classList.contains('is-selected')).toBe(true)
    expect(items(root)[0].querySelector('.badge--readonly')).not.toBeNull()
    expect(input(root, 'name').value).toBe('Prod')
    expect(input(root, 'profile').value).toBe('default')
    expect(input(root, 'pathPrefix').value).toBe('/myapp/prod')
    expect(input(root, 'readOnly').checked).toBe(true)
    expect(root.querySelector('h1').textContent).toBe('Edit connection')
  })

  it('starts a new connection with the first profile and its region', async () => {
    const { root } = setup()
    await ready(root)
    action(root, 'new').click()
    expect(root.querySelector('h1').textContent).toBe('New connection')
    expect(input(root, 'name').value).toBe('')
    expect(input(root, 'profile').value).toBe('default')
    expect(input(root, 'region').value).toBe('sa-east-1')
    expect(action(root, 'connect').textContent).toBe('Save & connect')
  })

  it("updates the region when the profile changes, unless the user typed one", async () => {
    const { root } = setup()
    await ready(root)
    action(root, 'new').click()
    choose(input(root, 'profile'), 'sso-dev')
    expect(input(root, 'region').value).toBe('us-west-2')
    type(input(root, 'region'), 'eu-west-1')
    choose(input(root, 'profile'), 'staging')
    expect(input(root, 'region').value).toBe('eu-west-1')
  })

  it('saves edits and keeps the saved connection selected', async () => {
    const { api, root } = setup()
    await ready(root)
    type(input(root, 'name'), 'Production')
    root.querySelector('.color-swatch[data-color="blue"]').click()
    action(root, 'save').click()
    await vi.waitFor(() => expect(items(root)[0].querySelector('.connection-item__name').textContent).toBe('Production'))
    expect(api.connections.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'Production', color: 'blue' }))
    expect(items(root)[0].classList.contains('is-selected')).toBe(true)
  })

  it('connects without saving when nothing changed, and saves first otherwise', async () => {
    const { api, root, onConnect } = setup()
    await ready(root)
    action(root, 'connect').click()
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith(saved[0]))
    expect(api.connections.save).not.toHaveBeenCalled()

    items(root)[1].click()
    type(input(root, 'pathPrefix'), '/billing')
    action(root, 'connect').click()
    await vi.waitFor(() => expect(onConnect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c2', pathPrefix: '/billing' })))
    expect(api.connections.save).toHaveBeenCalledTimes(1)
  })

  it('connects on double click', async () => {
    const { root, onConnect } = setup()
    await ready(root)
    items(root)[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await vi.waitFor(() => expect(onConnect).toHaveBeenCalledWith(saved[1]))
  })

  it('tests the draft connection and reports success', async () => {
    const { api, root } = setup()
    await ready(root)
    action(root, 'test').click()
    await vi.waitFor(() => expect(document.querySelector('.toast--success')).not.toBeNull())
    expect(api.connections.test).toHaveBeenCalledWith(expect.objectContaining({ profile: 'default', region: 'sa-east-1', pathPrefix: '/myapp/prod' }))
  })

  it('deletes a connection after confirmation', async () => {
    const { api, root } = setup()
    await ready(root)
    action(root, 'delete').click()
    await vi.waitFor(() => expect(document.querySelector('.modal')).not.toBeNull())
    document.querySelector('.modal [data-action="confirm"]').click()
    await vi.waitFor(() => expect(items(root)).toHaveLength(1))
    expect(api.connections.delete).toHaveBeenCalledWith('c1')
  })

  it('warns when no AWS profiles exist and shows the checked paths', async () => {
    const { root } = setup({ connections: [], profileList: [] })
    await vi.waitFor(() => expect(root.querySelector('.callout--warning')).not.toBeNull())
    expect(root.querySelector('.callout--warning').textContent).toContain('/home/u/.aws/credentials')
    expect(root.querySelector('.connection-list').textContent).toContain('No saved connections yet.')
  })

  it('opens settings', async () => {
    const { root, openSettings } = setup()
    await ready(root)
    action(root, 'settings').click()
    expect(openSettings).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/renderer/connections.test.js`
Expected: FAIL, because `connections.js` does not exist.

- [ ] **Step 3: Implement the regions list and the connections screen**

`src/renderer/lib/regions.js`:

```js
// Regions where SSM Parameter Store is available; the field still accepts any region.
export const AWS_REGIONS = Object.freeze([
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'af-south-1', 'ap-east-1', 'ap-south-1', 'ap-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ca-central-1', 'ca-west-1',
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-north-1', 'eu-south-1', 'eu-south-2',
  'il-central-1', 'me-south-1', 'me-central-1', 'sa-east-1'
])
```

`src/renderer/views/connections.js`:

```js
import '../styles/connections.css'
import { CONNECTION_COLORS } from '@shared/settings.js'
import { clear, h } from '../lib/dom.js'
import { field } from '../lib/form.js'
import { AWS_REGIONS } from '../lib/regions.js'
import { readOnlyBadge } from '../components/badges.js'
import { icon } from '../components/icons.js'
import { confirmDialog } from '../components/modal.js'
import { toast, toastError } from '../components/toast.js'

const FIELDS = ['name', 'profile', 'region', 'pathPrefix', 'color', 'readOnly']
const blank = () => ({ id: null, name: '', profile: '', region: '', pathPrefix: '', color: 'none', readOnly: false })

export function renderConnectionsScreen(root, { api, onConnect, openSettings }) {
  const state = { connections: [], profiles: [], paths: null, selectedId: null, draft: blank(), busy: false }
  const list = h('ul', { class: 'connection-list', role: 'listbox', 'aria-label': 'Saved connections' })
  const formHost = h('div', { class: 'connection-form' })

  clear(root).append(
    h(
      'div',
      { class: 'connections-screen' },
      h(
        'aside',
        { class: 'connections-sidebar' },
        h('div', { class: 'brand' }, h('span', { class: 'brand__mark' }, icon('key', 18)), h('span', { class: 'brand__name' }, 'Vault Manager')),
        h('button', { class: 'btn btn--primary btn--block', type: 'button', dataset: { action: 'new' }, onClick: () => select(null) }, icon('plus', 14), 'New connection'),
        h('h3', { class: 'sidebar-heading' }, 'Saved connections'),
        list
      ),
      h('main', { class: 'connections-main' }, h('div', { class: 'connections-main__top' }, h('button', { class: 'icon-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', dataset: { action: 'settings' }, onClick: () => openSettings() }, icon('settings'))), formHost)
    )
  )
  load()
  return { reload: () => load() }

  async function load(selectId = state.selectedId) {
    try {
      const [connections, profileInfo] = await Promise.all([api.connections.list(), api.profiles.list()])
      Object.assign(state, { connections, profiles: profileInfo.profiles, paths: profileInfo })
      const target = connections.find((c) => c.id === selectId) ?? connections[0] ?? null
      select(target?.id ?? null)
    } catch (err) {
      toastError(err, 'Could not load connections')
      draw()
    }
  }

  function select(id) {
    const connection = state.connections.find((c) => c.id === id) ?? null
    state.selectedId = connection?.id ?? null
    state.draft = connection ? { ...connection } : { ...blank(), profile: state.profiles[0]?.name ?? '', region: state.profiles[0]?.region ?? '' }
    draw()
  }

  function draw() {
    drawList()
    drawForm()
  }

  function drawList() {
    if (state.connections.length === 0) {
      list.replaceChildren(h('li', { class: 'connection-list__empty' }, 'No saved connections yet.'))
      return
    }
    list.replaceChildren(
      ...state.connections.map((connection) => {
        const selected = connection.id === state.selectedId
        const stop = (fn) => (event) => {
          event.stopPropagation()
          fn(connection)
        }
        return h(
          'li',
          {
            class: ['connection-item', selected && 'is-selected'],
            role: 'option',
            'aria-selected': String(selected),
            tabindex: '0',
            dataset: { id: connection.id },
            onClick: () => select(connection.id),
            onDblclick: () => connect(connection),
            onKeydown: (event) => event.key === 'Enter' && connect(connection)
          },
          h('span', { class: 'color-dot', style: { background: `var(--conn-${connection.color})` } }),
          h('span', { class: 'connection-item__text' }, h('span', { class: 'connection-item__name' }, connection.name), h('span', { class: 'connection-item__meta' }, `${connection.profile} · ${connection.region}`)),
          connection.readOnly ? readOnlyBadge() : null,
          h(
            'span',
            { class: 'connection-item__actions' },
            h('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Duplicate', 'aria-label': `Duplicate ${connection.name}`, onClick: stop(duplicate) }, icon('copy', 14)),
            h('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: 'Delete', 'aria-label': `Delete ${connection.name}`, onClick: stop(remove) }, icon('trash', 14))
          )
        )
      })
    )
  }

  function drawForm() {
    const d = state.draft
    const isNew = !d.id
    const set = (key) => (event) => {
      state.draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }

    const profileSelect = h(
      'select',
      { class: 'input', name: 'profile', onChange: (event) => changeProfile(event.target.value) },
      h('option', { value: '', disabled: true }, state.profiles.length ? 'Choose a profile' : 'No profiles found'),
      state.profiles.map((p) => h('option', { value: p.name }, `${p.name}${p.sso ? ' (SSO)' : ''}${p.region ? ` — ${p.region}` : ''}`))
    )
    profileSelect.value = d.profile

    const swatches = h(
      'div',
      { class: 'color-picker', role: 'radiogroup', 'aria-label': 'Color' },
      CONNECTION_COLORS.map((color) =>
        h('button', {
          class: ['color-swatch', `color-swatch--${color}`, d.color === color && 'is-selected'],
          type: 'button',
          role: 'radio',
          'aria-checked': String(d.color === color),
          'aria-label': color,
          title: color,
          dataset: { color },
          style: { background: color === 'none' ? 'transparent' : `var(--conn-${color})` },
          onClick: () => {
            state.draft.color = color
            drawForm()
          }
        })
      )
    )

    const banner =
      state.paths && state.profiles.length === 0
        ? h(
            'div',
            { class: 'callout callout--warning' },
            icon('warning', 16),
            h('div', {}, h('strong', {}, 'No AWS profiles found. '), 'Checked ', h('code', {}, state.paths.configPath), ' and ', h('code', {}, state.paths.credentialsPath), '. Configure the AWS CLI, or set custom paths in Settings.')
          )
        : null

    formHost.replaceChildren(
      h(
        'form',
        {
          class: 'card connection-card',
          onSubmit: (event) => {
            event.preventDefault()
            connect()
          }
        },
        h('header', { class: 'connection-card__header' }, h('h1', {}, isNew ? 'New connection' : 'Edit connection'), h('p', { class: 'muted' }, 'Connections use the AWS profiles on this machine. Vault Manager never stores credentials.')),
        banner,
        field('Name', h('input', { class: 'input', name: 'name', value: d.name, placeholder: 'e.g. Production', autocomplete: 'off', onInput: set('name') })),
        h(
          'div',
          { class: 'field-row' },
          field('AWS profile', profileSelect),
          field('Region', h('div', {}, h('input', { class: 'input', name: 'region', value: d.region, list: 'aws-regions', placeholder: 'sa-east-1', spellcheck: 'false', autocomplete: 'off', onInput: set('region') }), h('datalist', { id: 'aws-regions' }, AWS_REGIONS.map((r) => h('option', { value: r })))))
        ),
        field('Path prefix', h('input', { class: 'input mono', name: 'pathPrefix', value: d.pathPrefix, placeholder: '/myapp/prod', spellcheck: 'false', autocomplete: 'off', onInput: set('pathPrefix') }), 'Optional. Only parameters whose name starts with this text are listed.'),
        field('Color', swatches),
        h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', name: 'readOnly', checked: d.readOnly, onChange: set('readOnly') }), h('span', {}, h('strong', {}, 'Read-only'), h('span', { class: 'field__help' }, 'Hide every action that changes parameters. Recommended for production.'))),
        h(
          'footer',
          { class: 'connection-card__footer' },
          isNew ? null : h('button', { class: 'btn btn--ghost-danger', type: 'button', dataset: { action: 'delete' }, onClick: () => remove(state.connections.find((c) => c.id === d.id)) }, icon('trash', 14), 'Delete'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'test' }, onClick: () => test() }, 'Test connection'),
          h('button', { class: 'btn btn--default', type: 'button', dataset: { action: 'save' }, onClick: () => save() }, 'Save'),
          h('button', { class: 'btn btn--primary', type: 'submit', dataset: { action: 'connect' } }, isNew ? 'Save & connect' : 'Connect')
        )
      )
    )
  }

  function changeProfile(name) {
    const previous = state.profiles.find((p) => p.name === state.draft.profile)
    const next = state.profiles.find((p) => p.name === name)
    // Follow the profile's default region unless the user typed a different one.
    if (!state.draft.region || state.draft.region === previous?.region) state.draft.region = next?.region ?? state.draft.region
    state.draft.profile = name
    drawForm()
  }

  async function save({ quiet = false } = {}) {
    if (state.busy) return null
    state.busy = true
    try {
      const saved = await api.connections.save(state.draft)
      state.connections = await api.connections.list()
      state.selectedId = saved.id
      state.draft = { ...saved }
      draw()
      if (!quiet) toast({ kind: 'success', message: `Saved "${saved.name}".` })
      return saved
    } catch (err) {
      toastError(err, 'Could not save the connection')
      return null
    } finally {
      state.busy = false
    }
  }

  async function connect(connection = null) {
    const stored = state.connections.find((c) => c.id === state.draft.id)
    const unchanged = stored && FIELDS.every((key) => stored[key] === state.draft[key])
    const target = connection ?? (unchanged ? stored : await save({ quiet: true }))
    if (target) onConnect(target)
  }

  async function test() {
    const button = formHost.querySelector('[data-action="test"]')
    button.disabled = true
    button.textContent = 'Testing…'
    try {
      await api.connections.test(state.draft)
      toast({ kind: 'success', title: 'Connection works', message: `Profile "${state.draft.profile}" can list parameters in ${state.draft.region}.` })
    } catch (err) {
      toastError(err, 'Connection failed')
    } finally {
      button.disabled = false
      button.textContent = 'Test connection'
    }
  }

  function duplicate(connection) {
    state.selectedId = null
    state.draft = { ...connection, id: null, name: `${connection.name} (copy)` }
    draw()
  }

  async function remove(connection) {
    if (!connection) return
    const confirmed = await confirmDialog({ title: 'Delete connection?', message: `"${connection.name}" will be removed from Vault Manager. Your AWS profile and parameters are not touched.`, confirmLabel: 'Delete', kind: 'danger' })
    if (!confirmed) return
    try {
      await api.connections.delete(connection.id)
      toast({ kind: 'success', message: `Deleted "${connection.name}".` })
      await load(state.selectedId === connection.id ? null : state.selectedId)
    } catch (err) {
      toastError(err, 'Could not delete the connection')
    }
  }
}
```

`src/renderer/styles/connections.css`:

```css
.connections-screen {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: 100%;
}
.connections-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px;
  overflow: auto;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 6px 10px;
}
.brand__mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--green-dark2);
  color: var(--green-base);
}
.brand__name {
  color: var(--white);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sidebar-heading {
  margin-top: 8px;
  padding: 0 6px;
  color: var(--sidebar-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.connection-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.connection-list__empty {
  padding: 8px 6px;
  color: var(--sidebar-muted);
}
.connection-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius);
  outline: none;
  cursor: pointer;
}
.connection-item:hover {
  background: var(--sidebar-bg-hover);
}
.connection-item.is-selected {
  background: var(--sidebar-active);
}
.color-dot {
  flex: none;
  width: 10px;
  height: 10px;
  border: 1px solid rgb(255 255 255 / 0.25);
  border-radius: 50%;
}
.connection-item__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.connection-item__name,
.connection-item__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.connection-item__name {
  color: var(--white);
  font-weight: 500;
}
.connection-item__meta {
  color: var(--sidebar-muted);
  font-size: 12px;
}
.connection-item__actions {
  display: none;
  gap: 2px;
}
.connection-item:hover .connection-item__actions,
.connection-item.is-selected .connection-item__actions {
  display: flex;
}
.connection-item .icon-btn {
  color: var(--sidebar-muted);
}
.connection-item .icon-btn:hover {
  background: var(--gray-dark2);
  color: var(--white);
}
.connections-main {
  position: relative;
  padding: 48px 32px;
  overflow: auto;
  background: var(--bg-subtle);
}
.connections-main__top {
  position: absolute;
  top: 12px;
  right: 16px;
}
.connection-form {
  max-width: 640px;
  margin: 0 auto;
}
.connection-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 28px 32px;
}
.connection-card__header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.connection-card__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.color-picker {
  display: flex;
  gap: 8px;
}
.color-swatch {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  cursor: pointer;
}
.color-swatch--none {
  background-image: linear-gradient(135deg, transparent 44%, var(--red-base) 44%, var(--red-base) 56%, transparent 56%) !important;
}
.color-swatch.is-selected {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--green-dark1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/renderer/connections.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Replace the app shell**

`src/renderer/app.js`:

```js
import './styles/tokens.css'
import './styles/base.css'
import { DEFAULT_SETTINGS } from '@shared/settings.js'
import { createApi } from './api.js'
import { h } from './lib/dom.js'
import { applyTheme } from './theme.js'
import { confirmDialog } from './components/modal.js'
import { mountToasts, toast, toastError } from './components/toast.js'
import { renderConnectionsScreen } from './views/connections.js'
import { openSettings } from './views/settings.js'
import { renderWorkspace } from './views/workspace.js'

const root = document.getElementById('app')
const api = createApi(window.vault)
let settings = { ...DEFAULT_SETTINGS }
let disposeTheme = () => {}
let workspace = null
let connectionsScreen = null

function applySettings(next) {
  settings = next
  disposeTheme()
  disposeTheme = applyTheme(settings.theme)
}

// New AWS file paths change the profile list, so the connections screen reloads after a save.
const openSettingsDialog = () =>
  openSettings({
    api,
    onSaved: (saved) => {
      applySettings(saved)
      connectionsScreen?.reload()
    }
  })

function showConnections() {
  workspace?.destroy()
  workspace = null
  connectionsScreen = renderConnectionsScreen(root, { api, onConnect: showWorkspace, openSettings: openSettingsDialog })
}

function showWorkspace(connection) {
  connectionsScreen = null
  workspace = renderWorkspace(root, {
    api,
    connection,
    getSettings: () => settings,
    openSettings: openSettingsDialog,
    onDisconnect: async () => {
      if (workspace?.hasUnsavedChanges()) {
        const discard = await confirmDialog({ title: 'Disconnect?', message: 'Some parameters have unsaved changes. Disconnecting discards them.', confirmLabel: 'Discard and disconnect', kind: 'danger' })
        if (!discard) return
      }
      showConnections()
    }
  })
}

async function start() {
  mountToasts()
  applySettings(settings)
  try {
    const [info, loaded] = await Promise.all([api.app.info(), api.settings.get()])
    applySettings(loaded)
    if (info.fake) {
      document.body.classList.add('is-demo')
      document.body.prepend(h('div', { class: 'demo-banner' }, 'DEMO MODE: fake data, nothing here touches AWS'))
    }
    for (const message of info.warnings) toast({ kind: 'warning', message, timeout: 0 })
  } catch (err) {
    toastError(err, 'Could not load settings')
  }
  showConnections()
}

start()
```

- [ ] **Step 6: Run everything and try the demo**

Run: `npm test && npm run build`
Expected: all unit and renderer suites pass, and the build succeeds.

Then run `npm run demo` by hand. Expected:
1. A yellow "DEMO MODE" bar appears across the top, along with the two seeded demo connections.
2. Double-clicking "Demo — all parameters" opens the workspace with 19 parameters, a navy sidebar tree, and Compass-style tabs.
3. Opening `/myapp/staging/env` shows highlighted `.env` text. Changing `APP_DEBUG` and pressing `Ctrl+S` shows a one-key diff, and saving bumps the version to 3.
4. Settings → Theme → Dark switches the whole UI, including the editor.

Close the app.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/regions.js src/renderer/views/connections.js src/renderer/styles/connections.css src/renderer/app.js test/renderer/connections.test.js
git commit -m "feat: add Compass-style connections screen and wire the app shell

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 24: End-to-end tests against the fake backend

**Files:**
- Create: `test/e2e/helpers.js`, `test/e2e/smoke.spec.js`, `test/e2e/readonly.spec.js`, `test/e2e/create-delete.spec.js`, `test/e2e/compare.spec.js`

**Interfaces:**
- Consumes: the built app (`out/main/index.js`); `VAULT_FAKE_SSM=1` and `VAULT_USER_DATA` (Task 11); the seed data (Task 10: 19 parameters, connections "Demo — all parameters" and "Demo — production (read-only)"); the DOM hooks from Tasks 17–23.
- Produces: `npm run test:e2e`, which builds the app and runs four Playwright Electron specs. A window opens briefly on the desktop for each spec, because the local machine has `DISPLAY=:0` and no `xvfb`.

- [ ] **Step 1: Write the helpers and the specs**

`test/e2e/helpers.js`:

```js
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every spec gets its own fake backend and an empty userData folder, so no state leaks.
export async function launchDemo() {
  const userData = mkdtempSync(join(tmpdir(), 'vault-e2e-'))
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, VAULT_FAKE_SSM: '1', VAULT_USER_DATA: userData } })
  const page = await app.firstWindow()
  await page.locator('.connections-screen').waitFor()
  return {
    app,
    page,
    async close() {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  }
}

export async function connect(page, name) {
  await page.locator('.connection-item', { hasText: name }).click()
  await page.locator('[data-action="connect"]').click()
  await page.locator('.workspace .data-row').first().waitFor()
}

export async function openParameter(page, name) {
  await page.locator(`.data-row[data-name="${name}"]`).click()
  await page.locator('.param:not([hidden]) .cm-content').waitFor()
}

// Replaces the editor line containing `marker` by typing, the way a person would.
export async function replaceLine(page, marker, text) {
  await page.locator('.param:not([hidden]) .cm-line', { hasText: marker }).first().click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type(text)
}
```

`test/e2e/smoke.spec.js`:

```js
import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter, replaceLine } from './helpers.js'

test('edit a .env parameter, review the diff, save, and find the old version in history', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await expect(page.locator('.parameters__count')).toHaveText('19 parameters')

    await openParameter(page, '/myapp/staging/env')
    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('.param__version')).toHaveText('Version 2')

    await replaceLine(page, 'APP_DEBUG=', 'APP_DEBUG=false')
    await expect(param.locator('.param__dirty')).toBeVisible()
    await page.keyboard.press('Control+S')

    const modal = page.locator('.modal')
    await expect(modal.locator('.diff__row')).toHaveCount(1)
    await expect(modal.locator('.diff__row')).toHaveAttribute('data-key', 'APP_DEBUG')
    await expect(modal.locator('.diff-chip--changed')).toHaveText('~1 changed')
    await modal.locator('[data-action="confirm"]').click()

    await expect(param.locator('.param__version')).toHaveText('Version 3')
    await expect(page.locator('.toast--success')).toContainText('version 3')
    await expect(param.locator('.param__dirty')).toBeHidden()

    await param.locator('[data-subtab="history"]').click()
    await expect(param.locator('.history__item')).toHaveCount(3)
    await expect(param.locator('.history__item').first()).toContainText('Current')
  } finally {
    await demo.close()
  }
})
```

`test/e2e/readonly.spec.js`:

```js
import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter } from './helpers.js'

test('a read-only connection lists only its prefix and offers no write actions', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — production (read-only)')
    await expect(page.locator('.parameters__count')).toHaveText('5 parameters')
    await expect(page.locator('[data-action="create"]')).toHaveCount(0)

    await openParameter(page, '/myapp/prod/env')
    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('[data-action="save"]')).toHaveCount(0)
    await expect(param.locator('[data-action="delete"]')).toHaveCount(0)
    await expect(param.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  } finally {
    await demo.close()
  }
})
```

`test/e2e/create-delete.spec.js`:

```js
import { expect, test } from '@playwright/test'
import { connect, launchDemo } from './helpers.js'

test('create a parameter, then delete it', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await page.locator('.sidebar [data-action="create"]').click()

    const modal = page.locator('.modal')
    await modal.locator('input[name="name"]').fill('/e2e/new/env')
    await modal.locator('.cm-content').click()
    await page.keyboard.type('E2E=1')
    await modal.locator('[data-action="confirm"]').click()

    const param = page.locator('.param:not([hidden])')
    await expect(param.locator('h2')).toHaveText('/e2e/new/env')
    await expect(param.locator('.param__version')).toHaveText('Version 1')
    await expect(page.locator('.parameters__count')).toHaveText('20 parameters')

    await param.locator('[data-action="delete"]').click()
    await page.locator('.modal input').fill('/e2e/new/env')
    await page.locator('.modal [data-action="confirm"]').click()

    await expect(page.locator('.tab', { hasText: 'new/env' })).toHaveCount(0)
    await expect(page.locator('.data-row[data-name="/e2e/new/env"]')).toHaveCount(0)
    await expect(page.locator('.parameters__count')).toHaveText('19 parameters')
  } finally {
    await demo.close()
  }
})
```

`test/e2e/compare.spec.js`:

```js
import { expect, test } from '@playwright/test'
import { connect, launchDemo, openParameter } from './helpers.js'

test('compare the production and staging .env files', async () => {
  const demo = await launchDemo()
  const { page } = demo
  try {
    await connect(page, 'Demo — all parameters')
    await openParameter(page, '/myapp/prod/env')
    await page.locator('.sidebar [data-action="compare"]').click()

    const compare = page.locator('.compare:not([hidden])')
    await expect(compare.locator('input[aria-label="Parameter A"]')).toHaveValue('/myapp/prod/env')
    await compare.locator('input[aria-label="Parameter B"]').fill('/myapp/staging/env')
    await compare.locator('[data-action="compare"]').click()

    await expect(compare.locator('.diff-chip')).toHaveText(['6 different', '1 only in A', '1 only in B', '6 equal'])
    await compare.locator('.diff__toggle').click()
    await expect(compare.locator('.diff__row[data-key="SENTRY_DSN"]')).toContainText('https://public@sentry.example.com/1')
  } finally {
    await demo.close()
  }
})
```

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: the build succeeds and `4 passed`. If a spec fails, run it alone with `npx playwright test test/e2e/<name>.spec.js --reporter=line` and fix the app, not the assertion, unless the assertion contradicts the spec. Nothing in these runs touches AWS: `VAULT_FAKE_SSM=1` is set by `launchDemo()`.

- [ ] **Step 3: Commit**

```bash
git add test/e2e
git commit -m "test: add Electron end-to-end specs against the fake SSM backend

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Packaging, README, and the manual AWS checklist

**Files:**
- Create: `electron-builder.yml`, `README.md`

**Interfaces:**
- Consumes: the whole app.
- Produces: `npm run dist` (Linux AppImage + deb in `dist/`), and a README with setup, scripts, IAM permissions, and a manual checklist for real AWS.

- [ ] **Step 1: Add the packaging config**

`electron-builder.yml`:

```yaml
appId: com.vaultmanager.app
productName: Vault Manager
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - package.json
asar: true
linux:
  target:
    - AppImage
    - deb
  category: Development
  maintainer: Leonardo Lemos <leonardo.lemos@convenia.com.br>
  synopsis: Desktop client for AWS SSM Parameter Store
```

- [ ] **Step 2: Write the README**

`README.md`:

````markdown
# Vault Manager

A desktop client for **AWS Systems Manager Parameter Store** that looks like MongoDB Compass.
It lists every parameter with the same columns as the AWS console and edits values as `.env` text.
It also shows a diff before every save, browses version history, and compares two parameters,
even across AWS accounts.

Plain JavaScript on Electron, electron-vite, CodeMirror 6, and the AWS SDK v3.

## Requirements

- Node.js 20.19 or newer
- AWS profiles in `~/.aws/config` and/or `~/.aws/credentials` (static keys and SSO both work)

## Getting started

```bash
npm install
npm run demo   # fake in-memory data, never touches AWS
npm run dev    # real AWS, using your local profiles
```

1. Create a **connection**: a name, an AWS profile, a region, an optional path prefix, a color,
   and optionally **Read-only**. Read-only is recommended for production.
2. **Connect** to browse parameters. Click a row or a tree leaf to open it in a tab.
3. Edit the value and press **Ctrl+S**. Review the diff and save a new version.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run against real AWS with hot reload |
| `npm run demo` | Run with the fake backend (`VAULT_FAKE_SSM=1`) |
| `npm run build` | Build main, preload, and renderer into `out/` |
| `npm start` | Run the built app (real AWS) |
| `npm test` | Unit and renderer tests (Vitest) |
| `npm run test:e2e` | Build, then the Playwright Electron tests (fake backend) |
| `npm run dist` | Build a Linux AppImage and `.deb` into `dist/` |

## IAM permissions

Reading needs `ssm:DescribeParameters`, `ssm:GetParameter`, `ssm:GetParameterHistory`,
`ssm:ListTagsForResource`, and `kms:Decrypt` for SecureStrings that use a customer-managed key.

Writing also needs `ssm:PutParameter`, `ssm:DeleteParameter`, and `kms:Encrypt`
(again, only for customer-managed keys).

## Security

- Credentials stay in your AWS files. The app stores only connection names, profile names,
  regions, and display settings, in Electron's `userData` folder.
- Only the main process talks to AWS. The UI runs sandboxed, with context isolation and a
  strict Content Security Policy.
- Values are never logged. Diffs and comparisons mask values until you reveal them, and you can
  turn this off in Settings.

## Manual checklist against real AWS

Automated tests never call AWS. Before trusting a build, go through this list with a
non-production profile:

- [ ] Connections: profiles from both `config` and `credentials` appear; **Test connection** succeeds; a wrong region shows a clear error.
- [ ] The list matches the AWS console: count, Name, Tier, Type, Data type, Version, Last modified, Last modified user, and Description.
- [ ] Pagination: an account with more than 50 parameters lists all of them.
- [ ] A path prefix on the connection limits the list.
- [ ] Opening a SecureString shows the decrypted value. With **auto-decrypt** off it shows "Decrypt & show".
- [ ] Editing and saving creates a new version in the console, with the same KMS key, description, and tier.
- [ ] Editing the same parameter in the console while the tab is open, then saving, shows the conflict dialog.
- [ ] A value over 4 KB on a Standard parameter asks to upgrade to Advanced, and the console shows Advanced afterwards.
- [ ] History lists every version. **Restore** puts an old value in the editor, and saving creates a new version.
- [ ] Create and delete work, and deleting requires typing the full name.
- [ ] Compare works across two connections that use different AWS accounts.
- [ ] A read-only connection shows no Save, Create, or Delete actions.
- [ ] An expired SSO session shows the `aws sso login --profile …` hint.
- [ ] A profile without `ssm:PutParameter` shows "Not allowed to write on …".
````

- [ ] **Step 3: Run the final verification**

Run:

```bash
npm test
npm run test:e2e
npm run build
npm run dist
```

Expected:
- All Vitest suites pass.
- The 4 Playwright specs pass.
- `out/` builds.
- `dist/` contains a `.AppImage` and a `.deb`.

`npm run dist` downloads Electron and packaging tools the first time. If the machine is offline, note that in the hand-off instead of skipping silently.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml README.md
git commit -m "docs: add README, IAM permissions, manual AWS checklist, and Linux packaging

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
