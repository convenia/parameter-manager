import { BrowserWindow, Menu, dialog } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedNavigation } from './navigation.js'
import { confirmUnload } from './unload.js'

const here = dirname(fileURLToPath(import.meta.url))
// The same key mark as the in-app brand. Resolves from src/main in tests and out/main when built.
export const WINDOW_ICON = join(here, '../../resources/icon.png')

// The zoomIn role only binds Ctrl+Plus (Ctrl+Shift+= on most layouts), so hidden
// duplicates also catch Ctrl+= and the numpad keys.
const hiddenShortcut = (role, accelerator) => ({ role, accelerator, visible: false, acceleratorWorksWhenHidden: true })

export function menuTemplate({ platform, dev }) {
  // A minimal menu: keeps copy/paste shortcuts (needed on macOS) and zoom without the
  // default "Close Window" accelerator, so Ctrl+W can close tabs instead.
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        hiddenShortcut('zoomIn', 'CommandOrControl+='),
        hiddenShortcut('zoomIn', 'CommandOrControl+numadd'),
        { role: 'zoomOut' },
        hiddenShortcut('zoomOut', 'CommandOrControl+numsub'),
        ...(dev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] : [])
      ]
    }
  ]
}

export function installMenu() {
  const template = menuTemplate({ platform: process.platform, dev: Boolean(process.env.ELECTRON_RENDERER_URL) })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function createMainWindow() {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Parameter Manager',
    icon: WINDOW_ICON,
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
