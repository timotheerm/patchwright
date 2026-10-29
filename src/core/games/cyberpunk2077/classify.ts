import type { Classification, ModFileInfo, ModKind } from '../../../shared/types'
import { FRAMEWORKS } from './frameworks'

export function classifyPath(rel: string): ModKind {
  const p = rel.toLowerCase().replace(/\\/g, '/')
  if (p.endsWith('.archive')) return 'archive'
  if (p.endsWith('.xl')) return 'archivexl'
  if (p.endsWith('.reds')) return 'redscript'
  if ((p.startsWith('r6/tweaks/') || p.includes('/r6/tweaks/')) && /\.(ya?ml|tweak)$/.test(p)) return 'tweakxl'
  if (p.includes('cyber_engine_tweaks/mods/')) return 'cet'
  if (p.endsWith('.asi')) return 'asi'
  if (p.endsWith('.dll') && (p.startsWith('red4ext/') || p.includes('/red4ext/'))) return 'red4ext'
  if (p.startsWith('engine/config/') && p.endsWith('.ini')) return 'ini'
  return 'other'
}

const TEXT_KINDS: ModKind[] = ['redscript', 'cet', 'tweakxl', 'archivexl']

/**
 * Works out what a mod is made of and how risky a game patch is for it.
 * `readText` reads a mod file (by relative path) so script sources can be searched for framework use.
 */
export async function classifyFiles(
  files: { rel: string; size: number }[],
  readText: (rel: string) => Promise<string>
): Promise<Classification> {
  const infos: ModFileInfo[] = files.map((f) => ({ relPath: f.rel, size: f.size, kind: classifyPath(f.rel) }))
  const kinds = [...new Set(infos.map((f) => f.kind))].filter((k) => k !== 'other' || infos.every((f) => f.kind === 'other'))
  const notes: string[] = []
  const used = new Set<string>()

  const lowerPaths = infos.map((f) => f.relPath.toLowerCase())
  const isFramework = FRAMEWORKS.find((fw) => fw.files.every((needle) => lowerPaths.includes(needle.toLowerCase())))
  if (isFramework) {
    return {
      kinds,
      files: infos,
      frameworksUsed: [],
      isFramework: isFramework.id,
      risk: isFramework.native ? 'high' : 'medium',
      aiFixable: false,
      notes: [`This is the ${isFramework.name} framework. Update it from Nexus instead of patching it.`]
    }
  }

  if (kinds.includes('archivexl')) used.add('archivexl')
  if (kinds.includes('tweakxl')) used.add('tweakxl')
  if (kinds.includes('redscript')) used.add('redscript')
  if (kinds.includes('cet')) used.add('cet')
  if (kinds.includes('red4ext')) used.add('red4ext')

  // Search script sources for framework use (Codeware, Mod Settings, ...).
  let scanned = 0
  let hasSectorEdits = false
  for (const f of infos) {
    if (!TEXT_KINDS.includes(f.kind) || f.size > 2_000_000 || scanned > 200) continue
    scanned++
    const text = await readText(f.relPath)
    for (const fw of FRAMEWORKS) {
      if (fw.usedBy?.some((re) => re.test(text))) used.add(fw.id)
    }
    if (f.kind === 'archivexl' && /^\s*streaming\s*:/m.test(text)) hasSectorEdits = true
  }

  let risk: Classification['risk'] = 'low'
  const bump = (r: Classification['risk']): void => {
    const order = { low: 0, medium: 1, high: 2 }
    if (order[r] > order[risk]) risk = r
  }
  if (kinds.includes('ini') || kinds.includes('tweakxl')) bump('low')
  if (kinds.includes('archive')) {
    bump('medium')
    notes.push('Packed game assets. Copies of vanilla files (entities, appearances, sectors) go stale when a patch changes the originals.')
  }
  if (kinds.includes('redscript')) {
    bump('medium')
    notes.push('Scripts. A test compile against the new game scripts shows most breaks.')
  }
  if (kinds.includes('cet')) {
    bump('medium')
    notes.push('CET Lua. Breaks show up as runtime errors in the CET logs.')
  }
  if (hasSectorEdits) {
    bump('high')
    notes.push('ArchiveXL sector edits are pinned to exact node counts and indexes, which patches often change.')
  }
  const native = infos.filter((f) => f.kind === 'red4ext' || f.kind === 'asi')
  if (native.length > 0) {
    bump('high')
    notes.push('Contains native plugins (.dll/.asi). Only the author can rebuild those for a new game build.')
  }
  const fixableKinds: ModKind[] = ['archive', 'archivexl', 'tweakxl', 'redscript', 'cet', 'ini']
  const aiFixable = kinds.some((k) => fixableKinds.includes(k))
  if (native.length > 0 && aiFixable) notes.push('The non-native parts can still be checked and patched.')

  return { kinds, files: infos, frameworksUsed: [...used].sort(), risk, aiFixable, notes }
}
