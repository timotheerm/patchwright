import path from 'node:path'
import { promises as fs } from 'node:fs'
import AdmZip from 'adm-zip'
import type {
  AppEvent,
  ChangelogEntry,
  CollectionInfo,
  CommunityReport,
  DeliveryResult,
  FrameworkStatus,
  GameStatus,
  JobState,
  LogFinding,
  LogLine,
  ModRef,
  PatchInfo,
  Settings,
  TriageResult,
  VortexStatus
} from '../shared/types'
import { createBackend } from './ai'
import type { AiBackend } from './ai/types'
import { findClaudeCli } from './ai/claudeCli'
import { consoleLogger, defaultSettings, type CoreContext } from './context'
import { getGame } from './games'
import { findInstallCandidates } from './games/cyberpunk2077'
import type { GameAdapter } from './games/types'
import { COMMUNITY_AI_PROMPT, fetchPostsPage, parseAiCommunity, scanComments } from './sources/community'
import { NexusClient, parseNexusInput } from './sources/nexus'
import { fetchSteamPatches, pickPatches } from './sources/steam'
import { compareVersions, copyDir, dateOnly, ensureDir, exists, isDir, isInside, movePath, nowIso, readHead, readJson, readPeFileVersion, safeName, timestampSlug, walk, writeJson } from './util'
import { Vortex } from './vortex/vortex'
import { Changelog } from './workflow/changelog'
import { JobManager } from './workflow/jobs'
import { backupSaves, collectFindings, testSummaryPrompt } from './workflow/testing'
import { decideVerdict } from './workflow/triage'

export interface SecretCodec {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

export interface EngineOptions {
  dataDir: string
  appVersion: string
  emit: (e: AppEvent) => void
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  secrets?: SecretCodec
  /** Replaces the AI backend chosen in settings. Used by tests to script the AI. */
  backend?: (settings: Settings) => AiBackend
}

const SECRET_KEYS = ['nexusApiKey'] as const
const AI_SECRET_KEYS = ['anthropicApiKey', 'localApiKey'] as const

/** The whole engine behind one object. The Electron main process forwards UI calls to it. */
export class Engine {
  readonly ctx: CoreContext
  readonly jobs: JobManager
  private patchCache?: { at: number; baseline?: PatchInfo; latest?: PatchInfo; warnings: string[] }
  private fwCache?: { at: number; list: FrameworkStatus[] }
  private modsCache?: { at: number; list: ModRef[] }
  private state: { testProfileId?: string } = {}

  private constructor(
    private opts: EngineOptions,
    settings: Settings
  ) {
    this.ctx = {
      dataDir: opts.dataDir,
      settings,
      emit: opts.emit,
      log: consoleLogger(),
      fetch: opts.fetch ?? fetch,
      platform: opts.platform ?? process.platform,
      env: opts.env ?? process.env,
      appVersion: opts.appVersion
    }
    this.jobs = new JobManager({
      ctx: this.ctx,
      game: this.game,
      backend: () => this.backend(),
      patch: async () => (await this.patches()).baseline,
      frameworks: () => this.frameworks(),
      installedMods: () => this.listInstalledMods()
    })
  }

  static async create(opts: EngineOptions): Promise<Engine> {
    const env = opts.env ?? process.env
    const stored = await readJson<Partial<Settings>>(path.join(opts.dataDir, 'settings.json'), {})
    const base = defaultSettings(env)
    const settings: Settings = {
      ...base,
      ...stored,
      ai: { ...base.ai, ...(stored.ai ?? {}) },
      toolCommands: { ...base.toolCommands, ...(stored.toolCommands ?? {}) }
    }
    const dec = (v?: string): string | undefined => (v && opts.secrets ? safeDecrypt(opts.secrets, v) : v)
    for (const k of SECRET_KEYS) settings[k] = dec(settings[k])
    for (const k of AI_SECRET_KEYS) settings.ai[k] = dec(settings.ai[k])
    const e = new Engine(opts, settings)
    e.state = await readJson(path.join(opts.dataDir, 'state.json'), {})
    await e.jobs.load()
    return e
  }

