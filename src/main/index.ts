import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type SecretCodec } from '../core/engine'
import { API_METHODS, EVENT_CHANNEL, type ApiMethod, type PatchwrightApi } from '../shared/api'
import type { AppEvent } from '../shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))
let win: BrowserWindow | null = null

/**
 * API keys are stored encrypted with the OS keychain (DPAPI on Windows) when it's available.
 * safeStorage only reports availability after the app is ready, so call this after whenReady().
 */
function secretCodec(): SecretCodec | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  return {
    encrypt: (s) => `enc:${safeStorage.encryptString(s).toString('base64')}`,
    decrypt: (s) => (s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s)
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0d0f14',
    title: 'Patchwright',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, '../preload/index.mjs'), contextIsolation: true, sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(here, '../renderer/index.html'))
}

async function main(): Promise<void> {
  await app.whenReady()
  const engine = await Engine.create({
    dataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    emit: (e: AppEvent) => win?.webContents.send(EVENT_CHANNEL, e),
    secrets: secretCodec()
  })

  type Handlers = { [K in ApiMethod]: (...args: Parameters<PatchwrightApi[K]>) => unknown }
  const handlers: Handlers = {
    getSettings: () => engine.settings,
    saveSettings: (p) => engine.saveSettings(p),
    detectPaths: () => engine.detectPaths(),
    getGameStatus: (refresh) => engine.gameStatus(refresh),
    getFrameworks: () => engine.frameworks(),
    testAi: () => engine.testAi(),
    testNexus: () => engine.testNexus(),
    vortexStatus: () => engine.vortexStatus(),
    listInstalledMods: () => engine.listInstalledMods(),
    resolveInput: (input) => engine.resolveInput(input),
    triage: (mods) => engine.triage(mods),
    checkCommunity: (mod) => engine.checkCommunity(mod),
    startJob: (t) => engine.startJob(t),
    cancelJob: (id) => engine.cancelJob(id),
    listJobs: () => engine.listJobs(),
    getJobLog: (id) => engine.getJobLog(id),
    readJobFile: (id, rel) => engine.readJobFile(id, rel),
    deliverJob: (id, mode) => engine.deliverJob(id, mode),
    getTestHints: (ids) => engine.getTestHints(ids),
    createTestProfile: () => engine.createTestProfile(),
    backupSaves: () => engine.backupSaves(),
    readTestLogs: (since, names) => engine.readTestLogs(since, names),
    summarizeTest: (findings, notes) => engine.summarizeTest(findings, notes),
    getKnowledge: () => engine.getKnowledge(),
    saveKnowledgeEntry: (kind, entry) => engine.saveKnowledgeEntry(kind, entry),
    deleteKnowledgeEntry: (id) => engine.deleteKnowledgeEntry(id),
    knowledgeFor: (t) => engine.knowledgeFor(t),
    recordOutcome: (id, outcome, note) => engine.recordOutcome(id, outcome, note),
    exportKnowledge: () => engine.exportKnowledge(),
    importKnowledge: (file) => engine.importKnowledge(file),
    getChangelog: () => engine.getChangelog(),
    undo: (id) => engine.undo(id),
    openPath: async (p) => {
      await shell.openPath(p)
    },
    openExternal: async (url) => {
      if (/^https:\/\//.test(url)) await shell.openExternal(url)
    },
    pickPath: async (kind, title) => {
      const r = await dialog.showOpenDialog(win!, { title, properties: [kind === 'folder' ? 'openDirectory' : 'openFile'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    }
  }
  for (const m of API_METHODS) {
    ipcMain.handle(`pw:${m}`, (_e, ...args: unknown[]) => (handlers[m] as (...a: unknown[]) => unknown)(...args))
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void main()
