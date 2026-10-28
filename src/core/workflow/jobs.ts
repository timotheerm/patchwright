import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { CheckResult, FrameworkStatus, JobState, JobStep, LogLine, ModRef, PatchInfo, TriageResult } from '../../shared/types'
import type { AiBackend } from '../ai/types'
import { fixName, type CoreContext } from '../context'
import type { AiRequests, GameAdapter, JobWorkspace } from '../games/types'
import { copyDir, ensureDir, exists, nowIso, readJson, safeName, timestampSlug, walk, writeJson } from '../util'
import { feedbackMarkdown, systemPrompt, taskMarkdown, WRITABLE } from './prompts'

export interface JobDeps {
  ctx: CoreContext
  game: GameAdapter
  backend: () => AiBackend
  patch: () => Promise<PatchInfo | undefined>
  frameworks: () => Promise<FrameworkStatus[]>
  installedMods: () => Promise<ModRef[]>
}

interface JobRecord {
  state: JobState
  log: LogLine[]
  abort?: AbortController
}

const STEPS: { id: string; label: string }[] = [
  { id: 'prepare', label: 'Copy the mod and gather inputs' },
  { id: 'checks', label: 'Compare with the new game files' },
  { id: 'ai', label: 'AI writes the fix' },
  { id: 'verify', label: 'Build and check the fix' },
  { id: 'ready', label: 'Ready to install in a test profile' }
]

const TEXT_EXT = /\.(reds|lua|ya?ml|xl|json|txt|ini|tweak|toml|md)$/i

export function workspaceFor(dir: string, modName: string, fix: string, patch: string, t: TriageResult): JobWorkspace {
  return {
    dir,
    originalDir: path.join(dir, 'original'),
    vanillaDir: path.join(dir, 'vanilla'),
    unpackedDir: path.join(dir, 'unpacked'),
    reportsDir: path.join(dir, 'reports'),
    outputDir: path.join(dir, 'output'),
    srcDir: path.join(dir, 'src'),
    modName,
    fixName: fix,
    patch,
    classification: t.classification!
  }
}

/** Names other mods might use to detect this one: archive files, script folders, CET mod folders. */
export function identifyingNames(t: TriageResult): string[] {
  const names = new Set<string>()
  for (const f of t.classification?.files ?? []) {
    const parts = f.relPath.split('/')
    if (f.kind === 'archive') names.add(parts[parts.length - 1])
    if (f.kind === 'cet') {
      const i = parts.indexOf('mods')
      if (i >= 0 && parts[i + 1] && parts[i + 1].length > 3) names.add(parts[i + 1])
    }
  }
  return [...names]
}

export class JobManager {
  private jobs = new Map<string, JobRecord>()

  constructor(private d: JobDeps) {}

  private get root(): string {
    return this.d.ctx.settings.workspacePath ?? path.join(this.d.ctx.dataDir, 'jobs')
  }

