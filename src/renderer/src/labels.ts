import type { FixOutcome, FrameworkState, JobStatus, KnowledgeSource, ModKind, RecommendedAction, TriageResult, Verdict } from '../../shared/types'

export type Tone = 'green' | 'amber' | 'red' | 'cyan' | 'violet' | 'gray' | 'yellow'

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  framework: { label: 'Framework', tone: 'violet' },
  'update-available': { label: 'Update on Nexus', tone: 'cyan' },
  'updated-after-patch': { label: 'Updated after patch', tone: 'green' },
  'reported-working': { label: 'Reported working', tone: 'green' },
  'reported-broken': { label: 'Reported broken', tone: 'red' },
  'not-updated': { label: 'Not updated', tone: 'amber' },
  'binary-wait': { label: 'Wait for author', tone: 'gray' },
  unknown: { label: 'Unknown', tone: 'gray' }
}

export const ACTION: Record<RecommendedAction, string> = {
  none: 'Nothing to do',
  'update-in-vortex': 'Update it in Vortex',
  'update-framework': 'Update a framework first',
  'test-in-game': 'Test it in game',
  'ai-fix': 'Make a fix',
  'wait-for-author': 'Wait for the author'
}

export const KIND: Record<ModKind, string> = {
  archive: 'archive',
  archivexl: 'ArchiveXL',
  tweakxl: 'TweakXL',
  redscript: 'redscript',
  cet: 'CET',
  red4ext: 'RED4ext',
  asi: 'ASI',
  ini: 'ini',
  other: 'other'
}

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'gray' },
  preparing: { label: 'Preparing', tone: 'cyan' },
  'running-ai': { label: 'AI working', tone: 'cyan' },
  verifying: { label: 'Checking', tone: 'cyan' },
  ready: { label: 'Ready to test', tone: 'yellow' },
  delivered: { label: 'Installed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' }
}

export const FRAMEWORK_STATE: Record<FrameworkState, { label: string; tone: Tone }> = {
  ok: { label: 'Ready', tone: 'green' },
  outdated: { label: 'Update it', tone: 'amber' },
  missing: { label: 'Not installed', tone: 'gray' },
  'no-patch-build': { label: 'No patch build yet', tone: 'red' },
  unknown: { label: 'Unknown', tone: 'gray' }
}

export type Group = 'all' | 'fix' | 'update' | 'test' | 'wait' | 'ok'

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fix', label: 'Needs a fix' },
  { id: 'update', label: 'Update available' },
  { id: 'test', label: 'Test in game' },
  { id: 'wait', label: 'Wait for author' },
  { id: 'ok', label: 'Fine' }
]

export function groupOf(r: TriageResult): Group {
  switch (r.action) {
    case 'ai-fix':
      return 'fix'
    case 'update-in-vortex':
    case 'update-framework':
      return 'update'
    case 'test-in-game':
      return 'test'
    case 'wait-for-author':
      return 'wait'
    default:
      return 'ok'
  }
}

export const isRunning = (s: JobStatus): boolean => s === 'queued' || s === 'preparing' || s === 'running-ai' || s === 'verifying'

/** Display names for the framework ids the engine reports in Classification.frameworksUsed. */
export const FRAMEWORK_NAMES: Record<string, string> = {
  red4ext: 'RED4ext',
  cet: 'Cyber Engine Tweaks',
  redscript: 'redscript',
  archivexl: 'ArchiveXL',
  tweakxl: 'TweakXL',
  codeware: 'Codeware',
  modsettings: 'Mod Settings',
  inputloader: 'Input Loader',
  nativesettings: 'Native Settings UI'
}

export const OUTCOME: Record<FixOutcome, { label: string; tone: Tone }> = {
  works: { label: 'Works in game', tone: 'green' },
  partial: { label: 'Partly works', tone: 'amber' },
  failed: { label: "Doesn't work", tone: 'red' },
  untested: { label: 'Not tested yet', tone: 'gray' }
}

export const SOURCE: Record<KnowledgeSource, { label: string; tone: Tone }> = {
  'built-in': { label: 'Built in', tone: 'violet' },
  learned: { label: 'Learned from a fix', tone: 'cyan' },
  user: { label: 'Added by you', tone: 'yellow' }
}
