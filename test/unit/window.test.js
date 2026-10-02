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

const { WINDOW_ICON, createMainWindow } = await import('../../src/main/window.js')

describe('createMainWindow', () => {
  it('uses the key icon so the taskbar shows the app mark instead of the default one', () => {
    createMainWindow()
    expect(created.at(-1).options.icon).toBe(WINDOW_ICON)
    expect(WINDOW_ICON).toMatch(/resources\/icon\.png$/)
    expect(existsSync(WINDOW_ICON)).toBe(true)
  })
})
