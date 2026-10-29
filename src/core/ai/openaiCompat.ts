import path from 'node:path'
import type { AiSettings } from '../../shared/types'
import { readJson, writeJson } from '../util'
import type { AgentEvent, AgentResult, AgentTask, AiBackend, AskOptions } from './types'
import { describeToolCall, runTool, Sandbox, WORKSPACE_TOOLS } from './workspaceTools'

interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[]
  error?: { message?: string }
}

const FINISH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'finish',
    description: 'Call when the task for this round is done. Give a short summary of what you changed.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
  }
}

const TOOLS = [
  ...WORKSPACE_TOOLS.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.jsonSchema } })),
  FINISH_TOOL
]

/** Some local models write tool calls as JSON text instead of using the tool-calling API. */
export function parseTextToolCall(content: string): { name: string; args: unknown } | null {
  const fenced = content.match(/```(?:json|tool)?\s*(\{[\s\S]*?\})\s*```/)
  const raw = fenced?.[1] ?? content.match(/\{\s*"(?:tool|name)"[\s\S]*\}/)?.[0]
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as { tool?: string; name?: string; arguments?: unknown; args?: unknown; parameters?: unknown }
    const name = j.tool ?? j.name
    if (!name || ![...WORKSPACE_TOOLS.map((t) => t.name), 'finish'].includes(name)) return null
    const args = j.arguments ?? j.args ?? j.parameters ?? {}
    return { name, args: typeof args === 'string' ? JSON.parse(args) : args }
  } catch {
    return null
  }
}

/**
 * Keeps a local model's context small: the first two messages stay, older tool output is shortened,
 * and the oldest exchanges are dropped when the history passes `budget` characters.
 */
export function trimHistory(messages: ChatMessage[], budget: number): ChatMessage[] {
  const size = (ms: ChatMessage[]): number => ms.reduce((n, m) => n + (m.content?.length ?? 0) + JSON.stringify(m.tool_calls ?? '').length, 0)
  const out = messages.map((m) => ({ ...m }))
  for (let i = 2; i < out.length - 6 && size(out) > budget; i++) {
    if (out[i].role === 'tool' && (out[i].content?.length ?? 0) > 400) out[i].content = `${out[i].content!.slice(0, 300)}\n… (older output trimmed)`
  }
  while (size(out) > budget && out.length > 8) {
    // Drop the oldest assistant turn together with its tool results so calls and results stay paired.
    let end = 3
    while (end < out.length && out[end].role === 'tool') end++
    out.splice(2, end - 2)
  }
  return out
}

/** Any server with the OpenAI chat completions API: LM Studio, Ollama, llama.cpp, vLLM, ... */
export class OpenAiCompatBackend implements AiBackend {
  kind = 'openai-compatible' as const
  label = 'Local LLM (OpenAI-compatible)'
  canBrowse = false

  constructor(
    private s: AiSettings,
    private fetchImpl: typeof fetch = fetch
  ) {}

