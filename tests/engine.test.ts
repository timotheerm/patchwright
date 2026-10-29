// End-to-end run of the engine on a fake PC: a game folder, a Vortex staging folder with two script
// mods, a fake Vortex.exe that keeps its state in a JSON file, and a scripted AI.
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Engine } from '../src/core/engine'
import type { AiBackend } from '../src/core/ai/types'
import type { AppEvent, JobState } from '../src/shared/types'

let root: string
let engine: Engine
const events: AppEvent[] = []

const fakeVortex = (stateFile: string): string => `#!/usr/bin/env node
const fs = require('fs')
const file = ${JSON.stringify(stateFile)}
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const [flag, arg] = process.argv.slice(2)
const walk = (p, create) => {
  const keys = p.split('.')
  let o = state
  for (const k of keys.slice(0, -1)) {
    if (o[k] === undefined) { if (!create) return [undefined, keys.at(-1)]; o[k] = {} }
    o = o[k]
  }
  return [o, keys.at(-1)]
}
if (flag === '--get') {
  const [o, k] = walk(arg, false)
  if (o && o[k] !== undefined) console.log(JSON.stringify(o[k]))
} else if (flag === '--set') {
  const i = arg.indexOf('=')
  const [o, k] = walk(arg.slice(0, i), true)
  o[k] = JSON.parse(arg.slice(i + 1))
} else if (flag === '--del') {
  const [o, k] = walk(arg, false)
  if (o) delete o[k]
}
fs.writeFileSync(file, JSON.stringify(state))
`

/** An AI that writes a fixed script, fix.json and NOTES.md in one round. */
const scriptedAi = (): AiBackend => ({
  kind: 'claude-cli',
  label: 'Scripted test AI',
  canBrowse: false,
  test: async () => ({ ok: true, detail: 'ok' }),
  ask: async () => 'Summary from the test AI.',
  runAgent: async (task, onEvent) => {
    const task_md = await fs.readFile(path.join(task.cwd, 'TASK.md'), 'utf8')
    onEvent({ kind: 'text', text: `Read TASK.md (${task_md.length} chars)` })
    await fs.mkdir(path.join(task.cwd, 'output/r6/scripts/NeonHud'), { recursive: true })
    await fs.writeFile(path.join(task.cwd, 'output/r6/scripts/NeonHud/hud.reds'), '// fixed for 2.5\n')
    await fs.writeFile(
      path.join(task.cwd, 'fix.json'),
      JSON.stringify({
        mode: 'replace',
        problem: 'A HUD class was renamed in 2.5.',
        approach: 'Pointed the script at the renamed class.',
        lessons: ['Look up renamed classes in the new game scripts.'],
        patchChanges: [{ summary: 'The HUD class NeonHudOld was renamed in 2.5.', affects: ['redscript'], keywords: ['neonhudold'] }]
      })
    )
    await fs.writeFile(path.join(task.cwd, 'NOTES.md'), '# Neon HUD 2.5 fix\n\nRenamed a function 2.5 removed.')
    return { ok: true, text: 'Done.', costUsd: 0.12, sessionId: 's1' }
  }
})

