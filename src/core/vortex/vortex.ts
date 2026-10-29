import path from 'node:path'
import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import type { ModRef, VortexStatus } from '../../shared/types'
import { exists, isDir, run } from '../util'

export interface VortexPaths {
  exe?: string
  appData?: string
  stagingPath?: string
}

export interface VortexProfile {
  id: string
  gameId: string
  name: string
  modState?: Record<string, { enabled: boolean; enabledTime?: number }>
  lastActivated?: number
}

interface VortexMod {
  id: string
  state?: string
  installationPath?: string
  attributes?: Record<string, unknown>
}

/** Parses Vortex's default mod folder name: "<name>-<nexus id>-<version with dashes>-<unix time>". */
export function parseStagingFolderName(folder: string): { name: string; nexusModId?: number; version?: string; installedAt?: string } {
  const m = folder.match(/^(.*?)-(\d+)-((?:\d+-)*\d+[a-z]?)-(\d{9,10})$/i)
  if (!m) return { name: folder }
  return {
    name: m[1].trim() || folder,
    nexusModId: Number(m[2]),
    version: m[3].replace(/-/g, '.'),
    installedAt: new Date(Number(m[4]) * 1000).toISOString()
  }
}

/** Vortex-style short id for new profiles. */
export function newProfileId(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  return [...crypto.randomBytes(9)].map((b) => alphabet[b % alphabet.length]).join('')
}