  get game(): GameAdapter {
    return getGame(this.ctx.settings.gameId)
  }

  get settings(): Settings {
    return this.ctx.settings
  }

  private get backupsDir(): string {
    return this.settings.backupsPath ?? path.join(this.ctx.dataDir, 'backups')
  }

  private changelog(): Changelog {
    return new Changelog(this.backupsDir)
  }

  // ---------- settings ----------

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const s = this.ctx.settings
    const next: Settings = {
      ...s,
      ...patch,
      ai: { ...s.ai, ...(patch.ai ?? {}) },
      toolCommands: { ...s.toolCommands, ...(patch.toolCommands ?? {}) }
    }
    this.ctx.settings = next
    this.patchCache = undefined
    this.fwCache = undefined
    this.modsCache = undefined
    const enc = (v?: string): string | undefined => (v && this.opts.secrets ? this.opts.secrets.encrypt(v) : v)
    const toStore = structuredClone(next)
    for (const k of SECRET_KEYS) toStore[k] = enc(toStore[k])
    for (const k of AI_SECRET_KEYS) toStore.ai[k] = enc(toStore.ai[k])
    await writeJson(path.join(this.ctx.dataDir, 'settings.json'), toStore)
    return next
  }

  /** Finds the game, Vortex, its staging folder, WolvenKit and Claude Code on this PC. */
  async detectPaths(): Promise<Partial<Settings>> {
    const env = this.ctx.env
    const out: Partial<Settings> = {}
    const games = await findInstallCandidates(env)
    if (games[0]) out.gamePath = games[0]
    const v = Vortex.defaults(env)
    if (v.exe && (await exists(v.exe))) out.vortexExe = v.exe
    if (v.appData) out.vortexAppData = v.appData
    const staging = await this.findStaging(new Vortex({ ...v, exe: out.vortexExe }))
    if (staging) out.vortexStagingPath = staging
    out.savesPath = this.game.defaultSavesPath(env)
    const home = env.USERPROFILE ?? env.HOME ?? ''
    const downloads = path.join(home, 'Downloads')
    const wk = await findWolvenKitCli(downloads)
    if (wk) out.wolvenkitCli = wk
    const claude = await findClaudeCli(env, this.ctx.platform)
    if (claude) out.ai = { ...this.settings.ai, claudeCliPath: claude }
    // Keep using a backups folder the user already has, so the changelog stays in one place.
    const existingBackups = path.join(downloads, 'CP2077 backups')
    if (await isDir(existingBackups)) out.backupsPath = existingBackups
    return out
  }

  private async findStaging(vortex: Vortex): Promise<string | undefined> {
    const gameId = this.game.vortexGameId
    if (vortex.paths.exe && !(await vortex.isRunning())) {
      const p = await vortex.get<Record<string, string>>('settings.mods.installPath')
      const raw = p && typeof p === 'object' ? p[gameId] : undefined
      if (raw) {
        const resolved = raw
          .replace(/\{game\}/gi, gameId)
          .replace(/\{userdata\}/gi, vortex.paths.appData ?? '')
          .replace(/\{USERDATA\}/g, vortex.paths.appData ?? '')
        if (await isDir(resolved)) return resolved
      }
    }
    const candidates = [vortex.paths.stagingPath, ...['C', 'D', 'E', 'F'].map((d) => `${d}:\\Vortex Mods\\${gameId}`)]
    for (const c of candidates) if (c && (await exists(path.join(c, '__folder_managed_by_vortex')))) return c
    for (const c of candidates) if (c && (await isDir(c))) return c
    return undefined
  }

  // ---------- game, patches, frameworks ----------

