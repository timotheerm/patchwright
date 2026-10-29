/**
 * Helpers for WolvenKit's JSON form of game files (CR2W). Used to summarize and diff a mod's copy of a
 * vanilla file against the file from the new patch, and to read map sectors for ArchiveXL checks.
 */

type Json = unknown

const isObj = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads a CName / string wrapper ({ $value }) or a plain string. */
export function str(v: Json): string | undefined {
  if (typeof v === 'string') return v
  if (isObj(v) && typeof v.$value === 'string') return v.$value
  return undefined
}

export function rootChunk(doc: Json): Record<string, Json> | undefined {
  if (!isObj(doc)) return undefined
  const data = doc.Data
  if (isObj(data) && isObj(data.RootChunk)) return data.RootChunk
  if (isObj(doc.RootChunk)) return doc.RootChunk
  return undefined
}

/** Unwraps a handle ({ HandleId, Data }) to its object. */
export function unhandle(v: Json): Record<string, Json> | undefined {
  if (isObj(v) && isObj(v.Data)) return v.Data
  return isObj(v) ? v : undefined
}

export interface Cr2wSummary {
  rootType?: string
  components: string[] // "name (type)"
  appearances: string[]
  depotPaths: string[]
  typeCounts: Record<string, number>
}

export function summarize(doc: Json): Cr2wSummary {
  const root = rootChunk(doc)
  const depot = new Set<string>()
  const typeCounts: Record<string, number> = {}
  const visit = (v: Json, depth: number): void => {
    if (depth > 60) return
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1)
      return
    }
    if (!isObj(v)) return
    if (typeof v.$type === 'string') typeCounts[v.$type] = (typeCounts[v.$type] ?? 0) + 1
    const dp = v.DepotPath
    const p = str(dp)
    if (p) depot.add(p)
    for (const [k, x] of Object.entries(v)) if (k !== 'DepotPath') visit(x, depth + 1)
  }
  visit(root, 0)

  const components: string[] = []
  const comps = root?.components
  if (Array.isArray(comps)) {
    for (const c of comps) {
      const o = unhandle(c)
      if (!o) continue
      components.push(`${str(o.name) ?? '?'} (${String(o.$type ?? '?')})`)
    }
  }
  const appearances: string[] = []
  const apps = root?.appearances
  if (Array.isArray(apps)) {
    for (const a of apps) {
      const o = unhandle(a)
      const n = o ? (str(o.name) ?? str(o.appearanceName)) : undefined
      if (n) appearances.push(n)
    }
  }
  return {
    rootType: typeof root?.$type === 'string' ? root.$type : undefined,
    components,
    appearances,
    depotPaths: [...depot].sort(),
    typeCounts
  }
}

/** Human-readable differences between the vanilla file and the mod's copy. */
export function diffSummaries(vanilla: Cr2wSummary, mod: Cr2wSummary): string[] {
  const out: string[] = []
  const setDiff = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x))
  const addedComps = setDiff(vanilla.components, mod.components)
  const extraComps = setDiff(mod.components, vanilla.components)
  if (addedComps.length) out.push(`Components in vanilla but missing from the mod copy: ${addedComps.join(', ')}`)
  if (extraComps.length) out.push(`Components only in the mod copy: ${extraComps.join(', ')}`)
  const missingApps = setDiff(vanilla.appearances, mod.appearances)
  if (missingApps.length) out.push(`Appearances in vanilla but missing from the mod copy: ${missingApps.slice(0, 40).join(', ')}`)
  const vanillaOnly = setDiff(vanilla.depotPaths, mod.depotPaths)
  const modOnly = setDiff(mod.depotPaths, vanilla.depotPaths)
  if (vanillaOnly.length) out.push(`Resources vanilla references that the mod copy doesn't: ${vanillaOnly.slice(0, 40).join(', ')}`)
  if (modOnly.length) out.push(`Resources only the mod copy references (likely the mod's real edits, or stale paths): ${modOnly.slice(0, 40).join(', ')}`)
  for (const t of new Set([...Object.keys(vanilla.typeCounts), ...Object.keys(mod.typeCounts)])) {
    const a = vanilla.typeCounts[t] ?? 0
    const b = mod.typeCounts[t] ?? 0
    if (a !== b && (a === 0 || b === 0)) out.push(`Type ${t}: ${a} in vanilla, ${b} in the mod copy`)
  }
  return out
}

