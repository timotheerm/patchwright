/**
 * Recipes let the AI produce many asset files without writing each one out in full, and without
 * running code on the user's PC. A recipe copies a source JSON file (vanilla, the mod's copy, or the
 * AI's own source) and applies a few path-based edits. Example: copy the 2.5 player entity and change
 * only its deformation rig path, 32 times.
 *
 * {
 *   "archives": [{
 *     "name": "!!MyMod_25fix",
 *     "files": [{
 *       "to": "base/characters/.../player_size12.ent.json",
 *       "from": "vanilla:base/characters/.../player.ent.json",
 *       "ops": [{ "op": "set", "path": "Data.RootChunk.components[name=deformations].rig.DepotPath.$value", "value": "base\\...\\rig12" }]
 *     }]
 *   }]
 * }
 *
 * Path syntax: dot-separated keys, `[3]` for an array index, `[key=value]` to pick the first array item
 * whose `key` (or `key.$value`) equals value, `[*]` for every item.
 */

export type RecipeOp =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'append'; path: string; value: unknown }

export interface RecipeFile {
  to: string
  from: string // "vanilla:<rel>", "mod:<rel>", or "src:<rel>"
  ops?: RecipeOp[]
}

export interface Recipe {
  archives?: { name: string; files: RecipeFile[] }[]
}

type Seg = { key: string } | { index: number } | { match: [string, string] } | { all: true }

export function parsePath(p: string): Seg[] {
  const segs: Seg[] = []
  const re = /([^.[\]]+)|\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) segs.push({ key: m[1] })
    else {
      const inner = m[2].trim()
      if (inner === '*') segs.push({ all: true })
      else if (/^\d+$/.test(inner)) segs.push({ index: Number(inner) })
      else {
        const eq = inner.indexOf('=')
        if (eq < 0) throw new Error(`Bad selector [${inner}] in path ${p}`)
        segs.push({ match: [inner.slice(0, eq).trim(), inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '')] })
      }
    }
  }
  return segs
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function matches(item: unknown, key: string, value: string): boolean {
  // Look through a { HandleId, Data } handle wrapper, which WolvenKit uses for components and nodes.
  const target = isObj(item) && isObj(item.Data) && !(key in item) ? item.Data : item
  if (!isObj(target)) return false
  const v = target[key]
  if (typeof v === 'string' || typeof v === 'number') return String(v) === value
  if (isObj(v) && (typeof v.$value === 'string' || typeof v.$value === 'number')) return String(v.$value) === value
  return false
}

/** Returns [parent, keyOrIndex] pairs the path resolves to. */
function resolve(root: unknown, segs: Seg[]): [unknown, string | number][] {
  let current: unknown[] = [root]
  const lastParents: [unknown, string | number][] = []
  segs.forEach((seg, i) => {
    const isLast = i === segs.length - 1
    const next: unknown[] = []
    for (const node of current) {
      const step = (container: unknown, k: string | number): void => {
        if (isLast) lastParents.push([container, k])
        else next.push((container as Record<string | number, unknown>)[k])
      }
      if ('key' in seg) {
        if (isObj(node)) {
          // Step through { HandleId, Data } wrappers transparently.
          const target = !(seg.key in node) && 'HandleId' in node && isObj(node.Data) ? node.Data : node
          step(target, seg.key)
        }
      } else if (Array.isArray(node)) {
        if ('index' in seg) step(node, seg.index)
        else if ('all' in seg) node.forEach((_, idx) => step(node, idx))
        else {
          const idx = node.findIndex((it) => matches(it, seg.match[0], seg.match[1]))
          if (idx >= 0) step(node, idx)
        }
      }
    }
    current = next
  })
  return lastParents
}

export function applyOps(doc: unknown, ops: RecipeOp[]): { applied: number; misses: string[] } {
  let applied = 0
  const misses: string[] = []
  for (const op of ops) {
    const targets = resolve(doc, parsePath(op.path))
    if (targets.length === 0) {
      misses.push(`${op.op} ${op.path}: path not found`)
      continue
    }
    for (const [parent, k] of targets) {
      const container = parent as Record<string | number, unknown>
      if (op.op === 'set') {
        container[k] = structuredClone(op.value)
      } else if (op.op === 'remove') {
        if (Array.isArray(parent) && typeof k === 'number') parent.splice(k, 1)
        else delete container[k]
      } else if (op.op === 'append') {
        const arr = container[k]
        if (!Array.isArray(arr)) {
          misses.push(`append ${op.path}: not an array`)
          continue
        }
        arr.push(structuredClone(op.value))
      }
      applied++
    }
  }
  return { applied, misses }
}

export function validateRecipe(r: unknown): string[] {
  const errs: string[] = []
  if (!isObj(r)) return ['recipe.json must be an object']
  if (r.archives !== undefined && !Array.isArray(r.archives)) errs.push('"archives" must be an array')
  for (const a of (r.archives as unknown[]) ?? []) {
    if (!isObj(a) || typeof a.name !== 'string' || !Array.isArray(a.files)) {
      errs.push('each archive needs "name" and "files"')
      continue
    }
    if (!/^[\w!#@&()+,\-. ]+$/.test(a.name)) errs.push(`archive name "${a.name}" has characters that aren't allowed`)
    for (const f of a.files as unknown[]) {
      if (!isObj(f) || typeof f.to !== 'string' || typeof f.from !== 'string') errs.push(`archive ${a.name}: each file needs "to" and "from"`)
      else if (!/^(vanilla|mod|src):/.test(f.from)) errs.push(`${f.to}: "from" must start with vanilla:, mod: or src:`)
      else if (f.to.includes('..') || f.from.includes('..')) errs.push(`${f.to}: ".." isn't allowed in paths`)
    }
  }
  return errs
}
