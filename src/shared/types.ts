// Types shared by the engine (main process) and the UI (renderer).

export type GameId = 'cyberpunk2077'

/** What a mod file is, which decides how it can break and how it can be fixed. */
export type ModKind =
  | 'archive' // .archive (packed game assets)
  | 'archivexl' // .xl (ArchiveXL resource patches, sector edits)
  | 'tweakxl' // r6/tweaks *.yaml / *.tweak (TweakDB edits)
  | 'redscript' // .reds scripts
  | 'cet' // Cyber Engine Tweaks Lua mods
  | 'red4ext' // RED4ext native plugins (.dll)
  | 'asi' // ASI loader plugins
  | 'ini' // engine config
  | 'other'

export type Verdict =
  | 'framework' // the mod is a framework (RED4ext, ArchiveXL, ...), never patched by the app
  | 'update-available' // the author released a version after the patch, and it isn't installed
  | 'updated-after-patch' // installed version was released after the patch
  | 'reported-working' // not updated, but users report it works on the patch
  | 'reported-broken' // users report it is broken on the patch
  | 'not-updated' // last release predates the patch, needs checking
  | 'binary-wait' // native plugin, only its author can update it
  | 'unknown'

export type RecommendedAction =
  | 'none'
  | 'update-in-vortex'
  | 'update-framework'
  | 'test-in-game'
  | 'ai-fix'
  | 'wait-for-author'

export interface PatchInfo {
  version: string
  /** ISO date (yyyy-mm-dd or full ISO). */
  releaseDate: string
  title?: string
  url?: string
  /** Content patch (x.y) or hotfix (x.yz). Mods are compared against the latest content patch. */
  isHotfix?: boolean
  source: 'steam' | 'bundled' | 'manual'
}

export interface GameStatus {
  gameId: GameId
  name: string
  installPath?: string
  installedVersion?: string
  installedVersionSource?: string
  /** Latest content patch, the baseline mods are compared against. */
  baselinePatch?: PatchInfo
  /** Latest build of any kind, including hotfixes. */
  latestBuild?: PatchInfo
  upToDate?: boolean
  warnings: string[]
}

export type FrameworkState = 'ok' | 'outdated' | 'missing' | 'no-patch-build' | 'unknown'

export interface FrameworkStatus {
  id: string
  name: string
  nexusModId: number
  installed: boolean
  installedVersion?: string
  minVersionForPatch?: string
  latestVersion?: string
  latestDate?: string
  state: FrameworkState
  note?: string
}

export interface ModRef {
  /** Stable key: vortex id, "nexus:<id>", or a folder name. */
  key: string
  name: string
  nexusModId?: number
  nexusFileId?: number
  version?: string
  vortexId?: string
  stagingPath?: string
  enabled?: boolean
  installedAt?: string
  source: 'vortex' | 'staging' | 'nexus' | 'collection' | 'local'
  optional?: boolean
}

export interface ModFileInfo {
  relPath: string
  kind: ModKind
  size: number
}

export interface Classification {
  kinds: ModKind[]
  files: ModFileInfo[]
  frameworksUsed: string[]
  /** Set when the mod *is* a framework. */
  isFramework?: string
  risk: 'low' | 'medium' | 'high'
  aiFixable: boolean
  notes: string[]
}

export interface NexusModInfo {
  modId: number
  name: string
  version?: string
  author?: string
  summary?: string
  url: string
  updatedAt?: string
  latestFileDate?: string
  latestFileVersion?: string
  installedFileDate?: string
  installedFileVersion?: string
  /** Sentences from the description or summary that mention the patch or compatibility. */
  descriptionMentions: string[]
  available: boolean
}

export interface CommunitySnippet {
  text: string
  verdict: 'works' | 'broken' | 'neutral'
}

export interface CommunityReport {
  checkedAt: string
  works: number
  broken: number
  snippets: CommunitySnippet[]
  summary?: string
  source: 'keyword' | 'ai'
  error?: string
}

export interface CheckResult {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn' | 'skipped'
  details: string[]
}

export interface TriageResult {
  mod: ModRef
  nexus?: NexusModInfo
  classification?: Classification
  community?: CommunityReport
  checks: CheckResult[]
  verdict: Verdict
  reasons: string[]
  action: RecommendedAction
  checkedAt: string
}

export type JobStatus =
  | 'queued'
  | 'preparing'
  | 'running-ai'
  | 'verifying'
  | 'ready'
  | 'delivered'
  | 'failed'
  | 'cancelled'

export interface JobStep {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
}

export interface JobState {
  id: string
  modKey: string
  modName: string
  createdAt: string
  updatedAt: string
  status: JobStatus
  round: number
  maxRounds: number
  steps: JobStep[]
  dir: string
  outputDir: string
  backend: string
  sessionId?: string
  costUsd?: number
  summary?: string
  error?: string
  deliveredTo?: string
  /** Name of the fix mod, e.g. "ReLUX - 2.5 fix (Patchwright)". */
  fixName: string
  /** What the user found when testing the fix in game. */
  outcome?: FixOutcome
}

