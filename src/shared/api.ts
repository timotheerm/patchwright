import type {
  AppEvent,
  ChangelogEntry,
  CollectionInfo,
  CommunityReport,
  DeliveryResult,
  FixOutcome,
  FixRecord,
  FrameworkStatus,
  GameStatus,
  JobState,
  KnowledgeBase,
  LogFinding,
  LogLine,
  ModRef,
  PatchChange,
  RelevantKnowledge,
  Settings,
  TriageResult,
  VortexStatus
} from './types'

/** Everything the UI can ask the engine to do. Exposed on window.patchwright by the preload script. */
export interface PatchwrightApi {
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  detectPaths(): Promise<Partial<Settings>>

  getGameStatus(refresh?: boolean): Promise<GameStatus>
  getFrameworks(): Promise<FrameworkStatus[]>
  testAi(): Promise<{ ok: boolean; detail: string }>
  testNexus(): Promise<{ ok: boolean; detail: string }>

  vortexStatus(): Promise<VortexStatus>
  listInstalledMods(): Promise<ModRef[]>
  /** Accepts a Nexus mod URL or id, a collection URL, or a local folder path. */
  resolveInput(input: string): Promise<{ mods: ModRef[]; collection?: CollectionInfo; notes: string[] }>
  triage(mods: ModRef[]): Promise<TriageResult[]>
  checkCommunity(mod: ModRef): Promise<CommunityReport>

  startJob(triage: TriageResult): Promise<JobState>
  cancelJob(jobId: string): Promise<void>
  listJobs(): Promise<JobState[]>
  getJobLog(jobId: string): Promise<LogLine[]>
  readJobFile(jobId: string, relPath: string): Promise<string | null>
  deliverJob(jobId: string, mode: 'staging' | 'zip'): Promise<DeliveryResult>

  /** What to look at in game for each fix, from the mod's type. */
  getTestHints(jobIds: string[]): Promise<{ jobId: string; fixName: string; hints: string[] }[]>
  createTestProfile(): Promise<{ ok: boolean; message: string }>
  backupSaves(): Promise<{ ok: boolean; path?: string; message: string }>
  readTestLogs(sinceIso: string, modNames: string[]): Promise<LogFinding[]>
  summarizeTest(findings: LogFinding[], userNotes: string): Promise<string>

  /** Built-in and learned knowledge: patch changes, and fixes with their in-game outcome. */
  getKnowledge(): Promise<KnowledgeBase>
  saveKnowledgeEntry(kind: 'change' | 'fix', entry: PatchChange | FixRecord): Promise<KnowledgeBase>
  deleteKnowledgeEntry(id: string): Promise<KnowledgeBase>
  /** The knowledge a fix for this mod would start from. */
  knowledgeFor(t: TriageResult): Promise<RelevantKnowledge>
  recordOutcome(jobId: string, outcome: FixOutcome, note?: string): Promise<{ ok: boolean; message: string }>
  exportKnowledge(): Promise<{ ok: boolean; path?: string; message: string }>
  importKnowledge(file: string): Promise<{ ok: boolean; message: string }>

  getChangelog(): Promise<ChangelogEntry[]>
  undo(entryId: string): Promise<{ ok: boolean; message: string }>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  pickPath(kind: 'file' | 'folder', title: string): Promise<string | null>

  onEvent(cb: (e: AppEvent) => void): () => void
}

/** IPC channel names. Every method above maps to `pw:<name>`. */
export const API_METHODS = [
  'getSettings',
  'saveSettings',
  'detectPaths',
  'getGameStatus',
  'getFrameworks',
  'testAi',
  'testNexus',
  'vortexStatus',
  'listInstalledMods',
  'resolveInput',
  'triage',
  'checkCommunity',
  'startJob',
  'cancelJob',
  'listJobs',
  'getJobLog',
  'readJobFile',
  'deliverJob',
  'getTestHints',
  'createTestProfile',
  'backupSaves',
  'readTestLogs',
  'summarizeTest',
  'getKnowledge',
  'saveKnowledgeEntry',
  'deleteKnowledgeEntry',
  'knowledgeFor',
  'recordOutcome',
  'exportKnowledge',
  'importKnowledge',
  'getChangelog',
  'undo',
  'openPath',
  'openExternal',
  'pickPath'
] as const

export type ApiMethod = (typeof API_METHODS)[number]

export const EVENT_CHANNEL = 'pw:event'
