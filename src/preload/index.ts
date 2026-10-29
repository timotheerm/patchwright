import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_METHODS, EVENT_CHANNEL, type PatchwrightApi } from '../shared/api'
import type { AppEvent } from '../shared/types'

const api: Record<string, unknown> = {}
for (const m of API_METHODS) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`pw:${m}`, ...args)
api.onEvent = (cb: (e: AppEvent) => void) => {
  const listener = (_e: IpcRendererEvent, ev: AppEvent): void => cb(ev)
  ipcRenderer.on(EVENT_CHANNEL, listener)
  return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener)
}

contextBridge.exposeInMainWorld('patchwright', api as unknown as PatchwrightApi)
