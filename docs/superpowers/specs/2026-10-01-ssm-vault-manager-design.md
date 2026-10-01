# Vault Manager — AWS SSM Parameter Store desktop client

Date: 2026-10-01
Status: Approved design, pending spec review

## 1. Goal

A desktop app (Electron) for browsing and editing AWS Systems Manager Parameter Store
parameters with the AWS profiles already configured on the machine. It mirrors the
information the AWS console shows, edits parameter values as `.env` text, and follows
the MongoDB Compass visual design.

### What the user asked for

1. List all Parameter Store parameters, mimicking the AWS console information.
2. A configuration area to choose the AWS profile, plus other useful settings.
3. Clicking a list item opens it for editing in `.env` format.
4. Visual design follows MongoDB Compass.
5. Never test against the real Parameter Store — the user validates against AWS manually.

### Decisions taken during brainstorming

- **Data model:** one parameter holds a whole `.env` blob (multi-line `KEY=value`).
  Saving writes one `PutParameter` (new version). Parameters are *not* grouped by path
  into a virtual `.env`.
- **v1 operations:** list, view, edit + save, create, delete, version history with
  restore, key-level diff before save, compare two parameters.
- **Configuration model:** Compass-style saved connections (profile + region + options),
  plus global settings.
- **Stack:** plain vanilla JavaScript — no TypeScript, no UI framework. DOM + plain CSS.
- **Bundler:** electron-vite (Vite) builds the main, preload, and renderer targets from one
  config, with a dev server and hot reload for the renderer.
- **Editor:** CodeMirror 6 (the editor Compass uses) for the `.env` editor and the
  line-level diff view.

### Success criteria

- With a valid AWS profile, the user can connect, see every parameter with console
  metadata, open one, edit its `.env` value, review a diff, and save a new version.
- Credentials never reach the renderer process; values are never written to logs or disk.
- `npm test` and the e2e smoke test pass with no AWS access at all.
- `npm run demo` runs the full UI against an in-memory fake backend.

### Out of scope (v1)

Editing tags, parameter policies (expiration/notification), label management, MFA token
prompts, multiple windows, AWS Secrets Manager, auto-update, code signing.

## 2. Architecture

