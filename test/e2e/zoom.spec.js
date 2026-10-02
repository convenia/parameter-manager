import { expect, test } from '@playwright/test'
import { launchDemo } from './helpers.js'

// The window is shown on ready-to-show, after the first screen renders; keys sent earlier are lost.
const isFocused = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())
const zoomLevel = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())

// page.keyboard goes straight to the page and never reaches menu accelerators, so the
// shortcut is sent through Electron's input pipeline instead.
const pressCtrl = (app, keyCode) =>
  app.evaluate(({ BrowserWindow }, keyCode) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] })
  }, keyCode)

test('Ctrl+= and Ctrl+- zoom the window in and out, and Ctrl+0 resets it', async () => {
  const demo = await launchDemo()
  const { app } = demo
  try {
    await expect.poll(() => isFocused(app)).toBe(true)
    await pressCtrl(app, '=')
    await expect.poll(() => zoomLevel(app)).toBeGreaterThan(0)
    await pressCtrl(app, '0')
    await expect.poll(() => zoomLevel(app)).toBe(0)
    await pressCtrl(app, '-')
    await expect.poll(() => zoomLevel(app)).toBeLessThan(0)
    await pressCtrl(app, 'Plus')
    await expect.poll(() => zoomLevel(app)).toBe(0)
  } finally {
    await demo.close()
  }
})