/** Reads Vortex's `--get` output, which is JSON, possibly with log lines around it. */
export function parseGetOutput(stdout: string): unknown {
  const t = stdout.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    const start = t.search(/[[{]/)
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    return t
  }
}

/**
 * Talks to Vortex through its command line (--get/--set/--del), which only works while Vortex is
 * closed, and falls back to reading the staging folder directly.
 */
export class Vortex {
  constructor(
    public paths: VortexPaths,
    private platform: NodeJS.Platform = process.platform
  ) {}

  static defaults(env: NodeJS.ProcessEnv): VortexPaths {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
    const appData = env.APPDATA ? path.join(env.APPDATA, 'Vortex') : undefined
    return {
      exe: path.join(programFiles, 'Black Tree Gaming Ltd', 'Vortex', 'Vortex.exe'),
      appData,
      stagingPath: appData ? path.join(appData, 'cyberpunk2077', 'mods') : undefined
    }
  }

  async isRunning(): Promise<boolean> {
    if (this.platform !== 'win32') return false
    const res = await run('tasklist', ['/FI', 'IMAGENAME eq Vortex.exe', '/NH'], { timeoutMs: 10_000 })
    return /vortex\.exe/i.test(res.stdout)
  }

  private async cli(args: string[]): Promise<{ ok: boolean; out: string }> {
    if (!this.paths.exe || !(await exists(this.paths.exe))) return { ok: false, out: 'Vortex.exe not found' }
    const res = await run(this.paths.exe, args, { timeoutMs: 60_000 })
    return { ok: res.code === 0, out: res.stdout || res.stderr }
  }

  async get<T>(statePath: string): Promise<T | undefined> {
    const r = await this.cli(['--get', statePath])
    if (!r.ok) return undefined
    return parseGetOutput(r.out) as T
  }

  async set(statePath: string, value: unknown): Promise<boolean> {
    return (await this.cli(['--set', `${statePath}=${JSON.stringify(value)}`])).ok
  }

  async del(statePath: string): Promise<boolean> {
    return (await this.cli(['--del', statePath])).ok
  }

  async listProfiles(gameId: string): Promise<VortexProfile[]> {
    const all = await this.get<Record<string, VortexProfile>>('persistent.profiles')
    if (!all || typeof all !== 'object') return []
    return Object.values(all).filter((p) => p && p.gameId === gameId)
  }

  async activeProfileId(gameId: string): Promise<string | undefined> {
    const last = await this.get<Record<string, string>>('settings.profiles.lastActiveProfile')
    if (last && typeof last === 'object' && typeof last[gameId] === 'string') return last[gameId]
    const active = await this.get<string>('settings.profiles.activeProfileId')
    return typeof active === 'string' ? active : undefined
  }

  async status(gameId: string): Promise<VortexStatus> {
    const notes: string[] = []
    const found = !!this.paths.exe && (await exists(this.paths.exe))
    const running = await this.isRunning()
    let profiles: VortexProfile[] = []
    let activeId: string | undefined
    let stateReadable = false
    if (found && !running) {
      profiles = await this.listProfiles(gameId)
      activeId = await this.activeProfileId(gameId)
      stateReadable = profiles.length > 0
      if (!stateReadable) notes.push("Couldn't read Vortex's profiles through its command line.")
    } else if (running) {
      notes.push('Vortex is open. Close it to let Patchwright read and create profiles; mods are read from the staging folder meanwhile.')
    } else {
      notes.push('Vortex.exe was not found. Set its path in Settings.')
    }
    const mods = await this.scanStaging()
    const active = profiles.find((p) => p.id === activeId)
    return {
      found,
      exe: this.paths.exe,
      appData: this.paths.appData,
      stagingPath: this.paths.stagingPath,
      running,
      stateReadable,
      activeProfile: active ? { id: active.id, name: active.name } : undefined,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
      modCount: mods.length,
      notes
    }
  }

  /** Lists mod folders in the staging folder. Works while Vortex is running. */
  async scanStaging(): Promise<ModRef[]> {
    const dir = this.paths.stagingPath
    if (!dir || !(await isDir(dir))) return []
    const out: ModRef[] = []
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('__')) continue
      const parsed = parseStagingFolderName(e.name)
      out.push({
        key: e.name,
        name: parsed.name,
        nexusModId: parsed.nexusModId,
        version: parsed.version,
        installedAt: parsed.installedAt,
        vortexId: e.name,
        stagingPath: path.join(dir, e.name),
        source: 'staging'
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Lists installed mods with Vortex's own names, ids and enabled state when the state is readable. */
  async listMods(gameId: string): Promise<ModRef[]> {
    const staged = await this.scanStaging()
    if (await this.isRunning()) return staged
    const mods = await this.get<Record<string, VortexMod>>(`persistent.mods.${gameId}`)
    if (!mods || typeof mods !== 'object') return staged
    const activeId = await this.activeProfileId(gameId)
    const profile = activeId ? (await this.listProfiles(gameId)).find((p) => p.id === activeId) : undefined
    const out: ModRef[] = []
    for (const m of Object.values(mods)) {
      if (!m || m.state !== 'installed') continue
      const a = m.attributes ?? {}
      const folder = m.installationPath ?? m.id
      const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v) || undefined)
      out.push({
        key: m.id,
        name: String(a.customFileName ?? a.logicalFileName ?? a.modName ?? a.name ?? m.id),
        nexusModId: a.source === 'nexus' || a.modId ? num(a.modId) : undefined,
        nexusFileId: num(a.fileId),
        version: a.version ? String(a.version) : undefined,
        vortexId: m.id,
        stagingPath: this.paths.stagingPath ? path.join(this.paths.stagingPath, folder) : undefined,
        enabled: profile?.modState?.[m.id]?.enabled ?? undefined,
        installedAt: a.installTime ? String(a.installTime) : undefined,
        source: 'vortex'
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Creates a profile that copies the enabled mods of `cloneFrom`. Vortex must be closed.
   * Returns the new profile id; undo with del(`persistent.profiles.<id>`).
   */
  async createProfile(gameId: string, name: string, cloneFrom?: string): Promise<string> {
    if (await this.isRunning()) throw new Error('Close Vortex first; it locks its state while open.')
    const profiles = await this.listProfiles(gameId)
    const existing = profiles.find((p) => p.name === name)
    if (existing) return existing.id
    const source = profiles.find((p) => p.id === cloneFrom)
    const id = newProfileId()
    const profile: VortexProfile = { id, gameId, name, modState: source?.modState ? structuredClone(source.modState) : {}, lastActivated: 0 }
    if (!(await this.set(`persistent.profiles.${id}`, profile))) throw new Error('Vortex refused to save the new profile.')
    const check = await this.get<VortexProfile>(`persistent.profiles.${id}`)
    if (!check || check.name !== name) throw new Error('The new profile did not show up in Vortex after saving it.')
    return id
  }

  /** Registers a mod folder that Patchwright put in the staging folder, and enables it in one profile. */
  async registerMod(gameId: string, folder: string, name: string, version: string, profileId?: string): Promise<string[]> {
    if (await this.isRunning()) throw new Error('Close Vortex first; it locks its state while open.')
    const statePaths: string[] = []
    // Vortex state paths are dot-separated, so the mod id can't contain dots; the folder name can.
    const id = folder.replace(/[^\w-]/g, '_')
    const mod: VortexMod = {
      id,
      state: 'installed',
      installationPath: folder,
      attributes: { name, customFileName: name, version, installTime: new Date().toISOString(), notes: 'Made by Patchwright. Safe to disable or remove.' }
    }
    const modPath = `persistent.mods.${gameId}.${id}`
    if (!(await this.set(modPath, { ...mod, type: '' }))) throw new Error('Vortex refused to register the mod.')
    statePaths.push(modPath)
    if (profileId) {
      const sp = `persistent.profiles.${profileId}.modState.${id}`
      if (await this.set(sp, { enabled: true, enabledTime: Date.now() })) statePaths.push(sp)
    }
    return statePaths
  }
}
