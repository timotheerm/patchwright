import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { ToolCommands } from '../../../shared/types'
import type { CoreContext } from '../../context'
import { ensureDir, exists, fillTemplate, run, toPosix, walk, type RunResult } from '../../util'

/**
 * Command templates for the external tools. Users can override them in Settings, because these
 * tools change their command lines between versions.
 */
export const DEFAULT_TOOL_COMMANDS: ToolCommands = {
  wkUnbundle: 'unbundle -p "{in}" -o "{out}" -r "{regex}"',
  wkSerialize: 'convert serialize "{in}" -o "{out}"',
  wkDeserialize: 'convert deserialize "{in}" -o "{out}"',
  wkPack: 'pack -p "{in}" -o "{out}"',
  redscriptCompile: 'compile -s "{in}" -b "{bundle}" -o "{out}"'
}

/** File types worth converting to JSON so the AI can read and edit them. */
export const SERIALIZE_EXTS = ['.ent', '.app', '.streamingsector', '.mi', '.workspot', '.inkatlas', '.inkwidget', '.anims', '.rig']

export class WolvenKit {
  constructor(
    private ctx: CoreContext,
    private log: (m: string) => void = () => {}
  ) {}

  get cli(): string | undefined {
    return this.ctx.settings.wolvenkitCli
  }

  async available(): Promise<boolean> {
    return exists(this.cli)
  }

  private async exec(templateKey: keyof ToolCommands, vars: Record<string, string>, timeoutMs = 20 * 60_000): Promise<RunResult> {
    const cli = this.cli
    if (!cli) throw new Error('WolvenKit CLI path is not set (Settings > Tools).')
    const args = fillTemplate(this.ctx.settings.toolCommands[templateKey], vars)
    this.log(`WolvenKit ${args.join(' ')}`)
    const res = await run(cli, args, { timeoutMs })
    if (res.code !== 0) this.log(`WolvenKit exited with ${res.code}: ${(res.stderr || res.stdout).slice(-800)}`)
    return res
  }

  unbundle(input: string, outDir: string, regex?: string): Promise<RunResult> {
    return this.exec('wkUnbundle', { in: input, out: outDir, regex: regex ?? '' })
  }

  serialize(input: string, outDir: string): Promise<RunResult> {
    return this.exec('wkSerialize', { in: input, out: outDir })
  }

  deserialize(input: string, outDir: string): Promise<RunResult> {
    return this.exec('wkDeserialize', { in: input, out: outDir })
  }

  pack(input: string, outDir: string): Promise<RunResult> {
    return this.exec('wkPack', { in: input, out: outDir })
  }

  /** Extracts vanilla files whose depot path matches one of `depotPaths` from the game's content archives. */
  async extractVanilla(gameDir: string, depotPaths: string[], outDir: string, extraRegex: string[] = []): Promise<string[]> {
    const patterns = [...depotPaths.map(depotPathRegex), ...extraRegex]
    if (patterns.length === 0) return []
    await ensureDir(outDir)
    const roots = [path.join(gameDir, 'archive', 'pc', 'content'), path.join(gameDir, 'archive', 'pc', 'ep1')]
    // Keep each regex reasonably short; Windows caps a command line at 32k characters.
    const batches: string[][] = []
    let cur: string[] = []
    let len = 0
    for (const p of patterns) {
      if (len + p.length > 6000 && cur.length) {
        batches.push(cur)
        cur = []
        len = 0
      }
      cur.push(p)
      len += p.length + 1
    }
    if (cur.length) batches.push(cur)
    for (const root of roots) {
      if (!(await exists(root))) continue
      for (const b of batches) await this.unbundle(root, outDir, b.length === 1 ? b[0] : `(${b.join('|')})`)
    }
    return (await walk(outDir)).map((f) => f.rel)
  }

  /** Converts every file with a serializable extension under `dir` to JSON next to it (in `outDir`). */
  async serializeTree(dir: string, outDir: string): Promise<number> {
    const files = (await walk(dir)).filter((f) => SERIALIZE_EXTS.includes(path.extname(f.rel).toLowerCase()))
    let n = 0
    for (const f of files) {
      const target = path.join(outDir, path.dirname(f.rel))
      await ensureDir(target)
      const res = await this.serialize(f.abs, target)
      if (res.code === 0) n++
    }
    return n
  }
}

/** Builds a regex that matches a depot path regardless of slash direction. */
export function depotPathRegex(depotPath: string): string {
  return toPosix(depotPath)
    .split('/')
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]')
}

export interface CompileResult {
  ran: boolean
  ok: boolean
  errors: string[]
  warnings: string[]
  output: string
  note?: string
}

/**
 * Test-compiles redscript in a scratch copy of the game's scripts, so the game folder is never touched.
 * `overlay` maps r6/scripts-relative paths to source files to add; `exclude` drops installed paths.
 */
export async function compileRedscript(
  ctx: CoreContext,
  scratchDir: string,
  overlay: { rel: string; abs: string }[],
  exclude: (rel: string) => boolean = () => false
): Promise<CompileResult> {
  const cli = ctx.settings.redscriptCli
  const gameDir = ctx.settings.gamePath
  if (!cli || !(await exists(cli))) {
    return {
      ran: false,
      ok: false,
      errors: [],
      warnings: [],
      output: '',
      note: 'No redscript compiler set. Download redscript-cli from the redscript GitHub releases and set its path in Settings > Tools.'
    }
  }
  if (!gameDir) return { ran: false, ok: false, errors: [], warnings: [], output: '', note: 'Game folder is not set.' }

  const cacheDir = path.join(gameDir, 'r6', 'cache')
  let bundle = path.join(cacheDir, 'final.redscripts.bk')
  if (!(await exists(bundle))) bundle = path.join(cacheDir, 'final.redscripts')
  if (!(await exists(bundle))) {
    return { ran: false, ok: false, errors: [], warnings: [], output: '', note: `No script bundle found in ${cacheDir}.` }
  }

  const srcDir = path.join(scratchDir, 'scripts')
  await fs.rm(srcDir, { recursive: true, force: true })
  await ensureDir(srcDir)
  const installed = path.join(gameDir, 'r6', 'scripts')
  if (await exists(installed)) {
    for (const f of await walk(installed)) {
      if (!f.rel.endsWith('.reds') || exclude(f.rel)) continue
      const target = path.join(srcDir, ...f.rel.split('/'))
      await ensureDir(path.dirname(target))
      await fs.copyFile(f.abs, target)
    }
  }
  for (const o of overlay) {
    const target = path.join(srcDir, ...o.rel.split('/'))
    await ensureDir(path.dirname(target))
    await fs.copyFile(o.abs, target)
  }
  const out = path.join(scratchDir, 'out.redscripts')
  const args = fillTemplate(ctx.settings.toolCommands.redscriptCompile, { in: srcDir, bundle, out })
  const res = await run(cli, args, { timeoutMs: 5 * 60_000 })
  const output = `${res.stdout}\n${res.stderr}`
  const lines = output.split(/\r?\n/)
  const errors = lines.filter((l) => /\[?error\]?|\berror:/i.test(l) && !/0 errors?/i.test(l))
  const warnings = lines.filter((l) => /\[?warn(ing)?\]?/i.test(l))
  return { ran: true, ok: res.code === 0 && errors.length === 0, errors, warnings, output }
}
