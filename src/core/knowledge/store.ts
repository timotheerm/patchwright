import type { FixOutcome, FixRecord, GameId, JobState, KnowledgeBase, ModKind, PatchChange, TriageResult } from '../../shared/types'
import { nowIso, readJson, writeJson } from '../util'
import { similarity } from './match'

/** What the AI writes to fix.json. Everything but `mode` is optional and only feeds the knowledge base. */
export interface FixMeta {
  mode?: string
  disableOriginal?: boolean
  summary?: string
  problem?: string
  approach?: string
  lessons?: string[]
  keywords?: string[]
  patchChanges?: { summary?: string; affects?: string[]; symptoms?: string; remedy?: string; keywords?: string[] }[]
}

interface StoredKnowledge extends KnowledgeBase {
  /** Ids of built-in entries the user removed. */
  hidden: string[]
}

const KINDS: ModKind[] = ['archive', 'archivexl', 'tweakxl', 'redscript', 'cet', 'red4ext', 'asi', 'ini', 'other']
const text = (v: unknown, max = 2000): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const list = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => text(x, 400)).filter((x): x is string => !!x).slice(0, max) : [])

/** Id of the knowledge entry that records a job's fix. */
export const fixIdForJob = (jobId: string): string => `job-${jobId}`

/**
 * The knowledge base: the game's built-in entries plus what the user's own fixes taught, kept in one
 * JSON file. A stored entry with a built-in entry's id overrides it (for example a new outcome).
 */