export interface LogLine {
  ts: string
  level: 'info' | 'warn' | 'error' | 'ai' | 'tool'
  text: string
}

export type AiBackendKind = 'claude-cli' | 'claude-api' | 'openai-compatible'

export interface AiSettings {
  backend: AiBackendKind
  /** Claude model for the API and Claude Code backends. Empty means the CLI's own default. */
  claudeModel: string
  anthropicApiKey?: string
  claudeCliPath?: string
  /** OpenAI-compatible endpoint, e.g. LM Studio at http://localhost:1234/v1 */
  baseUrl: string
  localModel?: string
  localApiKey?: string
  maxRounds: number
  maxTurns: number
  maxBudgetUsd?: number
}

export interface ToolCommands {
  /** Templates; {cli}, {in}, {out}, {regex} are filled in. Arguments are split on spaces outside quotes. */
  wkUnbundle: string
  wkSerialize: string
  wkDeserialize: string
  wkPack: string
  redscriptCompile: string
}

export interface Settings {
  gameId: GameId
  gamePath?: string
  vortexExe?: string
  vortexAppData?: string
  vortexStagingPath?: string
  wolvenkitCli?: string
  redscriptCli?: string
  backupsPath?: string
  workspacePath?: string
  savesPath?: string
  nexusApiKey?: string
  ai: AiSettings
  toolCommands: ToolCommands
  /** Read Nexus posts for "works on <patch>" reports. */
  communityChecks: boolean
  /** Let Claude read Nexus pages itself (WebFetch limited to nexusmods.com). */
  communityViaAi: boolean
  /** Name for fix mods. {name} and {patch} are filled in. */
  fixNameTemplate: string
  /** Register fixes and the test profile in Vortex through its command line (experimental, Vortex must be closed). */
  vortexAutomation: boolean
  testProfileName: string
  patchOverride?: { version: string; releaseDate: string }
  installedVersionOverride?: string
  onboarded: boolean
}

export interface VortexStatus {
  found: boolean
  exe?: string
  appData?: string
  stagingPath?: string
  running: boolean
  stateReadable: boolean
  activeProfile?: { id: string; name: string }
  profiles: { id: string; name: string }[]
  modCount: number
  notes: string[]
}

export interface CollectionInfo {
  slug: string
  name?: string
  revision?: number
  domain: string
  modCount: number
}

export interface LogFinding {
  source: string
  file: string
  level: 'error' | 'warn'
  text: string
  mod?: string
}

export interface ChangelogEntry {
  id: string
  ts: string
  action: string
  target: string
  details: string
  undo?: UndoAction
  undoneAt?: string
}

export type UndoAction =
  | { type: 'remove-path'; path: string }
  | { type: 'restore-path'; backup: string; path: string }
  | { type: 'vortex-del'; statePath: string }

export interface DeliveryResult {
  ok: boolean
  path?: string
  message: string
  vortexRegistered?: boolean
}

export type AppEvent =
  | { type: 'job'; job: JobState }
  | { type: 'job-log'; jobId: string; line: LogLine }
  | { type: 'triage-progress'; done: number; total: number; current?: string }
  | { type: 'triage-result'; result: TriageResult }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }

// ---------- knowledge base ----------

/** How a fix turned out in game. Untested fixes passed Patchwright's checks but nobody has played with them yet. */
export type FixOutcome = 'works' | 'partial' | 'failed' | 'untested'

export type KnowledgeSource = 'built-in' | 'learned' | 'user'

/** Something a game patch changed that breaks mods. */
export interface PatchChange {
  id: string
  gameId: GameId
  /** Content patch it came with, e.g. "2.5". */
  patch: string
  /** What changed, in one or two sentences. */
  summary: string
  /** Mod types it breaks. Empty means any type. */
  affects: ModKind[]
  /** How the breakage shows up in game or in logs. */
  symptoms?: string
  /** What to do about it. */
  remedy?: string
  /** Lower-case words or paths that show a mod is affected, matched against its files and reports. */
  keywords: string[]
  source: KnowledgeSource
  fromJob?: string
  addedAt: string
}

/** A fix that was made for one mod, and what came of it. */
export interface FixRecord {
  id: string
  gameId: GameId
  patch: string
  modName: string
  nexusModId?: number
  kinds: ModKind[]
  frameworks: string[]
  /** What was broken and why. */
  problem: string
  /** How it was fixed, step by step in prose. */
  approach: string
  /** Things to remember for the next mod like this one. */
  lessons: string[]
  keywords: string[]
  outcome: FixOutcome
  outcomeNote?: string
  source: KnowledgeSource
  fromJob?: string
  addedAt: string
  updatedAt: string
}

export interface KnowledgeBase {
  changes: PatchChange[]
  fixes: FixRecord[]
}

export interface Scored<T> {
  entry: T
  score: number
  /** Why it was picked, for the user and the AI. */
  why: string[]
}

export interface RelevantKnowledge {
  changes: Scored<PatchChange>[]
  fixes: Scored<FixRecord>[]
}