  private url(p: string): string {
    return `${this.s.baseUrl.replace(/\/+$/, '')}${p}`
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.s.localApiKey ? { authorization: `Bearer ${this.s.localApiKey}` } : {}) }
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetchImpl(this.url('/models'), { headers: this.headers(), signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`The server at ${this.s.baseUrl} returned HTTP ${res.status}`)
    const j = (await res.json()) as { data?: { id: string }[] }
    return (j.data ?? []).map((m) => m.id)
  }

  async test(): Promise<{ ok: boolean; detail: string }> {
    try {
      const models = await this.listModels()
      if (!models.length) return { ok: false, detail: 'The server is up but has no model loaded. Load one in LM Studio first.' }
      const model = this.s.localModel || models[0]
      return { ok: true, detail: `Connected. Using ${model}${models.length > 1 ? ` (${models.length} models available)` : ''}.` }
    } catch (e) {
      return { ok: false, detail: `Can't reach ${this.s.baseUrl}: ${e instanceof Error ? e.message : String(e)}. Start the local server in LM Studio (Developer tab).` }
    }
  }

  private async model(): Promise<string> {
    if (this.s.localModel) return this.s.localModel
    const models = await this.listModels()
    if (!models[0]) throw new Error('No model loaded on the local server.')
    return models[0]
  }

  private async chat(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatMessage> {
    const res = await this.fetchImpl(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal
    })
    const j = (await res.json().catch(() => ({}))) as ChatResponse
    if (!res.ok) throw new Error(j.error?.message ?? `Local server returned HTTP ${res.status}`)
    const msg = j.choices?.[0]?.message
    if (!msg) throw new Error('The local server returned no message.')
    return msg
  }

  async ask(prompt: string, opts: AskOptions = {}): Promise<string> {
    const messages: ChatMessage[] = []
    if (opts.system) messages.push({ role: 'system', content: opts.system })
    messages.push({ role: 'user', content: prompt })
    const msg = await this.chat({ model: await this.model(), messages, temperature: 0.2, max_tokens: opts.maxTokens ?? 4000 })
    return msg.content ?? ''
  }

  async runAgent(task: AgentTask, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<AgentResult> {
    const sb = new Sandbox(task.cwd, task.writable)
    const historyFile = path.join(task.cwd, '.ai', 'local-history.json')
    let messages: ChatMessage[] = task.resume ? await readJson<ChatMessage[]>(historyFile, []) : []
    if (!messages.length) messages.push({ role: 'system', content: `${task.system}\n\nUse the provided tools to read and write files. Call finish when done.` })
    messages.push({ role: 'user', content: task.prompt })
    let useTools = true
    let finalText = ''
    let model: string
    try {
      model = await this.model()
    } catch (e) {
      return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) }
    }

    for (let turn = 0; turn < task.maxTurns; turn++) {
      if (signal.aborted) return { ok: false, text: finalText, error: 'Cancelled' }
      messages = trimHistory(messages, 90_000)
      let msg: ChatMessage
      try {
        msg = await this.chat(
          useTools
            ? { model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 }
            : { model, messages, temperature: 0.2 },
          signal
        )
      } catch (e) {
        if (useTools && /tool/i.test(String(e))) {
          // The model or server doesn't do tool calling; switch to tool calls written as JSON text.
          useTools = false
          messages[0].content += `\n\nTo use a tool, reply with only a JSON object like {"tool": "read_file", "arguments": {"path": "TASK.md"}}. Tools: ${TOOLS.map((t) => t.function.name).join(', ')}.`
          onEvent({ kind: 'status', text: 'This model has no tool calling; using JSON text instead.' })
          continue
        }
        await writeJson(historyFile, messages)
        return { ok: false, text: finalText, error: e instanceof Error ? e.message : String(e) }
      }

      let calls: { id: string; name: string; args: unknown }[] = []
      if (msg.tool_calls?.length) {
        calls = msg.tool_calls.map((c) => {
          let args: unknown = {}
          try {
            args = JSON.parse(c.function.arguments || '{}')
          } catch {
            args = { __invalid: c.function.arguments }
          }
          return { id: c.id, name: c.function.name, args }
        })
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
      } else {
        const text = msg.content ?? ''
        const parsed = parseTextToolCall(text)
        messages.push({ role: 'assistant', content: text })
        if (!parsed) {
          finalText = text
          if (text.trim()) onEvent({ kind: 'text', text })
          await writeJson(historyFile, messages)
          return { ok: true, text: finalText }
        }
        calls = [{ id: `text-${turn}`, name: parsed.name, args: parsed.args }]
      }
      if (msg.content?.trim() && msg.tool_calls?.length) onEvent({ kind: 'text', text: msg.content })

      for (const call of calls) {
        if (call.name === 'finish') {
          finalText = String((call.args as { summary?: string }).summary ?? '')
          onEvent({ kind: 'text', text: finalText })
          messages.push(toolReply(call.id, 'OK', msg.tool_calls?.length ? 'tool' : 'user'))
          await writeJson(historyFile, messages)
          return { ok: true, text: finalText }
        }
        onEvent({ kind: 'tool', text: describeToolCall(call.name, call.args) })
        const r = await runTool(sb, call.name, call.args)
        if (!r.ok) onEvent({ kind: 'error', text: `${call.name}: ${r.output}` })
        messages.push(toolReply(call.id, r.output, msg.tool_calls?.length ? 'tool' : 'user'))
      }
      await writeJson(historyFile, messages)
    }
    return { ok: false, text: finalText, error: `Stopped after ${task.maxTurns} turns.` }
  }
}

function toolReply(id: string, content: string, role: 'tool' | 'user'): ChatMessage {
  return role === 'tool' ? { role: 'tool', tool_call_id: id, content } : { role: 'user', content: `Tool result:\n${content}` }
}