```
┌──────────────────────────── Electron main process (ESM) ───────────────────────────┐
│ main.js ── app lifecycle, BrowserWindow, dev-server/file loading, hardening        │
│ ipc.js  ── registers channels, wraps every handler in { ok, data | error }         │
│   ├─ store.js        connections.json + settings.json in app.getPath('userData')  │
│   ├─ profiles.js     reads ~/.aws/config + ~/.aws/credentials (profile names)     │
│   ├─ clients.js      one SSM service per connection id (cached, reset on change)  │
│   │    ├─ ssm-service.js       real: @aws-sdk/client-ssm + fromIni credentials    │
│   │    └─ fake-ssm-service.js  in-memory, same interface (VAULT_FAKE_SSM=1)       │
│   └─ errors.js       AWS/SDK errors → { code, message, hint }                     │
└────────────────────────────────────────────────────────────────────────────────────┘
                 ▲ ipcRenderer.invoke (contextIsolation, sandbox, no nodeIntegration)
┌─ preload.js (built to CJS) ── contextBridge exposes window.vault (fixed methods) ──┐
└────────────────────────────────────────────────────────────────────────────────────┘
                 ▼
┌─ Renderer (Vite-bundled; dev server in dev, out/renderer/index.html in prod) ──────┐
│ renderer/index.html, renderer/app.js (router + state), views/*, components/*      │
│ shared/*  pure logic used by renderer AND main AND tests (env, diff, names, tree)  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- All source is ESM `.js` (`"type": "module"`). electron-vite builds three targets into
  `out/`:
  - `out/main/`: the main process, ESM output. Runtime dependencies (the AWS SDK) are kept
    external via `externalizeDepsPlugin` and loaded from `node_modules`, not bundled.
  - `out/preload/`: the preload, **CommonJS** output (`preload.cjs`), because sandboxed
    preloads can't be ESM.
  - `out/renderer/`: the bundled HTML, JS, and CSS.
- `src/shared/` is imported by main and renderer through a `@shared` alias defined once in
  `electron.vite.config.js`. Vitest uses the same alias.
- In development, main loads the renderer from the Vite dev server URL
  (`process.env.ELECTRON_RENDERER_URL`) with hot reload. In production it uses
  `loadFile('out/renderer/index.html')`.
- CSP (meta tag in `index.html`): `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:`. Vite injects styles as inline
  `<style>` tags in dev, so `style-src` needs `'unsafe-inline'`; scripts stay
  `'self'`-only.
- Hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `will-navigate` blocked, `setWindowOpenHandler` denies everything, no remote content.
- `dependencies` (main process, externalized, shipped in the package):
  `@aws-sdk/client-ssm`, `@aws-sdk/credential-providers`,
  `@aws-sdk/shared-ini-file-loader`.
- `devDependencies`:
  - renderer libraries, which Vite bundles so they don't ship separately: `codemirror`,
    `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lint`,
    `@codemirror/merge`, `@lezer/highlight`
  - tooling: `electron`, `electron-vite`, `vite`, `electron-builder`, `vitest`, `jsdom`,
    `aws-sdk-client-mock`, `@playwright/test`

### Source layout

```
package.json
electron.vite.config.js   main / preload / renderer build config, @shared alias
vitest.config.js          node env by default, jsdom for renderer tests, @shared alias
electron-builder.yml      Linux AppImage + deb
src/
  main/
    main.js            app lifecycle, window, dev-server/file loading, hardening
    ipc.js             channel registration + result envelope
    store.js           connections + settings persistence
    profiles.js        AWS profile discovery
    clients.js         per-connection service cache, fake/real switch
    ssm-service.js     real SSM implementation
    fake-ssm-service.js in-memory implementation + seed data
    errors.js          error normalisation
  preload/
    preload.js         window.vault bridge (built to CJS)
  shared/
    env.js             .env parse + validation
    diff.js            key-level diff (or line-mode fallback flag), compare
    names.js           parameter name validation, tier byte limits
    tree.js            build sidebar tree from parameter names
    table.js           sort/filter/search for the parameter table
  renderer/
    index.html
    app.js             entry: imports styles, router (connections ↔ workspace), tabs
    state.js           tiny pub/sub store
    api.js             thin wrapper over window.vault, unwraps envelopes → throws/toasts
    styles/tokens.css  Compass palette + light/dark themes
    styles/app.css     layout + components
    views/connections.js  connections screen (list + form)
    views/workspace.js    sidebar + tab strip
    views/parameters.js   parameters table tab
    views/parameter.js    parameter tab (overview, editor, history)
    views/compare.js      compare tab
    views/settings.js     settings modal
    components/env-editor.js  CodeMirror 6 editor: setup, linter, byte status, Mod-S
    components/env-language.js .env StreamLanguage tokenizer + Compass highlight style + theme
    components/diff-view.js   key diff table with masking; line mode via @codemirror/merge
    components/modal.js       modal + type-to-confirm
    components/toast.js       toasts
    components/icons.js       inline SVG icons
