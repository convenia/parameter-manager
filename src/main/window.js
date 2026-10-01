import { BrowserWindow, Menu, dialog } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedNavigation } from './navigation.js'
import { confirmUnload } from './unload.js'

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
  win.webContents.on('will-prevent-unload', (event) => confirmUnload(event, (options) => dialog.showMessageBoxSync(win, options)))

  if (devServerUrl) win.loadURL(devServerUrl)
  else win.loadFile(join(here, '../renderer/index.html'))
  return win
}
