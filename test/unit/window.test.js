import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const created = []
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options) {
      this.options = options
      this.webContents = { setWindowOpenHandler() {}, on() {} }
      created.push(this)
    }
    once() {}
    loadURL() {}
    loadFile() {}
  },
  Menu: {},
  dialog: {}
}))

const { WINDOW_ICON, createMainWindow, menuTemplate } = await import('../../src/main/window.js')

describe('createMainWindow', () => {
  it('uses the key icon so the taskbar shows the app mark instead of the default one', () => {
    createMainWindow()
    expect(created.at(-1).options.icon).toBe(WINDOW_ICON)
    expect(WINDOW_ICON).toMatch(/resources\/icon\.png$/)
    expect(existsSync(WINDOW_ICON)).toBe(true)
  })
})

describe('menuTemplate', () => {
  const view = (options) => menuTemplate(options).find((menu) => menu.label === 'View').submenu
  const accelerators = (items, role) => items.filter((item) => item.role === role).map((item) => item.accelerator)

  it('zooms with Ctrl+Plus, Ctrl+=, Ctrl+- and the numpad, and resets with Ctrl+0, in packaged builds too', () => {
    const items = view({ platform: 'linux', dev: false })
    expect(accelerators(items, 'zoomIn')).toEqual([undefined, 'CommandOrControl+=', 'CommandOrControl+numadd'])
    expect(accelerators(items, 'zoomOut')).toEqual([undefined, 'CommandOrControl+numsub'])
    expect(accelerators(items, 'resetZoom')).toEqual([undefined])
  })

  it('offers reload and DevTools only in development', () => {
    expect(view({ platform: 'linux', dev: false }).some((item) => item.role === 'toggleDevTools')).toBe(false)
    expect(view({ platform: 'linux', dev: true }).some((item) => item.role === 'toggleDevTools')).toBe(true)
  })

  it('keeps Ctrl+W free for closing tabs', () => {
    const roles = menuTemplate({ platform: 'linux', dev: true }).flatMap((menu) => [menu.role, ...(menu.submenu ?? []).map((item) => item.role)])
    expect(roles).not.toContain('windowMenu')
    expect(roles).not.toContain('close')
  })
})
