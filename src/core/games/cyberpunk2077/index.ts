import path from 'node:path'
import { promises as fs } from 'node:fs'
import YAML from 'yaml'
import type { CheckResult, Classification, PatchInfo } from '../../../shared/types'
import type { CoreContext } from '../../context'
import { ensureDir, exists, readHead, readJson, readTail, toPosix, walk, writeJson } from '../../util'
import type { AiRequests, GameAdapter } from '../types'
import { classifyFiles } from './classify'
import { FRAMEWORKS } from './frameworks'
import { CYBERPUNK_PLAYBOOK } from './playbook'
import { compileRedscript, SERIALIZE_EXTS, WolvenKit } from './tools'
import { checkSectorEdit, diffSummaries, sectorNodes, summarize, xlSectorEdits } from './cr2wjson'
import { applyOps, validateRecipe, type Recipe } from '../../workflow/recipe'

/** Content patches since 2.0. Live dates come from Steam news; this list is the offline fallback. */
const BUNDLED_PATCHES: PatchInfo[] = [
  { version: '2.5', releaseDate: '2026-10-22', title: 'Update 2.5', source: 'bundled' },
  { version: '2.3', releaseDate: '2025-07-17', title: 'Update 2.3', source: 'bundled' },
  { version: '2.2', releaseDate: '2024-12-10', title: 'Update 2.2', source: 'bundled' },
  { version: '2.1', releaseDate: '2023-12-05', title: 'Update 2.1', source: 'bundled' },
  { version: '2.0', releaseDate: '2023-09-21', title: 'Update 2.0', source: 'bundled' }
]

const STEAM_APP_ID = 1091500

async function steamLibraries(env: NodeJS.ProcessEnv): Promise<string[]> {
  const steamRoots = [
    path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
    path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Steam')
  ]
  const libs = new Set<string>()
  for (const root of steamRoots) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf')
    try {
      const text = await fs.readFile(vdf, 'utf8')
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'))
      libs.add(root)
    } catch {
      /* no Steam here */
    }
  }
  return [...libs]
}

export async function findInstallCandidates(env: NodeJS.ProcessEnv): Promise<string[]> {
  const out: string[] = []
  for (const lib of await steamLibraries(env)) out.push(path.join(lib, 'steamapps', 'common', 'Cyberpunk 2077'))
  for (const drive of ['C', 'D', 'E', 'F']) {
    out.push(`${drive}:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077`)
    out.push(`${drive}:\\GOG Games\\Cyberpunk 2077`)
  }
  out.push('C:\\Program Files (x86)\\GOG Galaxy\\Games\\Cyberpunk 2077')
  out.push('C:\\Program Files\\Epic Games\\Cyberpunk 2077')
  const found: string[] = []
  for (const p of [...new Set(out)]) if (await exists(path.join(p, 'bin', 'x64', 'Cyberpunk2077.exe'))) found.push(p)
  return found
}

function gameRel(gameDir: string, rel: string): string {
  return path.join(gameDir, ...rel.split('/'))
}

async function readModText(dir: string, rel: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, ...rel.split('/')), 'utf8')
  } catch {
    return ''
  }
}

function check(id: string, label: string, status: CheckResult['status'], details: string[] = []): CheckResult {
  return { id, label, status, details }
}

/** Reads the YAML files of a mod and reports syntax errors. */
async function yamlCheck(dir: string, rels: string[]): Promise<CheckResult> {
  const errors: string[] = []
  for (const rel of rels) {
    const text = await readModText(dir, rel)
    for (const doc of YAML.parseAllDocuments(text)) {
      for (const e of doc.errors) errors.push(`${rel}: ${e.message.split('\n')[0]}`)
    }
  }
  return check('yaml', 'YAML files parse', errors.length ? 'fail' : 'pass', errors.length ? errors : [`${rels.length} file(s) OK`])
}

