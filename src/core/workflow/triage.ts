import type {
  CheckResult,
  Classification,
  CommunityReport,
  FrameworkStatus,
  NexusModInfo,
  PatchInfo,
  RecommendedAction,
  Verdict
} from '../../shared/types'
import { compareVersions, dateOnly } from '../util'

export interface VerdictInput {
  patch?: PatchInfo
  nexus?: NexusModInfo
  installedVersion?: string
  classification?: Classification
  community?: CommunityReport
  checks: CheckResult[]
  frameworks: FrameworkStatus[]
}

export interface VerdictOutput {
  verdict: Verdict
  action: RecommendedAction
  reasons: string[]
}

/**
 * Decides what to do with one mod. Order of evidence: is it a framework, did the author release
 * after the patch, do the mod's frameworks support the patch, what do users report, what did our
 * own checks find.
 */
export function decideVerdict(i: VerdictInput): VerdictOutput {
  const reasons: string[] = []
  const c = i.classification
  const patch = i.patch
  const patchDay = dateOnly(patch?.releaseDate)
  const fails = i.checks.filter((x) => x.status === 'fail')

  if (c?.isFramework) {
    const fw = i.frameworks.find((f) => f.id === c.isFramework)
    if (fw?.state === 'outdated') {
      reasons.push(`${fw.name} ${fw.installedVersion ?? ''} is older than the version that supports ${patch?.version ?? 'the patch'} (${fw.minVersionForPatch ?? fw.latestVersion}).`)
      return { verdict: 'framework', action: 'update-framework', reasons }
    }
    if (fw?.state === 'no-patch-build') {
      reasons.push(`${fw.name} has no release since ${patch?.version ?? 'the patch'} yet. Mods that need it have to wait.`)
      return { verdict: 'framework', action: 'wait-for-author', reasons }
    }
    reasons.push('Frameworks are kept up to date from Nexus, never patched.')
    return { verdict: 'framework', action: 'none', reasons }
  }

  // Frameworks this mod depends on.
  const needed = (c?.frameworksUsed ?? []).map((id) => i.frameworks.find((f) => f.id === id)).filter((f): f is FrameworkStatus => !!f)
  const waiting = needed.filter((f) => f.state === 'no-patch-build')
  const outdated = needed.filter((f) => f.state === 'outdated' || (f.state === 'missing' && f.id !== 'redscript'))
  for (const f of waiting) reasons.push(`Needs ${f.name}, which has no build for ${patch?.version ?? 'the patch'} yet.`)
  for (const f of outdated) reasons.push(f.state === 'missing' ? `Needs ${f.name}, which isn't installed.` : `Needs a newer ${f.name} (you have ${f.installedVersion}).`)

  const n = i.nexus
  for (const m of n?.descriptionMentions ?? []) reasons.push(`Mod page: "${m}"`)

  const latestDay = dateOnly(n?.latestFileDate ?? n?.updatedAt)
  if (patchDay && latestDay && latestDay >= patchDay) {
    const installedDay = dateOnly(n?.installedFileDate)
    const installedVer = n?.installedFileVersion ?? i.installedVersion
    const behind =
      (installedDay !== undefined && installedDay < patchDay) ||
      (installedVer && n?.latestFileVersion && compareVersions(installedVer, n.latestFileVersion) < 0)
    if (behind) {
      reasons.unshift(
        `The author released ${n?.latestFileVersion ?? 'an update'} on ${latestDay}, after patch ${patch!.version} (${patchDay}). You have ${installedVer ?? 'an older version'}.`
      )
      return { verdict: 'update-available', action: 'update-in-vortex', reasons }
    }
    reasons.unshift(`Released on ${latestDay}, after patch ${patch!.version} (${patchDay}).`)
    if (outdated.length) return { verdict: 'updated-after-patch', action: 'update-framework', reasons }
    if (fails.length) {
      reasons.push(...fails.map((f) => `Check failed: ${f.label}`))
      return { verdict: 'updated-after-patch', action: 'test-in-game', reasons }
    }
    return { verdict: 'updated-after-patch', action: 'none', reasons }
  }
  if (patchDay && latestDay) reasons.unshift(`Last release ${latestDay} is older than patch ${patch!.version} (${patchDay}).`)
  else if (!n) reasons.unshift('No Nexus data (no API key, or the mod has no Nexus id), so release dates were not compared.')

  if (c && !c.aiFixable && c.kinds.some((k) => k === 'red4ext' || k === 'asi')) {
    reasons.push('Native plugin: only its author can rebuild it for the new game version.')
    return { verdict: 'binary-wait', action: 'wait-for-author', reasons }
  }
  if (waiting.length) return { verdict: n ? 'not-updated' : 'unknown', action: 'wait-for-author', reasons }
  if (outdated.length) return { verdict: n ? 'not-updated' : 'unknown', action: 'update-framework', reasons }

  const cm = i.community
  if (cm && cm.broken >= 2 && cm.broken > cm.works) {
    reasons.push(`${cm.broken} user report(s) say it's broken on ${patch?.version ?? 'the patch'}, ${cm.works} say it works.`)
    return { verdict: 'reported-broken', action: c?.aiFixable === false ? 'wait-for-author' : 'ai-fix', reasons }
  }
  if (fails.length) {
    reasons.push(...fails.map((f) => `Check failed: ${f.label}${f.details[0] ? ` (${f.details[0]})` : ''}`))
    return { verdict: n ? 'not-updated' : 'unknown', action: c?.aiFixable === false ? 'wait-for-author' : 'ai-fix', reasons }
  }
  if (cm && cm.works >= 2 && cm.broken === 0) {
    reasons.push(`${cm.works} user report(s) say it works on ${patch?.version ?? 'the patch'}.`)
    return { verdict: 'reported-working', action: 'test-in-game', reasons }
  }
  if (c?.risk === 'low') {
    reasons.push('Low-risk mod type. Test it in game before changing anything.')
    return { verdict: n ? 'not-updated' : 'unknown', action: 'test-in-game', reasons }
  }
  if (c?.aiFixable === false) return { verdict: n ? 'not-updated' : 'unknown', action: 'test-in-game', reasons }
  reasons.push('Not updated since the patch, and its type often breaks on patches. Check it in game first, or start a fix.')
  return { verdict: n ? 'not-updated' : 'unknown', action: 'ai-fix', reasons }
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  framework: 'Framework',
  'update-available': 'Update on Nexus',
  'updated-after-patch': 'Updated after patch',
  'reported-working': 'Reported working',
  'reported-broken': 'Reported broken',
  'not-updated': 'Not updated',
  'binary-wait': 'Wait for author',
  unknown: 'Unknown'
}