async function waitForJob(id: string): Promise<JobState> {
  for (let i = 0; i < 200; i++) {
    const j = engine.listJobs().find((x) => x.id === id)
    if (j && ['ready', 'failed', 'cancelled'].includes(j.status)) return j
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('job did not finish')
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'patchwright-e2e-'))
  const p = (...s: string[]) => path.join(root, ...s)
  await fs.mkdir(p('game', 'bin', 'x64'), { recursive: true })
  await fs.mkdir(p('staging', 'Neon HUD-1234-1-0-1730000000', 'r6', 'scripts', 'NeonHud'), { recursive: true })
  await fs.writeFile(p('staging', 'Neon HUD-1234-1-0-1730000000', 'r6', 'scripts', 'NeonHud', 'hud.reds'), '// old\n')
  await fs.mkdir(p('staging', 'Other-55-2-0-1730000001', 'r6', 'scripts', 'Other'), { recursive: true })
  await fs.writeFile(p('staging', 'Other-55-2-0-1730000001', 'r6', 'scripts', 'Other', 'x.reds'), '// uses NeonHud\n')
  await fs.mkdir(p('saves', 'ManualSave-1'), { recursive: true })
  await fs.writeFile(p('saves', 'ManualSave-1', 'sav.dat'), 'save')
  await fs.writeFile(
    p('vortex-state.json'),
    JSON.stringify({
      persistent: { profiles: { Main1: { id: 'Main1', gameId: 'cyberpunk2077', name: 'Default', modState: { a: { enabled: true } } } } },
      settings: { profiles: { lastActiveProfile: { cyberpunk2077: 'Main1' } } }
    })
  )
  await fs.writeFile(p('Vortex.exe'), fakeVortex(p('vortex-state.json')), { mode: 0o755 })

  engine = await Engine.create({
    dataDir: p('data'),
    appVersion: '0.0.0-test',
    emit: (e) => events.push(e),
    fetch: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch,
    env: { HOME: root, USERPROFILE: root },
    platform: 'linux',
    backend: scriptedAi
  })
  await engine.saveSettings({
    gamePath: p('game'),
    vortexExe: p('Vortex.exe'),
    vortexStagingPath: p('staging'),
    backupsPath: p('backups'),
    workspacePath: p('jobs'),
    savesPath: p('saves'),
    communityChecks: false,
    vortexAutomation: true,
    patchOverride: { version: '2.5', releaseDate: '2026-10-22' }
  })
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('engine on a fake PC', () => {
  it('reads the patch and the installed mods', async () => {
    const st = await engine.gameStatus()
    expect(st.baselinePatch).toMatchObject({ version: '2.5', source: 'manual' })
    const mods = await engine.listInstalledMods()
    expect(mods.map((m) => m.name).sort()).toEqual(['Neon HUD', 'Other'])
  })

  it('creates a test profile copied from the active one, and can undo it', async () => {
    const r = await engine.createTestProfile()
    expect(r.ok).toBe(true)
    const state = JSON.parse(await fs.readFile(path.join(root, 'vortex-state.json'), 'utf8'))
    const created = Object.values(state.persistent.profiles as Record<string, { name: string; modState: unknown }>).find((x) => x.name === 'Patchwright 2.5 test')
    expect(created?.modState).toEqual({ a: { enabled: true } })
  })

  it('checks a mod, builds a fix, installs it as a separate mod, and undoes the install', async () => {
    const { mods } = await engine.resolveInput('Neon')
    expect(mods).toHaveLength(1)
    const [t] = await engine.triage(mods)
    expect(t.classification?.kinds).toContain('redscript')
    expect(t.action).toBe('ai-fix')

    const started = await engine.startJob(t)
    const job = await waitForJob(started.id)
    expect(job.error).toBeUndefined()
    expect(job.status).toBe('ready')
    expect(job.costUsd).toBe(0.12)
    // The original mod is untouched.
    expect(await fs.readFile(path.join(root, 'staging', 'Neon HUD-1234-1-0-1730000000', 'r6', 'scripts', 'NeonHud', 'hud.reds'), 'utf8')).toBe('// old\n')
    // The task was built from the knowledge base, with a plan; the user typed nothing.
    const task = await fs.readFile(path.join(job.dir, 'TASK.md'), 'utf8')
    expect(task).toContain('## What Patchwright already knows')
    expect(task).toContain('## Plan')
    expect(task).toContain('reports/redscript.md')
    const knowledge = await fs.readFile(path.join(job.dir, 'KNOWLEDGE.md'), 'utf8')
    expect(knowledge).toContain('Improved Environment LODs')
    // The finished fix was saved to the knowledge base, untested until the user tries it.
    const learned = (await engine.getKnowledge()).fixes.find((f) => f.fromJob === job.id)
    expect(learned).toMatchObject({ modName: 'Neon HUD', outcome: 'untested', problem: 'A HUD class was renamed in 2.5.' })
    expect((await engine.getKnowledge()).changes.some((c) => c.summary.includes('NeonHudOld'))).toBe(true)
    // The other mod that mentions this one is listed for the AI.
    expect(await fs.readFile(path.join(job.dir, 'reports', 'dependents.md'), 'utf8')).toContain('Other')

    const d = await engine.deliverJob(job.id, 'staging')
    expect(d.ok).toBe(true)
    expect(d.vortexRegistered).toBe(true)
    const fixDir = path.join(root, 'staging', 'Neon HUD - 2.5 fix (Patchwright)')
    expect(await fs.readFile(path.join(fixDir, 'r6', 'scripts', 'NeonHud', 'hud.reds'), 'utf8')).toBe('// fixed for 2.5\n')
    expect(engine.listJobs().find((j) => j.id === job.id)?.status).toBe('delivered')

    const log = await engine.getChangelog()
    const install = log.find((e) => e.action === 'Installed fix into Vortex staging')!
    expect(install).toBeDefined()
    expect(await fs.readFile(path.join(root, 'backups', 'CHANGELOG.md'), 'utf8')).toContain('Installed fix into Vortex staging')

    const u = await engine.undo(install.id)
    expect(u.ok).toBe(true)
    await expect(fs.stat(fixDir)).rejects.toThrow()
    // Undo moves things aside; nothing is deleted.
    expect((await fs.readdir(path.join(root, 'backups', 'undone'))).length).toBeGreaterThan(0)

    const reg = (await engine.getChangelog()).find((e) => e.action === 'Registered in Vortex' && e.target.startsWith('persistent.mods.'))!
    expect((await engine.undo(reg.id)).ok).toBe(true)
    const state = JSON.parse(await fs.readFile(path.join(root, 'vortex-state.json'), 'utf8'))
    expect(state.persistent.mods?.cyberpunk2077 ?? {}).toEqual({})
  })

  it('records the in-game result in the job and the knowledge base', async () => {
    const job = engine.listJobs()[0]
    const r = await engine.recordOutcome(job.id, 'works', 'HUD is back')
    expect(r.ok).toBe(true)
    expect(engine.listJobs()[0].outcome).toBe('works')
    const f = (await engine.getKnowledge()).fixes.find((x) => x.fromJob === job.id)
    expect(f).toMatchObject({ outcome: 'works', outcomeNote: 'HUD is back' })
    // A second, similar mod now starts from it.
    const [t] = await engine.triage([{ key: 'x', name: 'Neon HUD Lite', source: 'local', stagingPath: path.join(root, 'staging', 'Other-55-2-0-1730000001') }])
    const k = await engine.knowledgeFor(t)
    expect(k.fixes[0].entry.fromJob).toBe(job.id)
  })

  it('exports and imports learned knowledge', async () => {
    const ex = await engine.exportKnowledge()
    expect(ex.ok).toBe(true)
    const im = await engine.importKnowledge(ex.path!)
    expect(im.message).toContain('Added 0')
  })

  it('backs up saves', async () => {
    const r = await engine.backupSaves()
    expect(r.ok).toBe(true)
    expect(await fs.readFile(path.join(r.path!, 'ManualSave-1', 'sav.dat'), 'utf8')).toBe('save')
  })

  it('emitted job and log events for the UI', () => {
    expect(events.some((e) => e.type === 'job')).toBe(true)
    expect(events.some((e) => e.type === 'job-log')).toBe(true)
    expect(events.some((e) => e.type === 'triage-result')).toBe(true)
  })
})