export class KnowledgeStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private file: string,
    private gameId: GameId,
    private builtIn: KnowledgeBase
  ) {}

  private async stored(): Promise<StoredKnowledge> {
    const s = await readJson<Partial<StoredKnowledge>>(this.file, {})
    return { changes: s.changes ?? [], fixes: s.fixes ?? [], hidden: s.hidden ?? [] }
  }

  /** Runs changes one after another so two quick edits can't overwrite each other. */
  private update(fn: (s: StoredKnowledge) => void | Promise<void>): Promise<KnowledgeBase> {
    const run = this.queue.then(async () => {
      const s = await this.stored()
      await fn(s)
      await writeJson(this.file, s)
      return this.merge(s)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private merge(s: StoredKnowledge): KnowledgeBase {
    const pick = <T extends { id: string }>(builtIn: T[], own: T[]): T[] => {
      const ownIds = new Set(own.map((x) => x.id))
      return [...builtIn.filter((x) => !ownIds.has(x.id) && !s.hidden.includes(x.id)), ...own]
    }
    return { changes: pick(this.builtIn.changes, s.changes), fixes: pick(this.builtIn.fixes, s.fixes) }
  }

  async all(): Promise<KnowledgeBase> {
    return this.merge(await this.stored())
  }

  saveChange(c: PatchChange): Promise<KnowledgeBase> {
    return this.update((s) => {
      s.changes = [...s.changes.filter((x) => x.id !== c.id), { ...c, gameId: this.gameId }]
    })
  }

  saveFix(f: FixRecord): Promise<KnowledgeBase> {
    return this.update((s) => {
      s.fixes = [...s.fixes.filter((x) => x.id !== f.id), { ...f, gameId: this.gameId, updatedAt: nowIso() }]
    })
  }

  remove(id: string): Promise<KnowledgeBase> {
    return this.update((s) => {
      s.changes = s.changes.filter((x) => x.id !== id)
      s.fixes = s.fixes.filter((x) => x.id !== id)
      const builtIn = [...this.builtIn.changes, ...this.builtIn.fixes].some((x) => x.id === id)
      if (builtIn && !s.hidden.includes(id)) s.hidden.push(id)
    })
  }

  async setOutcome(id: string, outcome: FixOutcome, note?: string): Promise<KnowledgeBase> {
    const f = (await this.all()).fixes.find((x) => x.id === id)
    if (!f) throw new Error('That fix is not in the knowledge base.')
    return this.saveFix({ ...f, outcome, outcomeNote: text(note, 1000) ?? f.outcomeNote })
  }

  /**
   * Adds a finished fix: what was broken, how it was fixed, and the lessons the AI wrote in fix.json.
   * Patch changes the AI found are added too, unless the knowledge base already has a similar one.
   */
  async learnFromJob(job: JobState, t: TriageResult, patch: string, meta: FixMeta, notes: string, outcome: FixOutcome = 'untested'): Promise<{ fix: FixRecord; newChanges: PatchChange[] }> {
    const now = nowIso()
    const c = t.classification
    const firstPara = notes
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^#+\s.*$/gm, '').trim())
      .find(Boolean)
    const existing = (await this.all()).fixes.find((x) => x.id === fixIdForJob(job.id))
    const fixRec: FixRecord = {
      id: fixIdForJob(job.id),
      gameId: this.gameId,
      patch,
      modName: t.mod.name,
      nexusModId: t.mod.nexusModId,
      kinds: c?.kinds ?? [],
      frameworks: c?.frameworksUsed ?? [],
      problem: text(meta.problem) ?? firstPara?.slice(0, 1500) ?? t.reasons.join(' '),
      approach: text(meta.approach) ?? text(meta.summary) ?? notes.slice(0, 1500),
      lessons: list(meta.lessons),
      keywords: list(meta.keywords, 20).map((k) => k.toLowerCase()),
      outcome: existing?.outcome ?? outcome,
      outcomeNote: existing?.outcomeNote,
      source: 'learned',
      fromJob: job.id,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now
    }
    const known = (await this.all()).changes.filter((x) => x.patch === patch)
    const newChanges: PatchChange[] = []
    ;(Array.isArray(meta.patchChanges) ? meta.patchChanges : []).slice(0, 8).forEach((pc, i) => {
      const summary = text(pc?.summary, 600)
      if (!summary) return
      if ([...known, ...newChanges].some((k) => similarity(k.summary, summary) >= 0.5)) return
      newChanges.push({
        id: `job-${job.id}-change-${i + 1}`,
        gameId: this.gameId,
        patch,
        summary,
        affects: list(pc.affects).filter((k): k is ModKind => (KINDS as string[]).includes(k)),
        symptoms: text(pc.symptoms, 600),
        remedy: text(pc.remedy, 1000),
        keywords: list(pc.keywords, 12).map((k) => k.toLowerCase()),
        source: 'learned',
        fromJob: job.id,
        addedAt: now
      })
    })
    await this.update((s) => {
      s.fixes = [...s.fixes.filter((x) => x.id !== fixRec.id), fixRec]
      const ids = new Set(newChanges.map((x) => x.id))
      s.changes = [...s.changes.filter((x) => !ids.has(x.id)), ...newChanges]
    })
    return { fix: fixRec, newChanges }
  }

  /** Adds entries from an exported file. Entries with an id that already exists are skipped. */
  async importFrom(kb: Partial<KnowledgeBase>): Promise<{ added: number; skipped: number }> {
    const current = await this.all()
    const have = new Set([...current.changes, ...current.fixes].map((x) => x.id))
    let added = 0
    let skipped = 0
    await this.update((s) => {
      for (const c of Array.isArray(kb.changes) ? kb.changes : []) {
        if (!c?.id || !c.summary || have.has(c.id)) {
          skipped++
          continue
        }
        s.changes.push({ ...c, gameId: this.gameId, source: 'user', keywords: c.keywords ?? [], affects: c.affects ?? [] })
        added++
      }
      for (const f of Array.isArray(kb.fixes) ? kb.fixes : []) {
        if (!f?.id || !f.modName || have.has(f.id)) {
          skipped++
          continue
        }
        s.fixes.push({ ...f, gameId: this.gameId, source: 'user', lessons: f.lessons ?? [], keywords: f.keywords ?? [], kinds: f.kinds ?? [], frameworks: f.frameworks ?? [] })
        added++
      }
    })
    return { added, skipped }
  }
}