  async patches(refresh = false): Promise<{ baseline?: PatchInfo; latest?: PatchInfo; warnings: string[] }> {
    if (this.patchCache && !refresh && Date.now() - this.patchCache.at < 3600_000) return this.patchCache
    const warnings: string[] = []
    const o = this.settings.patchOverride
    if (o?.version && o.releaseDate) {
      const p: PatchInfo = { version: o.version, releaseDate: o.releaseDate, source: 'manual' }
      this.patchCache = { at: Date.now(), baseline: p, latest: p, warnings }
      return this.patchCache
    }
    let live: PatchInfo[] = []
    try {
      live = await fetchSteamPatches(this.game.steamAppId, this.ctx.fetch)
    } catch (e) {
      warnings.push(`Couldn't read Steam news (${e instanceof Error ? e.message : String(e)}); using the built-in patch list.`)
    }
    const picked = pickPatches(live, this.game.bundledPatches)
    this.patchCache = { at: Date.now(), ...picked, warnings }
    return this.patchCache
  }

  async gameStatus(refresh = false): Promise<GameStatus> {
    const { baseline, latest, warnings } = await this.patches(refresh)
    const st: GameStatus = { gameId: this.game.id, name: this.game.name, baselinePatch: baseline, latestBuild: latest, warnings: [...warnings] }
    const dir = this.settings.gamePath
    if (!dir || !(await exists(dir))) {
      st.warnings.push('Game folder not set or not found. Set it in Settings.')
      return st
    }
    st.installPath = dir
    if (this.settings.installedVersionOverride) {
      st.installedVersion = this.settings.installedVersionOverride
      st.installedVersionSource = 'set in Settings'
    } else {
      const v = await this.game.detectInstalledVersion(dir)
      st.installedVersion = v.version
      st.installedVersionSource = v.source
    }
    if (st.installedVersion && latest) {
      const plain = st.installedVersion.replace(/ or later$/, '')
      st.upToDate = compareVersions(plain, latest.version) >= 0 || (st.installedVersion.endsWith('or later') && compareVersions(plain, baseline?.version ?? plain) >= 0)
    }
    return st
  }

  async frameworks(): Promise<FrameworkStatus[]> {
    if (this.fwCache && Date.now() - this.fwCache.at < 600_000) return this.fwCache.list
    const dir = this.settings.gamePath
    const { baseline } = await this.patches()
    const nexus = this.nexus()
    const list: FrameworkStatus[] = []
    for (const def of this.game.frameworks) {
      const s: FrameworkStatus = { id: def.id, name: def.name, nexusModId: def.nexusModId, installed: false, state: 'unknown' }
      if (dir) {
        s.installed = (await Promise.all(def.files.map((f) => exists(path.join(dir, ...f.split('/')))))).every(Boolean)
        if (s.installed && def.versionFrom?.pe) s.installedVersion = await readPeFileVersion(path.join(dir, ...def.versionFrom.pe.split('/')))
        if (s.installed && !s.installedVersion && def.versionFrom?.log && def.versionFrom.regex) {
          const head = await readHead(path.join(dir, ...def.versionFrom.log.split('/')))
          s.installedVersion = head.match(def.versionFrom.regex)?.[1]
        }
      }
      s.minVersionForPatch = baseline ? def.minVersionFor?.[baseline.version] : undefined
      if (nexus.hasKey) {
        try {
          const info = await nexus.getModInfo(this.game.nexusDomain, def.nexusModId, undefined, baseline?.version)
          s.latestVersion = info.latestFileVersion ?? info.version
          s.latestDate = info.latestFileDate ?? info.updatedAt
        } catch {
          /* offline or rate limited */
        }
      }
      s.state = frameworkState(s, baseline)
      list.push(s)
    }
    this.fwCache = { at: Date.now(), list }
    return list
  }

  // ---------- services ----------

  nexus(): NexusClient {
    return new NexusClient(this.settings.nexusApiKey, path.join(this.ctx.dataDir, 'cache', 'nexus'), this.ctx.fetch, this.ctx.appVersion)
  }

