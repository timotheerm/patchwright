import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { AiSettings } from '../../shared/types'
import { readJson, writeJson } from '../util'
import type { AgentEvent, AgentResult, AgentTask, AiBackend, AskOptions } from './types'
import { describeToolCall, runTool, Sandbox, WORKSPACE_TOOLS } from './workspaceTools'

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam
type BetaTool = Anthropic.Beta.Messages.BetaTool

// Server-side refusal fallback: a declined request is re-run on Anthropic's recommended model.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Rough cost per million tokens, used only to stop a job at the user's budget. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }
}

function costOf(model: string, u: Anthropic.Beta.Messages.BetaUsage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  )
}

/**
 * After a mid-output fallback, blocks before the last fallback marker other than text must not be
 * sent back. Everything else is echoed unchanged, which keeps the history append-only.
 */
export function echoableContent(content: BetaContentBlock[]): BetaContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback')
  if (lastFallback < 0) return content
  return content.filter((b, i) => i > lastFallback || b.type === 'text')
}

const TOOLS: BetaTool[] = WORKSPACE_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.jsonSchema as BetaTool['input_schema'],
  eager_input_streaming: true
}))

/** Calls the Claude API directly with an API key and runs the file tools itself. */
export class ClaudeApiBackend implements AiBackend {
  kind = 'claude-api' as const
  label = 'Claude (API key)'
  canBrowse = false
  private client: Anthropic | undefined

  constructor(private s: AiSettings) {
    if (s.anthropicApiKey) this.client = new Anthropic({ apiKey: s.anthropicApiKey, maxRetries: 3 })
  }

  private get model(): string {
    return this.s.claudeModel || 'claude-opus-5-5'
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    if (!this.client) return { ok: false, detail: 'Add an Anthropic API key from console.anthropic.com in Settings.' }
    try {
      const text = await this.ask('Reply with the single word OK.', { maxTokens: 2000 })
      return { ok: true, detail: `${this.model} replied: ${text.trim().slice(0, 40)}` }
    } catch (e) {
      return { ok: false, detail: errorText(e) }
    }
  }

  async ask(prompt: string, opts: AskOptions = {}): Promise<string> {
    if (!this.client) throw new Error('No Anthropic API key set.')
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }]
    })
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    return msg.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }

  async runAgent(task: AgentTask, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<AgentResult> {
    if (!this.client) return { ok: false, text: '', error: 'No Anthropic API key set.' }
    const sb = new Sandbox(task.cwd, task.writable)
    const historyFile = path.join(task.cwd, '.ai', 'claude-history.json')
    const saved = task.resume ? await readJson<{ messages: BetaMessageParam[]; cost: number }>(historyFile, { messages: [], cost: 0 }) : { messages: [], cost: 0 }
    const messages: BetaMessageParam[] = saved.messages
    messages.push({ role: 'user', content: task.prompt })
    let cost = saved.cost
    let finalText = ''
    let jsonRetries = 0
    const save = (): Promise<void> => writeJson(historyFile, { messages, cost })

    try {
      for (let turn = 0; turn < task.maxTurns; turn++) {
        if (signal.aborted) return { ok: false, text: finalText, costUsd: cost, error: 'Cancelled' }
        const stream = this.client.beta.messages.stream(
          {
            model: this.model,
            max_tokens: 64000,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'high' },
            // The system prompt and tools never change within a job, so they are cached.
            system: [{ type: 'text', text: task.system, cache_control: { type: 'ephemeral' } }],
            tools: TOOLS,
            cache_control: { type: 'ephemeral' },
            messages
          },
          { signal }
        )
        let message: Anthropic.Beta.Messages.BetaMessage
        try {
          message = await stream.finalMessage()
          jsonRetries = 0
        } catch (err) {
          if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err
          onEvent({ kind: 'status', text: 'A tool call came back malformed; asking again.' })
          continue
        }
        cost += costOf(this.model, message.usage)
        for (const b of message.content) {
          if (b.type === 'text' && b.text.trim()) {
            finalText = b.text
            onEvent({ kind: 'text', text: b.text })
          }
        }
        if (message.stop_reason === 'refusal') {
          await save()
          return { ok: false, text: finalText, costUsd: cost, error: 'Claude declined to continue this task.' }
        }
        if (message.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: echoableContent(message.content) })
          continue
        }
        const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use')
        messages.push({ role: 'assistant', content: echoableContent(message.content) })
        if (toolUses.length === 0) {
          await save()
          return { ok: true, text: finalText, costUsd: cost }
        }
        if (message.stop_reason === 'max_tokens') {
          await save()
          return { ok: false, text: finalText, costUsd: cost, error: 'A tool call was cut off at the output limit.' }
        }
        const results: BetaToolResultBlockParam[] = []
        for (const tu of toolUses) {
          onEvent({ kind: 'tool', text: describeToolCall(tu.name, tu.input) })
          const r = await runTool(sb, tu.name, tu.input)
          if (!r.ok) onEvent({ kind: 'error', text: `${tu.name}: ${r.output}` })
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.output, ...(r.ok ? {} : { is_error: true }) })
        }
        messages.push({ role: 'user', content: results })
        await save()
        if (this.s.maxBudgetUsd && cost >= this.s.maxBudgetUsd) {
          return { ok: false, text: finalText, costUsd: cost, error: `Stopped at the $${this.s.maxBudgetUsd} budget.` }
        }
      }
      await save()
      return { ok: false, text: finalText, costUsd: cost, error: `Stopped after ${task.maxTurns} turns.` }
    } catch (e) {
      await save().catch(() => {})
      return { ok: false, text: finalText, costUsd: cost, error: errorText(e) }
    }
  }
}

function errorText(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Try again in a minute.'
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}: ${e.message}`
  return e instanceof Error ? e.message : String(e)
}
