import type { ElectronAPI } from '@electron-toolkit/preload'
import type { ResearchDeckApi } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ResearchDeckApi
  }
}
