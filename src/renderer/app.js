import './styles/tokens.css'
import './styles/base.css'
import { DEFAULT_SETTINGS } from '@shared/settings.js'
import { createApi } from './api.js'
import { h } from './lib/dom.js'
import { installUnloadGuard } from './lib/unload-guard.js'
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
  installUnloadGuard(() => Boolean(workspace?.hasUnsavedChanges()))
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