test/
  unit/*.test.js       Vitest suites (main + shared, node env)
  renderer/*.test.js   Vitest suites (components, jsdom env)
  fixtures/aws/        fake config/credentials ini files
  e2e/smoke.spec.js    Playwright _electron against fake backend
```

## 3. Data model

### Connection (persisted in `connections.json`)

```js
{
  id: 'c_8f2k…',          // random, generated on create
  name: 'Convenia PROD',
  profile: 'default',     // AWS profile name; credentials are never stored
  region: 'sa-east-1',
  pathPrefix: '',         // optional; '' = all parameters
  color: 'green',         // one of: none, red, orange, yellow, green, teal, blue, purple, pink
  readOnly: true,
  createdAt: '2026-10-01T12:00:00.000Z'
}
```

### Settings (persisted in `settings.json`)

```js
{
  theme: 'system',            // 'system' | 'light' | 'dark'
  autoDecrypt: true,          // decrypt SecureString when a parameter tab opens
  maskValuesInDiff: true,     // diff/compare values hidden until revealed
  awsConfigFile: '',          // '' = SDK default (~/.aws/config or AWS_CONFIG_FILE)
  awsCredentialsFile: ''      // '' = SDK default (~/.aws/credentials or AWS_SHARED_CREDENTIALS_FILE)
}
```

Unknown keys are dropped and missing keys take defaults on load. Writes are atomic
(write temp file, then rename). A corrupt file is renamed to `*.corrupt-<timestamp>` and
defaults are used, with a toast telling the user.

### Parameter metadata (list rows, from `DescribeParameters`)

`name, type, tier, dataType, version, lastModifiedDate, lastModifiedUser, description,
keyId, allowedPattern`. (`DescribeParameters` has no ARN; the ARN comes from `GetParameter`.)

### Parameter value (from `GetParameter` / `GetParameterHistory`)

`name, type, value, version, lastModifiedDate, dataType, arn` and, for history entries,
`lastModifiedUser, labels, description, tier, keyId`.

## 4. IPC API (`window.vault`)

Every method returns a Promise resolving to `{ ok: true, data }` or
`{ ok: false, error: { code, message, hint } }`. The renderer's `api.js` unwraps it.

| Method | Purpose | SSM calls |
|---|---|---|
| `profiles.list()` | profile names with source (`config`/`credentials`/both), default region, SSO flag | none (reads ini files) |
| `connections.list()` / `.save(conn)` / `.delete(id)` | CRUD saved connections | none |
| `connections.test(conn)` | verify profile + region + permission | `DescribeParameters` (MaxResults 1) |
| `settings.get()` / `.save(settings)` | global settings | none |
| `ssm.list(connId)` | all parameter metadata, all pages, honouring `pathPrefix` | `DescribeParameters` with `ParameterFilters: [{Key:'Name', Option:'BeginsWith', Values:[prefix]}]` |
| `ssm.get(connId, name, {decrypt})` | current value | `GetParameter` |
| `ssm.tags(connId, name)` | tags for overview | `ListTagsForResource` (`ResourceType: 'Parameter'`) |
| `ssm.history(connId, name, {decrypt})` | all versions, newest first | `GetParameterHistory` (all pages) |
| `ssm.put(connId, input)` | create or update | optional `GetParameter` (version check) + `PutParameter` |
| `ssm.delete(connId, name)` | delete | `DeleteParameter` |
| `app.info()` | version, fake-mode flag | none |

`ssm.put` input: `{ name, value, type, tier, keyId, description, overwrite, expectedVersion }`.
When `expectedVersion` is set, the service reads the current version first and fails with
`VersionConflict` if it differs. Updates keep the current `type` and `keyId`. Creates use
`overwrite: false`.

Write methods are refused in main (`ReadOnlyConnection`) when the connection is
read-only. The renderer also hides the controls, but main is the enforcement point.

Main-process input validation: names checked with `shared/names.js`, region and profile
must be non-empty strings, and values must be strings under the tier limit.

## 5. Screens and behaviour

### 5.1 Connections screen (start screen)

Modelled on the Compass connect screen.
- **Left:** saved connections, each with its color stripe, name, `profile · region`, and a
  read-only badge. Click to select, double-click to connect. Row menu: edit, duplicate,
  delete.
- **Right:** the connection form. Fields: name, profile (dropdown from `profiles.list()`,
  with the profile's default region pre-filled), region (dropdown of SSM regions plus free
  text), path prefix, color swatches, read-only toggle. Buttons: **Test connection**,
  **Save**, **Save & Connect**, **Connect**.
- A banner shows when no AWS profiles are found, with the file paths that were checked.

### 5.2 Workspace

- **Sidebar** (dark navy `#001E2B`): connection name with its color, `profile · region`,
  a disconnect button, a **Compare** button, and **+ Create parameter** (hidden when
  read-only). Below that, a filter box and a collapsible tree built by splitting names on
  `/`. Clicking a folder filters the table to that prefix; clicking a leaf opens the
  parameter tab. Names without a leading `/` are top-level leaves.
- **Tab strip** (Compass-style): a fixed **Parameters** tab plus closable parameter and
  compare tabs. Closing a tab with unsaved edits asks for confirmation, and so does
  disconnecting with any unsaved tab.
- **Settings** (gear icon, top right) opens the settings modal.

### 5.3 Parameters tab

- A table with AWS-console columns: **Name, Tier, Type, Data type, Version,
  Last modified, Last modified user, Description**. Type badges: String (gray),
  StringList (blue), SecureString (green with a lock icon).
- Search box (substring on name + description), sorting on every column, a count ("124
  parameters"), and a **Refresh** button. Loading shows a skeleton; empty states differ
  for "no parameters" and "no matches".
- Clicking a row opens (or focuses) that parameter's tab.

### 5.4 Parameter tab

- **Header:** name, type badge, tier, version, and actions **Save** (`Ctrl+S`),
  **Revert**, and **Delete** (write actions hidden for read-only connections).
- **Overview panel** (collapsible): ARN, description, type, tier, data type, KMS key,
  version, last modified date, last modified user, tags.
- **Sub-tabs:** **Value** (editor) and **History**.
- **SecureString with `autoDecrypt` off:** the editor area shows "Encrypted value —
  Decrypt & show", which fetches with `decrypt: true`.

#### Env editor (`components/env-editor.js`)

- CodeMirror 6 with `basicSetup` (line numbers, undo/redo history, search `Mod-F`,
  active-line highlight, bracket matching). Autocompletion is turned off.
- `.env` language (`env-language.js`): a `StreamLanguage` tokenizer that follows the
  §6 parse rules. Token kinds: comment, `export` keyword, key, `=` operator, unquoted
  value, quoted string, escape, and invalid line. A `HighlightStyle` and
  `EditorView.theme` use the Compass palette through CSS variables, so switching
  light/dark needs no editor reconfiguration.
- Warnings use `@codemirror/lint` with `lintGutter()`. A pure function
  `envDiagnostics(text)` turns `shared/env.js` warnings (invalid line, duplicate key)
  into warning-severity diagnostics on the offending line. These never block saving. A
  value that isn't `.env` at all (e.g. JSON or a plain string) shows a single "Not in
  .env format — editing as plain text" notice above the editor instead of
  per-line warnings.
- A status bar under the editor shows the line count and UTF-8 bytes against the tier
  limit (Standard 4096 B, Advanced 8192 B), turning red when over. It is updated from an
  `EditorView.updateListener`.
- `Mod-S` (registered with `Prec.highest`) starts the save flow. The component reports
  `dirty` by comparing the document with the loaded value.
- For read-only connections the editor uses `EditorState.readOnly` and
  `EditorView.editable.of(false)`.
- The raw text the user typed is exactly what gets saved. Parsing is only used for
  validation, diff, and compare; the app never re-serializes the user's text.

#### Save flow

1. **Size check.** Over the Advanced limit, save is blocked. Over the Standard limit on a
   Standard parameter, the diff dialog shows a required checkbox: "Upgrade to Advanced
   tier (charges apply)".
2. **Diff dialog.** Shows key-level changes: added, changed, removed, plus an unchanged
   count. Values are masked when `maskValuesInDiff` is on, with per-row and global
   reveal. If either side isn't valid `.env`, a side-by-side line diff
   (`@codemirror/merge` `MergeView`, read-only) is shown instead, hidden behind a
   **Reveal** button while masking is on.
3. **Put.** On confirm: `PutParameter` with `Overwrite: true` and `expectedVersion` (the
   version the tab loaded). On `VersionConflict`, a dialog offers **Reload** (discard local
   edits and load the latest) or **Overwrite anyway** (repeat the put without the version
   check).
4. **Success.** The tab reloads the new version, shows a toast ("Saved version 8"), and
   refreshes the list row.

#### History sub-tab

- Versions newest first: version, date, user, labels, and a "current" marker.
- Selecting a version shows a diff against the current value, using the same diff view.
- **Restore this version** (hidden when read-only) loads that value into the editor as
  unsaved changes, so the normal save flow (version check, diff, put) applies.

### 5.5 Create parameter (modal)

Fields: name (live validation, see §6), description, type (String / StringList /
SecureString, default SecureString), tier (Standard / Advanced), KMS key (default
`alias/aws/ssm`, shown only for SecureString), data type (`text`), and initial value in
an env editor. Submits with `overwrite: false`. `ParameterAlreadyExists` is shown on the
name field. On success the new parameter's tab opens.

### 5.6 Delete

A confirmation modal requires typing the full parameter name (Compass "drop collection"
pattern). On success the tab closes, the list refreshes, and a toast confirms.

### 5.7 Compare tab

- Two pickers, A and B. Each picks a saved connection (any, not only the active one),
  then a parameter name (searchable).
- The result shows a summary (only in A: n, only in B: n, different: n, equal: n) and a
  table of keys with A value / B value. It can be filtered to differences only and
  respects masking. Equal rows are collapsed by default.
- Compare is read-only. Nothing is written from this tab.

### 5.8 Settings modal

Theme, auto-decrypt SecureString on open, mask values in diff/compare, custom AWS config
file path, custom AWS credentials file path. Changing a file path clears the client
cache and reloads profiles.

## 6. Shared logic rules

### `.env` parsing (`shared/env.js`)

- Line kinds: blank, comment (`#…`), entry, invalid.
- Entry: optional `export ` prefix, key matching `^[A-Za-z_][A-Za-z0-9_.-]*$`, `=`, and
  then a value. Whitespace around the key and `=` is tolerated.
- Values: unquoted (inline ` #comment` stripped, trimmed), single-quoted (literal),
  double-quoted (supports `\n`, `\"`, `\\`; may span multiple lines until the closing
  quote).
- Output: `{ entries: [{ key, value, line }], warnings: [{ line, kind, message }],
  isEnv }`. Duplicate keys produce a warning, and the last occurrence wins in
  `toMap()`. `isEnv` is false when there are non-blank, non-comment lines but zero
  valid entries.

### Diff and compare (`shared/diff.js`)

- `diffEnv(oldText, newText)` → `{ mode: 'keys', added, removed, changed, unchanged }`,
  or `{ mode: 'lines', oldText, newText, identical }` when either side has
  `isEnv === false`. In line mode the diff view renders the two texts with
  `@codemirror/merge`, so no line-diff algorithm lives in `shared/`.
- `compareEnv(aText, bText)` → `{ onlyA, onlyB, different, equal }`, each a list of
  `{ key, a, b }`.

### Names and limits (`shared/names.js`)

- Valid characters: `a-zA-Z0-9_.-/`. Maximum length is 1011 characters. (AWS counts the
  full ARN against that limit, so AWS may still reject edge cases, which surface as
  `ValidationError`.) At most 15 hierarchy levels. If the name contains `/`, it must start with `/`.
  No `aws` or `ssm` prefix (case-insensitive) on the first segment.
- `byteLength(value)` uses UTF-8. Limits: Standard 4096, Advanced 8192.

### Tree and table (`shared/tree.js`, `shared/table.js`)

- `buildTree(names)` → nested folders/leaves, sorted folders first and then
  alphabetically. It handles a name that is both a leaf and a folder prefix (e.g. `/a`
  and `/a/b`).
- `filterRows(rows, query, prefix)` and `sortRows(rows, column, direction)` are pure;
  dates sort chronologically and versions numerically.

## 7. Error handling

`errors.js` maps errors to `{ code, message, hint }`:

| Source error | code | Message / hint |
|---|---|---|
| `AccessDeniedException` | `AccessDenied` | "Not allowed to <action> on <name>." hint: check the profile's IAM policy |
| `ExpiredTokenException`, `ExpiredToken` | `ExpiredCredentials` | hint: refresh credentials for profile X (`aws sso login --profile X` for SSO) |
| `CredentialsProviderError` / profile not found | `CredentialsError` | hint: check the profile in Settings → AWS files |
| `UnrecognizedClientException`, `InvalidSignatureException` | `InvalidCredentials` | hint: keys are wrong or revoked |
| `ParameterNotFound` | `ParameterNotFound` | the list refreshes and the tab offers to close |
| `ParameterAlreadyExists` | `ParameterAlreadyExists` | shown on the name field |
| `ParameterMaxVersionLimitExceeded` | `MaxVersionLimit` | hint: 100-version limit reached and the oldest version has a label; move the label in the console |
| `ValidationException`, `ParameterPatternMismatchException` | `ValidationError` | AWS message passed through |
| `ThrottlingException` | `Throttled` | only after SDK adaptive retries are exhausted (`retryMode: 'adaptive'`, `maxAttempts: 6`) |
| network (`ENOTFOUND`, `ETIMEDOUT`, …) | `NetworkError` | hint: check connectivity/region |
| internal | `VersionConflict`, `ReadOnlyConnection`, `InvalidInput` | raised by our code |
| anything else | `Unknown` | the original name and message |

- Every failed IPC call surfaces in the UI as a toast or an inline field error. There are
  no empty `catch` blocks.
- Main logs errors to the console with the error code and parameter name, never values.

## 8. Visual design (Compass)

- Palette tokens in `tokens.css`, using LeafyGreen values: black `#001E2B`;
  gray dark4 `#112733`, dark3 `#1C2D38`, dark2 `#3D4F58`, dark1 `#5C6C75`,
  base `#889397`, light1 `#C1C7C6`, light2 `#E8EDEB`, light3 `#F9FBFA`;
  green dark3 `#023430`, dark2 `#00684A`, dark1 `#00A35C`, base `#00ED64`,
  light1 `#71F6BA`, light2 `#C0FAE6`, light3 `#E3FCF7`; blue base `#016BF8`,
  light2 `#C3E7FE`; yellow base `#FFC010`, light3 `#FEF7DB`; red base `#DB3030`,
  light3 `#FFEAE5`.
- Light theme: a white content area, `light3` panels, a dark navy sidebar. Dark theme:
  `#001E2B` content and `#112733` panels. `theme: system` follows
  `prefers-color-scheme`.
- Typography: a system UI font stack (Compass's Euclid Circular A is proprietary), with
  `Source Code Pro`-style monospace fallbacks (`ui-monospace, Menlo, Consolas`) for
  names and the editor.
- Components: pill-shaped buttons (primary green-dark2, secondary outline, danger red),
  6 px radius inputs, a 3 px green focus ring, an active tab with a green bottom border,
  badges, and toasts at the bottom left.

## 9. Testing

The real Parameter Store is never contacted by any automated test.

- **Unit (Vitest, `npm test`):**
  - `env.test.js`: line kinds, quoting rules, multiline, duplicates, `isEnv`
  - `diff.test.js`: added/removed/changed/unchanged, line-diff fallback, compare buckets
  - `names.test.js`: valid/invalid names, reserved prefixes, depth, byte limits with multibyte chars
  - `tree.test.js`, `table.test.js`: tree shape, leaf+folder collision, sort/filter
  - `profiles.test.js`: fixture ini files (config `[profile x]` vs credentials `[x]`, SSO flag, default region)
  - `store.test.js`: temp dir, defaults, unknown-key stripping, atomic write, corrupt-file recovery
  - `errors.test.js`: every mapping row in §7
  - `ssm-service.test.js`: `aws-sdk-client-mock` covering pagination, prefix filter, decrypt flag, the put version check, keyId/type preservation on update, history ordering, tags
  - `fake-ssm-service.test.js`: versions increment, history kept, conflict detection, delete, not-found
  - `ipc.test.js`: envelope shape, read-only enforcement, input validation (handlers called directly with a stub service)
- **Renderer components (Vitest + jsdom):**
  - `env-language.test.js`: tokenizer output for each token kind, including multiline double-quoted values
  - `env-diagnostics.test.js`: `envDiagnostics()` positions and messages for invalid lines and duplicate keys, none for valid text
  - `env-editor.test.js`: mounts in jsdom (with the `Range`/`getClientRects` stubs CodeMirror needs), status bar bytes and over-limit state, `dirty` flag, read-only mode rejects edits
  - `diff-view.test.js`: key rows per bucket, masking and reveal, line mode mounts a `MergeView`
  - `modal.test.js`: type-to-confirm keeps the button disabled until the exact name is typed
  - `api.test.js`: envelope unwrapping and error → toast routing with a stubbed `window.vault`
- **E2E (`npm run test:e2e`):** builds with `electron-vite build`, then Playwright `_electron`
  launches `out/main/index.js` with
  `VAULT_FAKE_SSM=1` and an isolated `VAULT_USER_DATA` temp dir. It creates a
  connection, connects, opens a parameter, edits one key, checks the diff shows exactly
  one changed key, saves, and checks the version went up and the History tab lists the
  previous version.
- **Demo (`npm run demo`):** the app with `VAULT_FAKE_SSM=1`. The fake backend seeds
  about 20 parameters across `/myapp/{dev,staging,prod}/…`, mixing String, StringList,
  and SecureString, `.env` and non-`.env` values, and one near the 4 KB limit. It also
  seeds two connections (`demo-staging`, `demo-prod` read-only).
- **Manual (user):** against real AWS, per the user's instruction.

## 10. Scripts and packaging

- `npm run dev`: `electron-vite dev` with real AWS and renderer hot reload.
- `npm run demo`: `electron-vite dev` with `VAULT_FAKE_SSM=1`.
- `npm run build`: `electron-vite build` into `out/`.
- `npm start`: `electron-vite preview`, which runs the built app with real AWS.
- `npm test`: `vitest run`.
- `npm run test:e2e`: build, then the Playwright Electron smoke test.
- `npm run dist`: build, then `electron-builder` for Linux AppImage + deb (the user is on
  Linux Mint).
- Environment variables: `VAULT_FAKE_SSM=1` swaps in the fake backend and fake profiles;
  `VAULT_USER_DATA=<dir>` overrides `app.getPath('userData')` (used by e2e for isolation).