export interface SectorNode {
  index: number // nodeData index (what ArchiveXL's nodeDeletions refer to)
  nodeIndex: number
  type: string
  position?: [number, number, number]
  label?: string
}

/** Lists a sector's node data entries with the type of the node each one points at. */
export function sectorNodes(doc: Json): { nodeDataCount: number; nodeCount: number; nodes: SectorNode[] } {
  const root = rootChunk(doc)
  const nodesArr = Array.isArray(root?.nodes) ? (root!.nodes as Json[]) : []
  const nd = root?.nodeData
  const ndArr: Json[] = isObj(nd) && Array.isArray(nd.Data) ? (nd.Data as Json[]) : Array.isArray(nd) ? (nd as Json[]) : []
  const nodes: SectorNode[] = ndArr.map((e, i) => {
    const o = isObj(e) ? e : {}
    const nodeIndex = typeof o.NodeIndex === 'number' ? o.NodeIndex : i
    const node = unhandle(nodesArr[nodeIndex])
    const type = typeof node?.$type === 'string' ? node.$type : '?'
    const pos = isObj(o.Position) ? o.Position : undefined
    const num = (k: string): number => (pos && typeof pos[k] === 'number' ? (pos[k] as number) : 0)
    const label =
      str(node?.debugName) ??
      (isObj(node?.mesh) ? str((node!.mesh as Record<string, Json>).DepotPath) : undefined) ??
      (isObj(node?.meshRef) ? str((node!.meshRef as Record<string, Json>).DepotPath) : undefined)
    return {
      index: i,
      nodeIndex,
      type,
      position: pos ? [num('X'), num('Y'), num('Z')] : undefined,
      label
    }
  })
  return { nodeDataCount: ndArr.length, nodeCount: nodesArr.length, nodes }
}

export interface XlSectorEdit {
  path: string
  expectedNodes?: number
  deletions: { index: number; type?: string }[]
  mutations: { index: number; type?: string }[]
}

/** Pulls sector edits out of a parsed ArchiveXL .xl document. */
export function xlSectorEdits(doc: Json): XlSectorEdit[] {
  if (!isObj(doc) || !isObj(doc.streaming)) return []
  const sectors = doc.streaming.sectors
  if (!Array.isArray(sectors)) return []
  const edits: XlSectorEdit[] = []
  for (const s of sectors) {
    if (!isObj(s) || typeof s.path !== 'string') continue
    const list = (v: Json): { index: number; type?: string }[] =>
      Array.isArray(v)
        ? v.filter(isObj).map((d) => ({ index: Number(d.index), type: typeof d.type === 'string' ? d.type : undefined }))
        : []
    edits.push({
      path: s.path,
      expectedNodes: typeof s.expectedNodes === 'number' ? s.expectedNodes : undefined,
      deletions: list(s.nodeDeletions),
      mutations: list(s.nodeMutations)
    })
  }
  return edits
}

/** Checks an ArchiveXL sector edit against the sector from the current game version. */
export function checkSectorEdit(edit: XlSectorEdit, sector: ReturnType<typeof sectorNodes>): string[] {
  const problems: string[] = []
  if (edit.expectedNodes !== undefined && edit.expectedNodes !== sector.nodeDataCount) {
    problems.push(`expectedNodes is ${edit.expectedNodes}, but the sector now has ${sector.nodeDataCount} node entries`)
  }
  for (const d of [...edit.deletions, ...edit.mutations]) {
    const n = sector.nodes[d.index]
    if (!n) {
      problems.push(`index ${d.index} doesn't exist any more (sector has ${sector.nodeDataCount} entries)`)
    } else if (d.type && n.type !== d.type) {
      problems.push(`index ${d.index} is now ${n.type}, not ${d.type}`)
    }
  }
  return problems
}
