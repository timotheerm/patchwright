// Picks the knowledge that matters for one mod. Pure functions with no Node imports, so the UI's demo
// mode can use them too.
import type { FixRecord, KnowledgeBase, ModKind, PatchChange, RelevantKnowledge, Scored, TriageResult } from '../../shared/types'

export interface KnowledgeQuery {
  /** The patch the mod is being fixed for. Changes from later patches are left out. */
  patch?: string
  modName: string
  nexusModId?: number
  kinds: ModKind[]
  frameworks: string[]
  /** Lower-case text from the mod's file list, checks and reports. Keywords are matched against it. */
  text: string
}

/**
 * CD PROJEKT RED numbers hotfixes x.yz (2.21 is a hotfix of 2.2), so versions compare as decimals:
 * 2.12 < 2.2 < 2.21 < 2.3 < 2.5.
 */
export function patchValue(v: string): number {
  const n = parseFloat(v.replace(/^v/i, ''))
  return Number.isNaN(n) ? 0 : n
}

const norm = (s: string): string => s.toLowerCase().replace(/\\/g, '/')
const sameName = (a: string, b: string): boolean => norm(a).replace(/[^a-z0-9]/g, '') === norm(b).replace(/[^a-z0-9]/g, '')

function keywordHits(keywords: string[], text: string): string[] {
  return keywords.filter((k) => k.length >= 3 && text.includes(norm(k)))
}

function scoreChange(c: PatchChange, q: KnowledgeQuery): Scored<PatchChange> | null {
  const target = q.patch ? patchValue(q.patch) : undefined
  const own = patchValue(c.patch)
  if (target !== undefined && own > target) return null
  const overlap = c.affects.filter((k) => q.kinds.includes(k))
  if (c.affects.length && !overlap.length) return null
  // A change with keywords only counts when the mod shows signs of it; one without is matched by mod type.
  const hits = keywordHits(c.keywords, q.text).slice(0, 3)
  if (c.keywords.length && !hits.length) return null
  if (!c.keywords.length && !c.affects.length) return null
  const why: string[] = []
  const samePatch = target === undefined || own === target
  let score = samePatch ? 3 : 1
  why.push(samePatch ? `came with patch ${c.patch}` : `from an earlier patch (${c.patch})`)
  if (overlap.length) {
    score += 2
    why.push(`affects ${overlap.join(', ')} mods`)
  }
  if (hits.length) {
    score += hits.length * 2
    why.push(`the mod mentions ${hits.map((h) => `"${h}"`).join(', ')}`)
  }
  return { entry: c, score, why }
}

function scoreFix(f: FixRecord, q: KnowledgeQuery): Scored<FixRecord> | null {
  const why: string[] = []
  let score = 0
  const same = (q.nexusModId !== undefined && f.nexusModId === q.nexusModId) || sameName(f.modName, q.modName)
  const target = q.patch ? patchValue(q.patch) : undefined
  const own = patchValue(f.patch)
  if (target !== undefined && own > target && !same) return null
  const shared = f.kinds.filter((k) => q.kinds.includes(k))
  const kindMatch = shared.length / new Set([...f.kinds, ...q.kinds]).size
  const hits = keywordHits(f.keywords, q.text).slice(0, 3)
  // Another mod's fix is only useful when it is the same kind of mod, or shows the same signs.
  if (!same && (!shared.length || (kindMatch < 0.99 && !hits.length))) return null
  if (same) {
    score += 12
    why.push('this same mod was fixed before')
  }
  if (target === undefined || own === target) {
    score += 3
    why.push(`fixed for patch ${f.patch}`)
  } else score += 1
  if (shared.length) {
    score += Math.round(kindMatch * 4)
    why.push(kindMatch >= 0.99 ? `same mod type (${shared.join(' + ')})` : `also has ${shared.join(' and ')} files`)
  }
  score += Math.min(2, f.frameworks.filter((x) => q.frameworks.includes(x)).length)
  if (hits.length) {
    score += hits.length * 2
    why.push(`the mod mentions ${hits.map((h) => `"${h}"`).join(', ')}`)
  }
  switch (f.outcome) {
    case 'works':
      score += 3
      why.push('worked in game')
      break
    case 'partial':
      score += 1
      why.push('partly worked in game')
      break
    case 'failed':
      score -= 2
      why.push("did NOT work in game: don't repeat it")
      break
    default:
      why.push('not tested in game yet')
  }
  return score >= 5 || same ? { entry: f, score, why } : null
}

export function selectKnowledge(kb: KnowledgeBase, q: KnowledgeQuery, limits = { changes: 6, fixes: 5 }): RelevantKnowledge {
  const byScore = <T>(a: Scored<T>, b: Scored<T>): number => b.score - a.score
  return {
    changes: kb.changes.map((c) => scoreChange(c, q)).filter((x): x is Scored<PatchChange> => !!x).sort(byScore).slice(0, limits.changes),
    fixes: kb.fixes.map((f) => scoreFix(f, q)).filter((x): x is Scored<FixRecord> => !!x).sort(byScore).slice(0, limits.fixes)
  }
}

/** Builds a query from a triage result, plus any report text the job has written. */
export function queryFromTriage(t: TriageResult, patch: string | undefined, extraText = ''): KnowledgeQuery {
  const c = t.classification
  const parts = [
    t.mod.name,
    ...(c?.files.map((f) => f.relPath) ?? []),
    ...(c?.notes ?? []),
    ...t.reasons,
    ...t.checks.flatMap((x) => [x.label, ...x.details]),
    ...(t.community?.snippets.map((s) => s.text) ?? []),
    t.community?.summary ?? '',
    ...(t.nexus?.descriptionMentions ?? []),
    extraText
  ]
  return {
    patch,
    modName: t.mod.name,
    nexusModId: t.mod.nexusModId,
    kinds: c?.kinds ?? [],
    frameworks: c?.frameworksUsed ?? [],
    text: norm(parts.join('\n'))
  }
}

/** Word overlap between two sentences, used to avoid saving the same patch change twice. */
export function similarity(a: string, b: string): number {
  const words = (s: string): Set<string> => new Set(norm(s).split(/[^a-z0-9_.]+/).filter((w) => w.length > 2))
  const wa = words(a)
  const wb = words(b)
  if (!wa.size || !wb.size) return 0
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  return common / (wa.size + wb.size - common)
}