  /** Loads jobs from earlier sessions. Jobs that were running when the app closed are marked failed. */
  async load(): Promise<void> {
    if (!(await exists(this.root))) return
    for (const e of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const state = await readJson<JobState | null>(path.join(this.root, e.name, 'job.json'), null)
      if (!state || this.jobs.has(state.id)) continue
      if (['queued', 'preparing', 'running-ai', 'verifying'].includes(state.status)) {
        state.status = 'failed'
        state.error = 'Patchwright was closed while this job ran. Start it again.'
      }
      const raw = await fs.readFile(path.join(this.root, e.name, 'log.jsonl'), 'utf8').catch(() => '')
      const log = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogLine)
      this.jobs.set(state.id, { state, log })
    }
  }

  list(): JobState[] {
    return [...this.jobs.values()].map((j) => j.state).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id)?.state
  }

  getLog(id: string): LogLine[] {
    return this.jobs.get(id)?.log ?? []
  }

  async markDelivered(id: string, to: string): Promise<void> {
    const rec = this.jobs.get(id)
    if (!rec) return
    rec.state.status = 'delivered'
    rec.state.deliveredTo = to
    await this.save(rec)
  }

  cancel(id: string): void {
    const j = this.jobs.get(id)
    j?.abort?.abort()
  }

  async start(t: TriageResult): Promise<JobState> {
    if (!t.mod.stagingPath || !(await exists(t.mod.stagingPath))) {
      throw new Error(`"${t.mod.name}" isn't installed, so there are no files to work from. Install it with Vortex first.`)
    }
    if (!t.classification) throw new Error('Run the check on this mod first.')
    const patch = (await this.d.patch())?.version ?? 'latest'
    const id = `${timestampSlug()}-${Math.random().toString(36).slice(2, 6)}`
    const dir = path.join(this.root, `${safeName(t.mod.name).slice(0, 48)} ${id}`)
    const now = nowIso()
    const state: JobState = {
      id,
      modKey: t.mod.key,
      modName: t.mod.name,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      round: 0,
      maxRounds: this.d.ctx.settings.ai.maxRounds,
      steps: STEPS.map((s) => ({ ...s, status: 'pending' })),
      dir,
      outputDir: path.join(dir, 'output'),
      backend: this.d.backend().label,
      fixName: fixName(this.d.ctx.settings, t.mod.name, patch)
    }
    const rec: JobRecord = { state, log: [], abort: new AbortController() }
    this.jobs.set(id, rec)
    await ensureDir(dir)
    await writeJson(path.join(dir, 'triage.json'), t)
    await this.save(rec)
    void this.run(rec, t, patch)
    return state
  }

  private async save(rec: JobRecord): Promise<void> {
    rec.state.updatedAt = nowIso()
    await writeJson(path.join(rec.state.dir, 'job.json'), rec.state)
    this.d.ctx.emit({ type: 'job', job: { ...rec.state, steps: rec.state.steps.map((s) => ({ ...s })) } })
  }

  private async logLine(rec: JobRecord, level: LogLine['level'], text: string): Promise<void> {
    const line: LogLine = { ts: nowIso(), level, text }
    rec.log.push(line)
    if (rec.log.length > 5000) rec.log.splice(0, rec.log.length - 5000)
    this.d.ctx.emit({ type: 'job-log', jobId: rec.state.id, line })
    await fs.appendFile(path.join(rec.state.dir, 'log.jsonl'), `${JSON.stringify(line)}\n`).catch(() => {})
  }

  private async step(rec: JobRecord, id: string, status: JobStep['status'], detail?: string): Promise<void> {
    const s = rec.state.steps.find((x) => x.id === id)
    if (s) {
      s.status = status
      if (detail !== undefined) s.detail = detail
    }
    await this.save(rec)
  }

  private async fail(rec: JobRecord, error: string, stepId: string): Promise<void> {
    rec.state.status = rec.abort?.signal.aborted ? 'cancelled' : 'failed'
    rec.state.error = error
    await this.logLine(rec, 'error', error)
    await this.step(rec, stepId, 'failed', error)
  }

  private async run(rec: JobRecord, t: TriageResult, patch: string): Promise<void> {
    const { ctx, game } = this.d
    const st = rec.state
    const ws = workspaceFor(st.dir, t.mod.name, st.fixName, patch, t)
    const log = (m: string): void => void this.logLine(rec, 'tool', m)
    try {
      // 1. Copy the mod. Its files are never touched again.
      st.status = 'preparing'
      await this.step(rec, 'prepare', 'running')
      for (const d of [ws.originalDir, ws.vanillaDir, ws.unpackedDir, ws.reportsDir, ws.outputDir, ws.srcDir]) await ensureDir(d)
      const copied = await copyDir(t.mod.stagingPath!, ws.originalDir)
      await this.logLine(rec, 'info', `Copied ${copied} file(s) from ${t.mod.stagingPath}`)
      await fs.writeFile(path.join(st.dir, 'PLAYBOOK.md'), game.playbook)
      const dependents = await this.findDependents(t)
      await fs.writeFile(path.join(ws.reportsDir, 'dependents.md'), ['# Other mods that mention this one', '', ...dependents.map((d) => `- ${d}`)].join('\n'))
      await this.step(rec, 'prepare', 'done', `${copied} files`)

      // 2. Deterministic inputs: unpack, extract vanilla, compile, read logs.
      await this.step(rec, 'checks', 'running')
      const prep = await game.prepareWorkspace(ws, ctx, log)
      await writeJson(path.join(ws.reportsDir, 'checks.json'), [...t.checks, ...prep])
      const frameworks = await this.d.frameworks()
      await fs.writeFile(path.join(st.dir, 'TASK.md'), taskMarkdown(ws, t, prep, frameworks, dependents, game))
      await this.step(rec, 'checks', 'done', summarizeChecks(prep))

      // 3-4. AI rounds, each followed by a build and checks.
      const backend = this.d.backend()
      const system = systemPrompt(game)
      let next: 'start' | 'feedback' | 'requests' = 'start'
      let requestRounds = 0
      let lastResults: CheckResult[] = []
      for (let round = 1; round <= st.maxRounds; ) {
        if (rec.abort?.signal.aborted) return this.fail(rec, 'Cancelled.', 'ai')
        st.round = round
        st.status = 'running-ai'
        await this.step(rec, 'ai', 'running', `Round ${round} of ${st.maxRounds}`)
        const prompt =
          next === 'start'
            ? 'Read TASK.md, then do the task. End your turn when the fix, fix.json and NOTES.md are written.'
            : next === 'requests'
              ? 'The vanilla files you asked for are ready; REQUESTS.md lists them. Continue the task.'
              : 'Read FEEDBACK.md. Fix what it lists, then end your turn.'
        await this.logLine(rec, 'info', `${backend.label}: ${prompt}`)
        const res = await backend.runAgent(
          { cwd: st.dir, prompt, system, writable: WRITABLE, resume: next !== 'start', maxTurns: ctx.settings.ai.maxTurns },
          (e) => void this.logLine(rec, e.kind === 'text' ? 'ai' : e.kind === 'tool' ? 'tool' : e.kind === 'error' ? 'warn' : 'info', e.text),
          rec.abort!.signal
        )
        st.costUsd = res.costUsd ?? st.costUsd
        st.sessionId = res.sessionId ?? st.sessionId
        if (res.text) st.summary = res.text.slice(0, 2000)
        if (!res.ok) return this.fail(rec, res.error ?? 'The AI run failed.', 'ai')

        const reqFile = path.join(st.dir, 'requests.json')
        if (await exists(reqFile)) {
          const req = await readJson<AiRequests>(reqFile, {})
          await fs.rm(reqFile, { force: true })
          if (requestRounds < 3) {
            requestRounds++
            await this.logLine(rec, 'info', `The AI asked for ${(req.vanilla?.length ?? 0) + (req.vanillaRegex?.length ?? 0)} vanilla file pattern(s).`)
            const lines = await game.fulfillRequests(ws, req, ctx, log)
            await fs.writeFile(path.join(st.dir, 'REQUESTS.md'), ['# Requested files', '', ...lines].join('\n'))
            next = 'requests'
            continue
          }
        }

        st.status = 'verifying'
        await this.step(rec, 'ai', 'done', `Round ${round}`)
        await this.step(rec, 'verify', 'running')
        lastResults = [...(await game.buildAndVerify(ws, ctx, log)), ...(await this.genericChecks(ws, t))]
        await writeJson(path.join(ws.reportsDir, `build-round-${round}.json`), lastResults)
        for (const r of lastResults) await this.logLine(rec, r.status === 'fail' ? 'error' : r.status === 'warn' ? 'warn' : 'info', `${r.status.toUpperCase()} ${r.label}${r.details[0] ? `: ${r.details[0]}` : ''}`)
        if (!lastResults.some((r) => r.status === 'fail')) {
          await this.step(rec, 'verify', 'done', summarizeChecks(lastResults))
          const notes = await fs.readFile(path.join(st.dir, 'NOTES.md'), 'utf8').catch(() => '')
          if (notes) st.summary = notes.slice(0, 4000)
          st.status = 'ready'
          await this.step(rec, 'ready', 'done', 'Install it from the job page')
          await this.logLine(rec, 'info', 'The fix is built and passed the checks. It still needs an in-game test.')
          return
        }
        await fs.writeFile(path.join(st.dir, 'FEEDBACK.md'), feedbackMarkdown(round, lastResults))
        await this.step(rec, 'verify', 'failed', summarizeChecks(lastResults))
        next = 'feedback'
        round++
      }
      return this.fail(rec, `Checks still fail after ${st.maxRounds} rounds. See FEEDBACK.md in the job folder.`, 'verify')
    } catch (e) {
      return this.fail(rec, e instanceof Error ? e.message : String(e), rec.state.steps.find((s) => s.status === 'running')?.id ?? 'prepare')
    } finally {
      rec.abort = undefined
      await this.save(rec)
    }
  }

  /** Checks that apply to every game: the AI wrote its notes, and the fix doesn't overwrite other mods. */
  private async genericChecks(ws: JobWorkspace, t: TriageResult): Promise<CheckResult[]> {
    const out: CheckResult[] = []
    const fixMeta = await readJson<{ mode?: string } | null>(path.join(ws.dir, 'fix.json'), null)
    const notes = await exists(path.join(ws.dir, 'NOTES.md'))
    const missing = [!fixMeta || !['addon', 'replace'].includes(fixMeta.mode ?? '') ? 'fix.json (with mode "addon" or "replace")' : '', !notes ? 'NOTES.md' : ''].filter(Boolean)
    out.push({ id: 'notes', label: 'Fix description written', status: missing.length ? 'fail' : 'pass', details: missing.map((m) => `Missing ${m}`) })

    const mine = new Set((await walk(ws.outputDir)).map((f) => f.rel.toLowerCase()))
    const clashes: string[] = []
    for (const m of await this.d.installedMods()) {
      if (!m.stagingPath || m.key === t.mod.key || m.stagingPath === t.mod.stagingPath) continue
      for (const f of await walk(m.stagingPath, 20_000)) {
        if (mine.has(f.rel.toLowerCase())) clashes.push(`${f.rel} is also in "${m.name}"`)
      }
    }
    out.push({
      id: 'overlap',
      label: "Fix doesn't overwrite other mods' files",
      status: clashes.length ? 'warn' : 'pass',
      details: clashes.length ? clashes.slice(0, 20) : []
    })
    return out
  }

  private async findDependents(t: TriageResult): Promise<string[]> {
    const names = identifyingNames(t)
    if (!names.length) return []
    const low = names.map((n) => n.toLowerCase())
    const found: string[] = []
    for (const m of await this.d.installedMods()) {
      if (!m.stagingPath || m.stagingPath === t.mod.stagingPath) continue
      for (const f of await walk(m.stagingPath, 5000)) {
        if (!TEXT_EXT.test(f.rel) || f.size > 1_000_000) continue
        const text = (await fs.readFile(f.abs, 'utf8').catch(() => '')).toLowerCase()
        const hit = low.findIndex((n) => text.includes(n) || text.includes(n.replace(/\.archive$/, '')))
        if (hit >= 0) found.push(`"${m.name}" mentions ${names[hit]} in ${f.rel}`)
        if (found.length > 50) return found
      }
    }
    return found
  }
}

function summarizeChecks(results: CheckResult[]): string {
  if (!results.length) return 'Nothing to check'
  const by = (s: CheckResult['status']): number => results.filter((r) => r.status === s).length
  return [`${by('pass')} passed`, by('warn') ? `${by('warn')} warnings` : '', by('fail') ? `${by('fail')} failed` : '', by('skipped') ? `${by('skipped')} skipped` : '']
    .filter(Boolean)
    .join(', ')
}
