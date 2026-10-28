import type { CheckResult, Classification, GameId, KnowledgeBase, PatchInfo } from '../../shared/types'
import type { CoreContext } from '../context'

export interface FrameworkDef {
  id: string
  name: string
  nexusModId: number
  /** Files (game-relative, posix) whose presence means the framework is installed. */
  files: string[]
  /** Where to read the installed version: a PE file, or a log line. */
  versionFrom?: { pe?: string; log?: string; regex?: RegExp }
  /** Native code that must be rebuilt by its author for each game build. */
  native: boolean
  /** Known minimum versions per content patch. */
  minVersionFor?: Record<string, string>
  /** Text patterns in mod files that show a mod uses this framework. */
  usedBy?: RegExp[]
}

/** Paths a fix job works with. Everything lives inside `dir`. */
export interface JobWorkspace {
  dir: string
  originalDir: string // read-only copy of the mod as installed
  vanillaDir: string // vanilla files from the current game version
  unpackedDir: string // the mod's archives unpacked (and converted to JSON)
  reportsDir: string // triage, checks, logs
  outputDir: string // the fix, laid out like the game folder
  srcDir: string // editable sources that the build step turns into game files (JSON -> CR2W -> .archive)
  modName: string
  fixName: string
  patch: string
  classification: Classification
}

export interface AiRequests {
  /** Game-relative depot paths of vanilla files the AI wants extracted, e.g. base\characters\...\player.ent */
  vanilla?: string[]
  /** Regex over depot paths, for when the exact path is unknown. */
  vanillaRegex?: string[]
  /** Free-text question for the user; pauses the job. */
  question?: string
}

export interface GameAdapter {
  id: GameId
  name: string
  nexusDomain: string
  steamAppId: number
  vortexGameId: string
  bundledPatches: PatchInfo[]
  frameworks: FrameworkDef[]
  /** Markdown with general rules for updating mods for this game. Given to the AI on every job. */
  playbook: string
  /** Built-in knowledge: what past patches changed, and fixes that worked. Jobs pick the relevant parts. */
  knowledge: KnowledgeBase

  defaultInstallPaths(env: NodeJS.ProcessEnv): string[]
  defaultSavesPath(env: NodeJS.ProcessEnv): string
  detectInstalledVersion(gameDir: string): Promise<{ version?: string; source?: string }>

  classify(files: { rel: string; size: number }[], readText: (rel: string) => Promise<string>): Promise<Classification>

  /** Log files to scan after a test session. */
  logFiles(gameDir: string): Promise<{ source: string; file: string }[]>

  /** Cheap checks that run during triage (no AI). `modDir` is the installed mod folder. */
  staticChecks(modDir: string, c: Classification, ctx: CoreContext): Promise<CheckResult[]>

  /** Fills the job workspace beyond the plain copy: unpack archives, extract vanilla files, run checks. */
  prepareWorkspace(ws: JobWorkspace, ctx: CoreContext, log: (m: string) => void): Promise<CheckResult[]>
  fulfillRequests(ws: JobWorkspace, req: AiRequests, ctx: CoreContext, log: (m: string) => void): Promise<string[]>
  /** Turns srcDir into game files in outputDir, then checks the result. */
  buildAndVerify(ws: JobWorkspace, ctx: CoreContext, log: (m: string) => void): Promise<CheckResult[]>

  /** Step-by-step plan for the AI, from the mod's types. The first step points at the job's knowledge. */
  planFor(c: Classification): string[]

  /** What the user should look at in game for this kind of mod. */
  testHints(c: Classification): string[]
}
