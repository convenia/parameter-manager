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
