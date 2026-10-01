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
