import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { ResearchDeckApi } from '@shared/types'

// Custom APIs for renderer
const api: ResearchDeckApi = {
  app: {
    getSettings: () => ipcRenderer.invoke('app:getSettings'),
    setTheme: (payload) => ipcRenderer.invoke('app:setTheme', payload),
    getDefaultVaultParent: () => ipcRenderer.invoke('app:getDefaultVaultParent')
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory')
  },
  vault: {
    list: () => ipcRenderer.invoke('vault:list'),
    createExisting: (payload) => ipcRenderer.invoke('vault:createExisting', payload),
    createNew: (payload) => ipcRenderer.invoke('vault:createNew', payload),
    open: (payload) => ipcRenderer.invoke('vault:open', payload),
    rename: (payload) => ipcRenderer.invoke('vault:rename', payload),
    remove: (payload) => ipcRenderer.invoke('vault:remove', payload),
    relink: (payload) => ipcRenderer.invoke('vault:relink', payload),
    revealInFileManager: (payload) => ipcRenderer.invoke('vault:revealInFileManager', payload),
    saveSession: (payload) => ipcRenderer.invoke('vault:saveSession', payload),
    readTree: (payload) => ipcRenderer.invoke('vault:readTree', payload),
    readFile: (payload) => ipcRenderer.invoke('vault:readFile', payload)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