  vortex(): Vortex {
    const d = Vortex.defaults(this.ctx.env)
    return new Vortex(
      { exe: this.settings.vortexExe ?? d.exe, appData: this.settings.vortexAppData ?? d.appData, stagingPath: this.settings.vortexStagingPath ?? d.stagingPath },
      this.ctx.platform
    )
  }

  backend(): AiBackend {
    return this.opts.backend?.(this.settings) ?? createBackend(this.settings.ai, this.ctx.fetch)
  }

  testAi(): Promise<{ ok: boolean; detail: string }> {
    return this.backend().test()
  }

  async testNexus(): Promise<{ ok: boolean; detail: string }> {
    try {
      const me = await this.nexus().validate()
      return { ok: true, detail: `Signed in as ${me.name}${me.premium ? ' (Premium)' : ''}.` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  vortexStatus(): Promise<VortexStatus> {
    return this.vortex().status(this.game.vortexGameId)
  }

  async listInstalledMods(): Promise<ModRef[]> {
    if (this.modsCache && Date.now() - this.modsCache.at < 30_000) return this.modsCache.list
    const list = await this.vortex().listMods(this.game.vortexGameId)
    this.modsCache = { at: Date.now(), list }
    return list
  }

  async resolveInput(input: string): Promise<{ mods: ModRef[]; collection?: CollectionInfo; notes: string[] }> {
    const notes: string[] = []
    const trimmed = input.trim().replace(/^"|"$/g, '')
    const installed = await this.listInstalledMods()
    const byNexus = (id: number): ModRef | undefined => installed.find((m) => m.nexusModId === id)

    const parsed = parseNexusInput(trimmed, this.game.nexusDomain)
    if (parsed?.kind === 'collection') {
      const { info, mods } = await this.nexus().getCollection(parsed.domain, parsed.slug, parsed.revision)
      const resolved = mods.map((m) => {
        const inst = m.nexusModId ? byNexus(m.nexusModId) : undefined
        return inst ? { ...inst, optional: m.optional } : m
      })
      const missing = resolved.filter((m) => !m.stagingPath).length
      if (missing) notes.push(`${missing} of ${resolved.length} mods in this collection aren't installed. Install the collection with Vortex (in a new profile) so they can be checked and fixed.`)
      return { mods: resolved, collection: info, notes }
    }
    if (parsed?.kind === 'mod') {
      if (parsed.domain !== this.game.nexusDomain) notes.push(`That link is for ${parsed.domain}, not ${this.game.name}.`)
      const inst = byNexus(parsed.modId)
      if (inst) return { mods: [{ ...inst, nexusFileId: inst.nexusFileId ?? parsed.fileId }], notes }
      let name = `Nexus mod ${parsed.modId}`
      if (this.nexus().hasKey) {
        try {
          name = (await this.nexus().getModRaw(parsed.domain, parsed.modId)).name ?? name
        } catch {
          /* keep the placeholder name */
        }
      }
      notes.push(`"${name}" isn't installed. It can be checked against the patch, but a fix needs it installed with Vortex.`)
      return { mods: [{ key: `nexus:${parsed.modId}`, name, nexusModId: parsed.modId, nexusFileId: parsed.fileId, source: 'nexus' }], notes }
    }
    if (await isDir(trimmed)) {
      return { mods: [{ key: trimmed, name: path.basename(trimmed), stagingPath: trimmed, source: 'local' }], notes }
    }
    const q = trimmed.toLowerCase()
    const matches = installed.filter((m) => m.name.toLowerCase().includes(q))
    if (!matches.length) notes.push("That isn't a Nexus link, a mod id, a folder, or the name of an installed mod.")
    return { mods: matches, notes }
  }

  // ---------- triage ----------

  async triage(mods: ModRef[]): Promise<TriageResult[]> {
    const out: TriageResult[] = []
    let done = 0
    for (const m of mods) {
      this.ctx.emit({ type: 'triage-progress', done, total: mods.length, current: m.name })
      let r: TriageResult
      try {
        r = await this.triageOne(m)
      } catch (e) {
        r = { mod: m, checks: [], verdict: 'unknown', reasons: [`Check failed: ${e instanceof Error ? e.message : String(e)}`], action: 'none', checkedAt: nowIso() }
      }
      out.push(r)
      this.ctx.emit({ type: 'triage-result', result: r })
      done++
    }
    this.ctx.emit({ type: 'triage-progress', done, total: mods.length })
    await writeJson(path.join(this.ctx.dataDir, 'last-triage.json'), out).catch(() => {})
    return out
  }

  async triageOne(mod: ModRef): Promise<TriageResult> {
    const { baseline } = await this.patches()
    const frameworks = await this.frameworks()
    const result: TriageResult = { mod, checks: [], verdict: 'unknown', reasons: [], action: 'none', checkedAt: nowIso() }
    if (mod.stagingPath && (await isDir(mod.stagingPath))) {
      const files = await walk(mod.stagingPath)
      const dir = mod.stagingPath
      result.classification = await this.game.classify(
        files.map((f) => ({ rel: f.rel, size: f.size })),
        (rel) => fs.readFile(path.join(dir, ...rel.split('/')), 'utf8').catch(() => '')
      )
      result.checks = await this.game.staticChecks(dir, result.classification, this.ctx)
    }
    if (mod.nexusModId && this.nexus().hasKey) {
      try {
        result.nexus = await this.nexus().getModInfo(this.game.nexusDomain, mod.nexusModId, mod.nexusFileId, baseline?.version)
      } catch (e) {
        result.reasons.push(`Nexus lookup failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const notUpdated = !result.nexus || (baseline && (dateOnly(result.nexus.latestFileDate ?? result.nexus.updatedAt) ?? '') < baseline.releaseDate)
    if (this.settings.communityChecks && mod.nexusModId && notUpdated && !result.classification?.isFramework) {
      result.community = await this.checkCommunity(mod).catch((e) => ({
        checkedAt: nowIso(),
        works: 0,
        broken: 0,
        snippets: [],
        source: 'keyword' as const,
        error: e instanceof Error ? e.message : String(e)
      }))
    }
    const v = decideVerdict({
      patch: baseline,
      nexus: result.nexus,
      installedVersion: mod.version,
      classification: result.classification,
      community: result.community,
      checks: result.checks,
      frameworks
    })
    result.verdict = v.verdict
    result.action = v.action
    result.reasons = [...v.reasons, ...result.reasons]
    if (!mod.stagingPath) result.reasons.push('Not installed, so its files were not checked.')
    return result
  }

  async checkCommunity(mod: ModRef): Promise<CommunityReport> {
    const { baseline } = await this.patches()
    const version = baseline?.version ?? ''
    if (!mod.nexusModId) throw new Error('This mod has no Nexus id.')
    const url = `https://www.nexusmods.com/${this.game.nexusDomain}/mods/${mod.nexusModId}`
    const backend = this.backend()
    if (this.settings.communityViaAi && backend.canBrowse) {
      const text = await backend.ask(COMMUNITY_AI_PROMPT(url, version), { webDomains: ['nexusmods.com', 'www.nexusmods.com'] })
      return parseAiCommunity(text)
    }
    const comments = await fetchPostsPage(this.game.nexusDomain, mod.nexusModId, this.ctx.fetch)
    return scanComments(comments, version)
  }

  // ---------- jobs ----------

  startJob(t: TriageResult): Promise<JobState> {
    return this.jobs.start(t)
  }

  cancelJob(id: string): void {
    this.jobs.cancel(id)
  }

  listJobs(): JobState[] {
    return this.jobs.list()
  }

  getJobLog(id: string): LogLine[] {
    return this.jobs.getLog(id)
  }

  async readJobFile(id: string, rel: string): Promise<string | null> {
    const job = this.jobs.get(id)
    if (!job) return null
    const p = path.resolve(job.dir, rel)
    if (!isInside(job.dir, p)) return null
    return fs.readFile(p, 'utf8').catch(() => null)
  }

  /**
   * Installs a finished fix as its own mod: a new folder in the Vortex staging folder (shown in
   * Vortex after a restart), or a zip to drag into Vortex. Nothing in the game folder is touched.
   */
  async deliverJob(id: string, mode: 'staging' | 'zip'): Promise<DeliveryResult> {
    const job = this.jobs.get(id)
    if (!job) return { ok: false, message: 'Job not found.' }
    if (!['ready', 'delivered'].includes(job.status)) return { ok: false, message: 'The fix has not passed its checks yet.' }
    const files = await walk(job.outputDir)
    if (!files.length) return { ok: false, message: 'The fix has no files.' }
    const folder = safeName(job.fixName)
    const log = this.changelog()

    if (mode === 'zip') {
      const dir = path.join(this.backupsDir, 'fixes')
      await ensureDir(dir)
      const zipPath = path.join(dir, `${folder}.zip`)
      const zip = new AdmZip()
      zip.addLocalFolder(job.outputDir)
      zip.writeZip(zipPath)
      await log.add('Packed fix as zip', zipPath, `${files.length} files from job ${job.id}. Drag it into Vortex's Mods tab.`, { type: 'remove-path', path: zipPath })
      await this.jobs.markDelivered(id, zipPath)
      return { ok: true, path: zipPath, message: `Saved ${zipPath}. Drag it into Vortex's Mods tab, enable it in your test profile, and deploy.` }
    }

    const staging = this.settings.vortexStagingPath
    if (!staging || !(await isDir(staging))) return { ok: false, message: 'Vortex staging folder is not set. Set it in Settings, or save the fix as a zip.' }
    const dest = path.join(staging, folder)
    if (await exists(dest)) {
      const backup = path.join(this.backupsDir, 'replaced', timestampSlug(), folder)
      await movePath(dest, backup)
      await log.add('Backed up previous fix', dest, `Moved to ${backup}.`, { type: 'restore-path', backup, path: dest })
    }
    await copyDir(job.outputDir, dest)
    await log.add('Installed fix into Vortex staging', dest, `${files.length} files from job ${job.id} for "${job.modName}".`, { type: 'remove-path', path: dest })
    let vortexRegistered = false
    let extra = 'Restart Vortex: the fix shows up as a new mod. Enable it in your test profile and deploy.'
    if (this.settings.vortexAutomation) {
      try {
        const v = this.vortex()
        const paths = await v.registerMod(this.game.vortexGameId, folder, job.fixName, '1.0.0', this.state.testProfileId)
        for (const p of paths) await log.add('Registered in Vortex', p, `For "${job.fixName}".`, { type: 'vortex-del', statePath: p })
        vortexRegistered = true
        extra = 'It is registered in Vortex and enabled in the test profile. Open Vortex, switch to that profile, and deploy.'
      } catch (e) {
        extra = `Couldn't register it in Vortex (${e instanceof Error ? e.message : String(e)}). Restart Vortex and enable it by hand.`
      }
    }
    await this.jobs.markDelivered(id, dest)
    return { ok: true, path: dest, vortexRegistered, message: `Copied to ${dest}. ${extra}` }
  }

  // ---------- testing ----------

  async getTestHints(jobIds: string[]): Promise<{ jobId: string; fixName: string; hints: string[] }[]> {
    const out: { jobId: string; fixName: string; hints: string[] }[] = []
    for (const id of jobIds) {
      const job = this.jobs.get(id)
      if (!job) continue
      const t = await readJson<TriageResult | null>(path.join(job.dir, 'triage.json'), null)
      out.push({ jobId: id, fixName: job.fixName, hints: t?.classification ? this.game.testHints(t.classification) : [] })
    }
    return out
  }

  async createTestProfile(): Promise<{ ok: boolean; message: string }> {
    const v = this.vortex()
    const { baseline } = await this.patches()
    const name = this.settings.testProfileName.replace('{patch}', baseline?.version ?? 'patch')
    if (await v.isRunning()) return { ok: false, message: `Close Vortex, then try again. Or create a profile named "${name}" in Vortex yourself (Profiles > Clone current).` }
    try {
      const gameId = this.game.vortexGameId
      const id = await v.createProfile(gameId, name, await v.activeProfileId(gameId))
      this.state.testProfileId = id
      await writeJson(path.join(this.ctx.dataDir, 'state.json'), this.state)
      await this.changelog().add('Created Vortex profile', name, `Profile ${id}, a copy of your active profile.`, { type: 'vortex-del', statePath: `persistent.profiles.${id}` })
      return { ok: true, message: `Created the Vortex profile "${name}". Switch to it in Vortex before installing fixes.` }
    } catch (e) {
      return { ok: false, message: `${e instanceof Error ? e.message : String(e)} You can create a profile named "${name}" in Vortex yourself (Profiles > Clone current).` }
    }
  }

  async backupSaves(): Promise<{ ok: boolean; path?: string; message: string }> {
    const saves = this.settings.savesPath ?? this.game.defaultSavesPath(this.ctx.env)
    try {
      const r = await backupSaves(saves, this.backupsDir)
      await this.changelog().add('Backed up saves', r.path, `${r.count} saves copied from ${saves}.`)
      return { ok: true, path: r.path, message: `Backed up ${r.count} saves to ${r.path}.` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  async readTestLogs(sinceIso: string, modNames: string[]): Promise<LogFinding[]> {
    const dir = this.settings.gamePath
    if (!dir) return []
    return collectFindings(await this.game.logFiles(dir), sinceIso, modNames)
  }

  async summarizeTest(findings: LogFinding[], notes: string): Promise<string> {
    const { baseline } = await this.patches()
    return this.backend().ask(testSummaryPrompt(findings, notes, baseline?.version ?? ''))
  }

  // ---------- history ----------

  getChangelog(): Promise<ChangelogEntry[]> {
    return this.changelog().list()
  }

  undo(id: string): Promise<{ ok: boolean; message: string }> {
    return this.changelog().undo(id, (p) => this.vortex().del(p))
  }
}

function safeDecrypt(codec: SecretCodec, v: string): string | undefined {
  try {
    return codec.decrypt(v)
  } catch {
    return undefined
  }
}

export function frameworkState(s: FrameworkStatus, baseline: PatchInfo | undefined): FrameworkStatus['state'] {
  if (!s.installed) return 'missing'
  if (s.minVersionForPatch && s.installedVersion) {
    if (compareVersions(s.installedVersion, s.minVersionForPatch) < 0) {
      s.note = `${s.minVersionForPatch} or newer supports ${baseline?.version}`
      return 'outdated'
    }
    return 'ok'
  }
  if (s.latestDate && baseline) {
    if (s.latestDate.slice(0, 10) < baseline.releaseDate) {
      s.note = `No release since ${baseline.version} came out`
      return 'no-patch-build'
    }
    if (s.installedVersion && s.latestVersion && compareVersions(s.installedVersion, s.latestVersion) < 0) {
      s.note = `${s.latestVersion} is out`
      return 'outdated'
    }
    return 'ok'
  }
  return 'unknown'
}

/** Looks for WolvenKit's command line tool in Downloads, preferring the newest version. */
async function findWolvenKitCli(downloads: string): Promise<string | undefined> {
  if (!(await isDir(downloads))) return undefined
  const found: string[] = []
  for (const e of await fs.readdir(downloads, { withFileTypes: true })) {
    if (!e.isDirectory() || !/wolvenkit/i.test(e.name)) continue
    for (const name of ['WolvenKit.CLI.exe', 'WolvenKit.Console.exe', 'WolvenKit.CLI']) {
      const p = path.join(downloads, e.name, name)
      if (await exists(p)) found.push(p)
    }
  }
  const version = (p: string): string => p.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? '0'
  return found.sort((a, b) => compareVersions(version(b), version(a)))[0]
}