/** Finds error lines in the game's logs from the last session that mention this mod's files. */
async function logMentions(gameDir: string, needles: string[], logFiles: { source: string; file: string }[]): Promise<string[]> {
  const hits: string[] = []
  const lowered = needles.map((n) => n.toLowerCase()).filter((n) => n.length >= 4)
  if (!lowered.length) return hits
  for (const lf of logFiles) {
    const text = await readTail(lf.file, 256 * 1024)
    for (const line of text.split(/\r?\n/)) {
      const l = line.toLowerCase()
      if (!/(error|fail|exception|warn|invalid|can't|cannot|not found)/.test(l)) continue
      if (lowered.some((n) => l.includes(n))) hits.push(`[${lf.source}] ${line.trim().slice(0, 400)}`)
      if (hits.length > 60) return hits
    }
  }
  return hits
}

/** Names that identify a mod's files in logs: script folders, archive names, CET mod folders. */
function modNeedles(c: Classification): string[] {
  const out = new Set<string>()
  for (const f of c.files) {
    const parts = f.relPath.split('/')
    const base = parts[parts.length - 1]
    if (f.kind === 'archive' || f.kind === 'archivexl' || f.kind === 'tweakxl') out.add(base)
    if (f.kind === 'redscript' && parts.length > 3) out.add(parts[2]) // r6/scripts/<folder>/...
    if (f.kind === 'cet') {
      const i = parts.indexOf('mods')
      if (i >= 0 && parts[i + 1]) out.add(`mods\\${parts[i + 1]}`).add(`mods/${parts[i + 1]}`)
    }
  }
  return [...out]
}

export const cyberpunk2077: GameAdapter = {
  id: 'cyberpunk2077',
  name: 'Cyberpunk 2077',
  nexusDomain: 'cyberpunk2077',
  steamAppId: STEAM_APP_ID,
  vortexGameId: 'cyberpunk2077',
  bundledPatches: BUNDLED_PATCHES,
  frameworks: FRAMEWORKS,
  playbook: CYBERPUNK_PLAYBOOK,

  defaultInstallPaths: () => ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\Cyberpunk 2077'],

  defaultSavesPath(env) {
    const home = env.USERPROFILE ?? env.HOME ?? ''
    return path.join(home, 'Saved Games', 'CD Projekt Red', 'Cyberpunk 2077')
  },

  async detectInstalledVersion(gameDir) {
    // RED4ext logs the game version on every launch.
    const logDir = path.join(gameDir, 'red4ext', 'logs')
    const logs = (await walk(logDir).catch(() => [])).sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const l of logs.slice(0, 3)) {
      const head = await readHead(l.abs, 32 * 1024)
      const m =
        head.match(/(?:game|product)\s*(?:patch|version)\s*[:=]?\s*v?(\d+\.\d+[\d.]*)/i) ??
        head.match(/Cyberpunk 2077 \(?v?(\d+\.\d+[\d.]*)/i)
      if (m) return { version: m[1].replace(/\.0+$/, ''), source: `RED4ext log (${l.rel})` }
    }
    // Steam: compare the manifest's last update with the patch list.
    const manifest = path.resolve(gameDir, '..', '..', `appmanifest_${STEAM_APP_ID}.acf`)
    try {
      const text = await fs.readFile(manifest, 'utf8')
      const updated = Number(text.match(/"LastUpdated"\s+"(\d+)"/)?.[1] ?? 0)
      if (updated) {
        const when = new Date(updated * 1000).toISOString()
        const latest = BUNDLED_PATCHES.find((p) => p.releaseDate <= when.slice(0, 10))
        if (latest) return { version: `${latest.version} or later`, source: `Steam last updated the game on ${when.slice(0, 10)}` }
      }
    } catch {
      /* not a Steam install */
    }
    return {}
  },

  classify: (files, readText) => classifyFiles(files, readText),

  async logFiles(gameDir) {
    const out: { source: string; file: string }[] = []
    const add = async (source: string, rel: string): Promise<void> => {
      const f = gameRel(gameDir, rel)
      if (await exists(f)) out.push({ source, file: f })
    }
    await add('redscript', 'r6/logs/redscript_rCURRENT.log')
    const r4 = (await walk(gameRel(gameDir, 'red4ext/logs')).catch(() => [])).sort((a, b) => b.mtimeMs - a.mtimeMs)
    if (r4[0]) out.push({ source: 'RED4ext', file: r4[0].abs })
    for (const p of await walk(gameRel(gameDir, 'red4ext/plugins')).catch(() => [])) {
      if (p.rel.toLowerCase().endsWith('.log')) out.push({ source: p.rel.split('/')[0], file: p.abs })
    }
    await add('CET', 'bin/x64/plugins/cyber_engine_tweaks/cyber_engine_tweaks.log')
    await add('CET scripting', 'bin/x64/plugins/cyber_engine_tweaks/scripting.log')
    for (const p of await walk(gameRel(gameDir, 'bin/x64/plugins/cyber_engine_tweaks/mods')).catch(() => [])) {
      if (p.rel.toLowerCase().endsWith('.log')) out.push({ source: `CET mod ${p.rel.split('/')[0]}`, file: p.abs })
    }
    return out
  },

  async staticChecks(modDir, c, ctx) {
    const results: CheckResult[] = []
    const gameDir = ctx.settings.gamePath
    const reds = c.files.filter((f) => f.kind === 'redscript')
    if (reds.length) {
      const scratch = path.join(ctx.dataDir, 'scratch', `compile-${Date.now()}`)
      const overlay = reds.map((f) => ({ rel: f.relPath.replace(/^r6\/scripts\//i, ''), abs: path.join(modDir, ...f.relPath.split('/')) }))
      const ownRel = new Set(overlay.map((o) => o.rel.toLowerCase()))
      const res = await compileRedscript(ctx, scratch, overlay, (rel) => ownRel.has(rel.toLowerCase()))
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
      if (!res.ran) results.push(check('redscript', 'Scripts compile on this game version', 'skipped', [res.note ?? '']))
      else results.push(check('redscript', 'Scripts compile on this game version', res.ok ? 'pass' : 'fail', res.ok ? ['No errors'] : res.errors.slice(0, 30)))
    }
    const yamls = c.files.filter((f) => f.kind === 'tweakxl' || f.kind === 'archivexl').map((f) => f.relPath)
    if (yamls.length) results.push(await yamlCheck(modDir, yamls))
    const xls = c.files.filter((f) => f.kind === 'archivexl')
    let sectorEdits = 0
    for (const x of xls) {
      try {
        sectorEdits += xlSectorEdits(YAML.parse(await readModText(modDir, x.relPath))).length
      } catch {
        /* reported by the YAML check */
      }
    }
    if (sectorEdits) {
      results.push(
        check('sectors', 'Map sector edits', 'warn', [
          `${sectorEdits} sector edit(s). They are pinned to exact node counts and indexes; a fix job checks each against the new game files.`
        ])
      )
    }
    if (gameDir) {
      const hits = await logMentions(gameDir, modNeedles(c), await this.logFiles(gameDir))
      results.push(
        check('logs', 'Errors in the last game session logs', hits.length ? 'warn' : 'pass', hits.length ? hits.slice(0, 20) : ['None mention this mod'])
      )
    }
    return results
  },

  async prepareWorkspace(ws, ctx, log) {
    const results: CheckResult[] = []
    const gameDir = ctx.settings.gamePath
    const wk = new WolvenKit(ctx, log)
    const hasWk = await wk.available()
    const report: string[] = ['# Prepared inputs', '']

    // 1. Archives: unpack, convert to JSON, and pull the matching vanilla files from the new patch.
    const archives = ws.classification.files.filter((f) => f.kind === 'archive')
    if (archives.length && !hasWk) {
      results.push(check('assets', 'Unpack archives and compare with vanilla', 'skipped', ['WolvenKit CLI is not set in Settings > Tools.']))
      report.push('Archives could not be unpacked: WolvenKit CLI is not configured.')
    } else if (archives.length && gameDir) {
      const diffLines: string[] = []
      for (const a of archives) {
        const name = path.basename(a.relPath, '.archive')
        const rawDir = path.join(ws.unpackedDir, 'raw', name)
        const jsonDir = path.join(ws.unpackedDir, name)
        await wk.unbundle(path.join(ws.originalDir, ...a.relPath.split('/')), rawDir)
        const converted = await wk.serializeTree(rawDir, jsonDir)
        const files = (await walk(rawDir)).map((f) => f.rel)
        report.push(`## ${a.relPath}`, `${files.length} files, ${converted} converted to JSON in unpacked/${name}/`)
        const candidates = files.filter((f) => SERIALIZE_EXTS.includes(path.extname(f).toLowerCase()))
        const vanillaRaw = path.join(ws.vanillaDir, 'raw')
        const extracted = new Set(await wk.extractVanilla(gameDir, candidates, vanillaRaw))
        await wk.serializeTree(vanillaRaw, ws.vanillaDir)
        for (const rel of candidates) {
          if (!extracted.has(rel)) {
            diffLines.push(`- ${rel}: new file (not in vanilla)`)
            continue
          }
          const modJson = await readJson<unknown>(path.join(jsonDir, ...rel.split('/')) + '.json', null)
          const vanJson = await readJson<unknown>(path.join(ws.vanillaDir, ...rel.split('/')) + '.json', null)
          if (!modJson || !vanJson) {
            diffLines.push(`- ${rel}: copy of a vanilla file (could not compare)`)
            continue
          }
          const d = diffSummaries(summarize(vanJson), summarize(modJson))
          diffLines.push(`- ${rel}: copy of a vanilla file${d.length ? '' : ', no structural difference found'}`)
          for (const line of d) diffLines.push(`  - ${line}`)
        }
      }
      await fs.writeFile(path.join(ws.reportsDir, 'assets.md'), ['# Mod files vs vanilla (new patch)', '', ...diffLines].join('\n'))
      const stale = diffLines.filter((l) => l.includes('missing from the mod copy')).length
      results.push(
        check('assets', 'Mod asset copies vs new vanilla files', stale ? 'warn' : 'pass', [
          stale ? `${stale} copied file(s) lack things the new vanilla version has. See reports/assets.md.` : 'See reports/assets.md.'
        ])
      )
    }

    // 2. ArchiveXL sector edits: check every pinned index against the new sectors.
    const xls = ws.classification.files.filter((f) => f.kind === 'archivexl')
    const sectorLines: string[] = []
    let sectorProblems = 0
    for (const x of xls) {
      let doc: unknown
      try {
        doc = YAML.parse(await readModText(ws.originalDir, x.relPath))
      } catch {
        continue
      }
      const edits = xlSectorEdits(doc)
      if (!edits.length) continue
      if (!hasWk || !gameDir) {
        sectorLines.push(`${x.relPath}: ${edits.length} sector edits not checked (WolvenKit CLI not set).`)
        continue
      }
      const sectorRaw = path.join(ws.vanillaDir, 'raw')
      await wk.extractVanilla(gameDir, edits.map((e) => e.path), sectorRaw)
      await wk.serializeTree(sectorRaw, ws.vanillaDir)
      sectorLines.push(`## ${x.relPath}`)
      for (const e of edits) {
        const json = await readJson<unknown>(path.join(ws.vanillaDir, ...toPosix(e.path).split('/')) + '.json', null)
        if (!json) {
          sectorLines.push(`- ${e.path}: could not extract or read it (this WolvenKit version may not support the new sector format)`)
          sectorProblems++
          continue
        }
        const sec = sectorNodes(json)
        const tsv = ['index\tnodeIndex\ttype\tx\ty\tz\tlabel', ...sec.nodes.map((n) => [n.index, n.nodeIndex, n.type, ...(n.position ?? ['', '', '']), n.label ?? ''].join('\t'))]
        const tsvPath = path.join(ws.vanillaDir, ...toPosix(e.path).split('/')) + '.nodes.tsv'
        await fs.writeFile(tsvPath, tsv.join('\n'))
        const probs = checkSectorEdit(e, sec)
        sectorProblems += probs.length
        sectorLines.push(`- ${e.path}: ${probs.length ? probs.length + ' problem(s)' : 'OK'} (node table: vanilla/${toPosix(e.path)}.nodes.tsv)`)
        for (const p of probs) sectorLines.push(`  - ${p}`)
      }
    }
    if (sectorLines.length) {
      await fs.writeFile(path.join(ws.reportsDir, 'sectors.md'), ['# ArchiveXL sector edits vs new sectors', '', ...sectorLines].join('\n'))
      results.push(check('sectors', 'Sector edits match the new map sectors', sectorProblems ? 'fail' : 'pass', [`${sectorProblems} problem(s). See reports/sectors.md.`]))
    }

    // 3. Scripts: test compile.
    const reds = ws.classification.files.filter((f) => f.kind === 'redscript')
    if (reds.length) {
      const overlay = reds.map((f) => ({ rel: f.relPath.replace(/^r6\/scripts\//i, ''), abs: path.join(ws.originalDir, ...f.relPath.split('/')) }))
      const own = new Set(overlay.map((o) => o.rel.toLowerCase()))
      const res = await compileRedscript(ctx, path.join(ws.dir, 'scratch'), overlay, (rel) => own.has(rel.toLowerCase()))
      const body = res.ran ? res.output : (res.note ?? '')
      await fs.writeFile(path.join(ws.reportsDir, 'redscript.md'), `# Test compile of the original scripts\n\n\`\`\`\n${body.slice(-20000)}\n\`\`\`\n`)
      results.push(
        check('redscript', 'Original scripts compile on the new patch', !res.ran ? 'skipped' : res.ok ? 'pass' : 'fail', res.ran ? res.errors.slice(0, 20) : [res.note ?? ''])
      )
    }

    // 4. Logs from the last game session.
    if (gameDir) {
      const hits = await logMentions(gameDir, modNeedles(ws.classification), await this.logFiles(gameDir))
      await fs.writeFile(path.join(ws.reportsDir, 'logs.md'), ['# Log lines from the last game session that mention this mod', '', ...hits.map((h) => `- ${h}`)].join('\n'))
    }
    await fs.writeFile(path.join(ws.reportsDir, 'prepared.md'), report.join('\n'))
    return results
  },

  async fulfillRequests(ws, req: AiRequests, ctx, log) {
    const gameDir = ctx.settings.gamePath
    const wk = new WolvenKit(ctx, log)
    if (!gameDir || !(await wk.available())) return ['Could not extract vanilla files: game folder or WolvenKit CLI not set.']
    const paths = (req.vanilla ?? []).map(toPosix)
    const regex = req.vanillaRegex ?? []
    if (!paths.length && !regex.length) return []
    const raw = path.join(ws.vanillaDir, 'raw')
    const before = new Set((await walk(raw).catch(() => [])).map((f) => f.rel))
    const after = await wk.extractVanilla(gameDir, paths, raw, regex)
    await wk.serializeTree(raw, ws.vanillaDir)
    const added = after.filter((f) => !before.has(f))
    const missing = paths.filter((p) => !after.some((a) => a.toLowerCase() === p.toLowerCase()))
    return [
      `Extracted ${added.length} vanilla file(s) into vanilla/ (JSON next to each convertible file).`,
      ...added.slice(0, 200).map((a) => `- vanilla/${a}`),
      ...missing.map((m) => `- not found in the game archives: ${m}`)
    ]
  },

  async buildAndVerify(ws, ctx, log) {
    const results: CheckResult[] = []
    const wk = new WolvenKit(ctx, log)
    const buildDir = path.join(ws.dir, 'build')
    await fs.rm(buildDir, { recursive: true, force: true })

    // 1. Recipe -> JSON files to pack.
    const recipePath = path.join(ws.dir, 'recipe.json')
    const archiveNames = new Set<string>()
    if (await exists(recipePath)) {
      let recipe: Recipe
      try {
        recipe = JSON.parse(await fs.readFile(recipePath, 'utf8'))
      } catch (e) {
        results.push(check('recipe', 'recipe.json', 'fail', [`Not valid JSON: ${String(e)}`]))
        return results
      }
      const errs = validateRecipe(recipe)
      if (errs.length) {
        results.push(check('recipe', 'recipe.json', 'fail', errs))
        return results
      }
      const misses: string[] = []
      let written = 0
      for (const a of recipe.archives ?? []) {
        archiveNames.add(a.name)
        for (const f of a.files) {
          const [kind, rel] = [f.from.slice(0, f.from.indexOf(':')), f.from.slice(f.from.indexOf(':') + 1)]
          const base = kind === 'vanilla' ? ws.vanillaDir : kind === 'mod' ? ws.unpackedDir : ws.srcDir
          const doc = await readJson<unknown>(path.join(base, ...toPosix(rel).split('/')), null)
          if (doc === null) {
            misses.push(`${f.to}: source ${f.from} not found or not JSON`)
            continue
          }
          const r = applyOps(doc, f.ops ?? [])
          misses.push(...r.misses.map((m) => `${f.to}: ${m}`))
          const toRel = toPosix(f.to).endsWith('.json') ? toPosix(f.to) : `${toPosix(f.to)}.json`
          await writeJson(path.join(buildDir, 'json', a.name, ...toRel.split('/')), doc)
          written++
        }
      }
      results.push(check('recipe', `Recipe produced ${written} file(s)`, misses.length ? 'fail' : 'pass', misses.slice(0, 40)))
      if (misses.length) return results
    }

    // 2. Hand-written archive sources in src/archives/<name>/.
    const srcArchives = path.join(ws.srcDir, 'archives')
    if (await exists(srcArchives)) {
      for (const e of await fs.readdir(srcArchives, { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        archiveNames.add(e.name)
        await fs.cp(path.join(srcArchives, e.name), path.join(buildDir, 'json', e.name), { recursive: true })
      }
    }

    // 3. JSON -> game files -> .archive
    if (archiveNames.size) {
      if (!(await wk.available())) {
        results.push(check('pack', 'Pack archives', 'fail', ['WolvenKit CLI is needed to build archives. Set it in Settings > Tools.']))
        return results
      }
      const modDir = path.join(ws.outputDir, 'archive', 'pc', 'mod')
      await ensureDir(modDir)
      for (const name of archiveNames) {
        const jsonDir = path.join(buildDir, 'json', name)
        const rawDir = path.join(buildDir, 'raw', name)
        await ensureDir(rawDir)
        const files = await walk(jsonDir)
        for (const f of files) {
          const destDir = path.join(rawDir, path.dirname(f.rel))
          await ensureDir(destDir)
          if (f.rel.endsWith('.json')) await wk.deserialize(f.abs, destDir)
          else await fs.copyFile(f.abs, path.join(destDir, path.basename(f.rel)))
        }
        const res = await wk.pack(rawDir, modDir)
        const built = path.join(modDir, `${name}.archive`)
        const ok = res.code === 0 && (await exists(built))
        results.push(check(`pack-${name}`, `Pack ${name}.archive`, ok ? 'pass' : 'fail', ok ? [`${files.length} file(s)`] : [(res.stderr || res.stdout).slice(-1500)]))
      }
    }

    // 4. Verify the output.
    const out = await walk(ws.outputDir).catch(() => [])
    if (!out.length) {
      results.push(check('output', 'Fix has files', 'fail', ['output/ is empty. Write the fix there (or a recipe.json / src/archives for assets).']))
      return results
    }
    const allowedRoots = ['archive/pc/mod/', 'r6/scripts/', 'r6/tweaks/', 'bin/x64/plugins/cyber_engine_tweaks/mods/', 'engine/config/', 'r6/input/']
    const outside = out.filter((f) => !allowedRoots.some((r) => f.rel.toLowerCase().startsWith(r)))
    const nativeFiles = out.filter((f) => /\.(dll|asi|exe)$/i.test(f.rel))
    results.push(
      check('layout', 'Files go to normal mod folders', outside.length || nativeFiles.length ? 'fail' : 'pass', [
        ...outside.map((f) => `Unexpected location: ${f.rel}`),
        ...nativeFiles.map((f) => `Native code isn't allowed in a fix: ${f.rel}`),
        ...(outside.length || nativeFiles.length ? [] : [`${out.length} file(s)`])
      ])
    )

    const fixReds = out.filter((f) => f.rel.toLowerCase().endsWith('.reds'))
    if (fixReds.length) {
      const fixMeta = await readJson<{ mode?: string }>(path.join(ws.dir, 'fix.json'), {})
      const originalReds = ws.classification.files.filter((f) => f.kind === 'redscript')
      const overlay = fixReds.map((f) => ({ rel: f.rel.replace(/^r6\/scripts\//i, ''), abs: f.abs }))
      if (fixMeta.mode !== 'replace') {
        for (const f of originalReds) overlay.unshift({ rel: f.relPath.replace(/^r6\/scripts\//i, ''), abs: path.join(ws.originalDir, ...f.relPath.split('/')) })
      }
      const ownOriginal = new Set(originalReds.map((f) => f.relPath.replace(/^r6\/scripts\//i, '').toLowerCase()))
      const res = await compileRedscript(ctx, path.join(ws.dir, 'scratch'), overlay, (rel) => ownOriginal.has(rel.toLowerCase()))
      results.push(
        check('compile', 'Fix compiles with your installed scripts', !res.ran ? 'skipped' : res.ok ? 'pass' : 'fail', res.ran ? (res.ok ? ['No errors'] : res.errors.slice(0, 30)) : [res.note ?? ''])
      )
    }

    const yamls = out.filter((f) => /\.(ya?ml|xl|tweak)$/i.test(f.rel)).map((f) => f.rel)
    if (yamls.length) results.push(await yamlCheck(ws.outputDir, yamls))

    // Sector edits in the fix must match the new sectors exactly.
    let sectorProblems: string[] = []
    for (const rel of out.filter((f) => f.rel.toLowerCase().endsWith('.xl')).map((f) => f.rel)) {
      let doc: unknown
      try {
        doc = YAML.parse(await readModText(ws.outputDir, rel))
      } catch {
        continue
      }
      for (const e of xlSectorEdits(doc)) {
        const json = await readJson<unknown>(path.join(ws.vanillaDir, ...toPosix(e.path).split('/')) + '.json', null)
        if (!json) {
          sectorProblems.push(`${e.path}: vanilla sector not extracted, can't verify (ask for it in requests.json)`)
          continue
        }
        sectorProblems = sectorProblems.concat(checkSectorEdit(e, sectorNodes(json)).map((p) => `${e.path}: ${p}`))
      }
    }
    if (out.some((f) => f.rel.toLowerCase().endsWith('.xl'))) {
      results.push(check('sectors', 'Sector edits match the new sectors', sectorProblems.length ? 'fail' : 'pass', sectorProblems.slice(0, 40)))
    }
    const lua = out.filter((f) => f.rel.toLowerCase().endsWith('.lua'))
    if (lua.length) results.push(check('lua', 'CET Lua', 'warn', [`${lua.length} Lua file(s). Lua isn't checked before the game runs; read the CET log after testing.`]))
    return results
  },

  testHints(c) {
    const hints: string[] = []
    if (c.kinds.includes('redscript')) hints.push('After launching, check r6/logs/redscript_rCURRENT.log for errors. A compile error makes the game show a warning popup at start.')
    if (c.kinds.includes('cet')) hints.push("Open the CET overlay and look for the mod's window or settings, then check its log in its CET mod folder.")
    if (c.kinds.includes('archive')) hints.push('Look at the things the mod replaces (characters, items, places) in game. Stale copies show as missing animations, T-poses, or vanilla looks.')
    if (c.kinds.includes('archivexl')) hints.push('Check red4ext/plugins/ArchiveXL/ArchiveXL.log for rejected edits, and visit the places the mod changes.')
    if (c.kinds.includes('tweakxl')) hints.push('Check red4ext/plugins/TweakXL/TweakXL.log for errors about missing records.')
    hints.push('Load a save made right before the test. Keep the backed-up saves until you are sure the fix is good.')
    return hints
  }
}
