import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { AiSettings } from '../../shared/types'
import { ensureDir, exists, readJson, run, writeJson } from '../util'
import type { AgentEvent, AgentResult, AgentTask, AiBackend, AskOptions } from './types'
import { describeToolCall } from './workspaceTools'

/** Finds the user's Claude Code install. */
export async function findClaudeCli(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | undefined> {
  const home = env.USERPROFILE ?? env.HOME ?? ''
  const candidates =
    platform === 'win32'
      ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(env.APPDATA ?? '', 'npm', 'claude.cmd')]
      : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']
  for (const c of candidates) if (await exists(c)) return c
  const res = await run(platform === 'win32' ? 'where' : 'which', ['claude'], { timeoutMs: 5000 })
  const first = res.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return first && (await exists(first)) ? first : undefined
}

interface StreamLine {
  type?: string
  subtype?: string
  session_id?: string
  result?: string
  is_error?: boolean
  total_cost_usd?: number
  message?: { content?: { type: string; text?: string; name?: string; input?: unknown }[] }
}

/** Builds the --allowedTools rules that limit edits to the writable paths of the job. */
export function permissionRules(task: AgentTask): string[] {
  const rules = ['Read', 'Glob', 'Grep']
  for (const w of task.writable) rules.push(w.endsWith('/') ? `Edit(./${w}**)` : `Edit(./${w})`)
  for (const d of task.webDomains ?? []) rules.push(`WebFetch(domain:${d})`)
  return rules
}

/**
 * Runs the Claude Code CLI the user installed and signed in to, in headless mode. Patchwright never
 * handles the sign-in; the CLI uses whatever account or API key the user set up in it.
 */
export class ClaudeCliBackend implements AiBackend {
  kind = 'claude-cli' as const
  label = 'Claude Code (installed on this PC)'
  canBrowse = true

  constructor(
    private s: AiSettings,
    private platform: NodeJS.Platform = process.platform
  ) {}

  private get exe(): string | undefined {
    return this.s.claudeCliPath
  }

  private spawnArgs(args: string[]): { cmd: string; args: string[]; shell: boolean } {
    const exe = this.exe!
    // npm installs a .cmd shim, which Windows can only start through a shell.
    if (/\.(cmd|bat)$/i.test(exe)) return { cmd: `"${exe}"`, args: args.map((a) => `"${a.replace(/"/g, '\\"')}"`), shell: true }
    return { cmd: exe, args, shell: false }
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    if (!this.exe || !(await exists(this.exe))) return { ok: false, detail: 'Claude Code was not found. Install it, sign in once in a terminal, then set its path in Settings.' }
    const v = this.spawnArgs(['--version'])
    const res = await run(v.cmd, v.args, { timeoutMs: 30_000, shell: v.shell })
    if (res.code !== 0) return { ok: false, detail: (res.stderr || res.stdout).trim().slice(0, 300) }
    try {
      const reply = await this.ask('Reply with the single word OK.')
      return { ok: true, detail: `Claude Code ${res.stdout.trim()} replied: ${reply.trim().slice(0, 40)}` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  async ask(prompt: string, opts: AskOptions = {}): Promise<string> {
    if (!this.exe) throw new Error('Claude Code path is not set.')
    const allowed = (opts.webDomains ?? []).map((d) => `WebFetch(domain:${d})`)
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'dontAsk', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,Task']
    if (allowed.length) args.push('--allowedTools', allowed.join(','))
    if (this.s.claudeModel) args.push('--model', this.s.claudeModel)
    if (opts.system) args.push('--append-system-prompt', opts.system)
    const c = this.spawnArgs(args)
    const res = await run(c.cmd, c.args, { timeoutMs: 10 * 60_000, shell: c.shell })
    try {
      const j = JSON.parse(res.stdout) as StreamLine
      if (j.is_error) throw new Error(j.result ?? 'Claude Code reported an error')
      return j.result ?? ''
    } catch (e) {
      if (res.code !== 0) throw new Error((res.stderr || res.stdout).trim().slice(0, 500) || `Claude Code exited with ${res.code}`)
      throw e
    }
  }

  async runAgent(task: AgentTask, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<AgentResult> {
    if (!this.exe) return { ok: false, text: '', error: 'Claude Code path is not set.' }
    const stateFile = path.join(task.cwd, '.ai', 'claude-cli.json')
    const state = await readJson<{ sessionId?: string; cost?: number }>(stateFile, {})
    const sysFile = path.join(task.cwd, '.ai', 'system.md')
    await ensureDir(path.dirname(sysFile))
    await fs.writeFile(sysFile, task.system, 'utf8')

    const disallowed = ['Bash', 'NotebookEdit', 'Task', 'WebSearch']
    if (!task.webDomains?.length) disallowed.push('WebFetch')
    const args = [
      '-p',
      task.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--allowedTools',
      permissionRules(task).join(','),
      '--disallowedTools',
      disallowed.join(','),
      '--append-system-prompt-file',
      sysFile,
      '--max-turns',
      String(task.maxTurns)
    ]
    if (this.s.claudeModel) args.push('--model', this.s.claudeModel)
    if (task.resume && state.sessionId) args.push('--resume', state.sessionId)
    if (this.s.maxBudgetUsd) args.push('--max-budget-usd', String(this.s.maxBudgetUsd))

    let sessionId = state.sessionId
    let finalText = ''
    let cost: number | undefined
    let isError = false
    const c = this.spawnArgs(args)
    const res = await run(c.cmd, c.args, {
      cwd: task.cwd,
      shell: c.shell,
      signal,
      timeoutMs: 2 * 60 * 60_000,
      onLine: (line, stream) => {
        if (stream === 'stderr') {
          if (line.trim()) onEvent({ kind: 'status', text: line.trim().slice(0, 300) })
          return
        }
        let j: StreamLine
        try {
          j = JSON.parse(line)
        } catch {
          return
        }
        if (j.session_id) sessionId = j.session_id
        if (j.type === 'assistant') {
          for (const b of j.message?.content ?? []) {
            if (b.type === 'text' && b.text?.trim()) {
              finalText = b.text
              onEvent({ kind: 'text', text: b.text })
            } else if (b.type === 'tool_use') onEvent({ kind: 'tool', text: describeToolCall(b.name ?? '?', b.input) })
          }
        } else if (j.type === 'system' && j.subtype === 'permission_denied') {
          onEvent({ kind: 'error', text: 'A tool call was denied (outside the allowed folders).' })
        } else if (j.type === 'result') {
          if (j.result) finalText = j.result
          cost = j.total_cost_usd
          isError = !!j.is_error || (j.subtype !== undefined && j.subtype !== 'success')
        }
      }
    })
    await writeJson(stateFile, { sessionId, cost })
    if (signal.aborted) return { ok: false, text: finalText, sessionId, costUsd: cost, error: 'Cancelled' }
    if (res.code !== 0 || isError) {
      return { ok: false, text: finalText, sessionId, costUsd: cost, error: finalText || res.stderr.trim().slice(0, 500) || `Claude Code exited with ${res.code}` }
    }
    return { ok: true, text: finalText, sessionId, costUsd: cost }
  }
}
