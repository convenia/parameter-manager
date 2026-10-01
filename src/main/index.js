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
