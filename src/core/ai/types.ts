import type { AiBackendKind } from '../../shared/types'

export interface AgentTask {
  /** The job folder. The agent can read anything inside it. */
  cwd: string
  /** The user turn for this round. */
  prompt: string
  /** Standing instructions (playbook, rules). Kept identical across rounds so it can be cached. */
  system: string
  /** cwd-relative files or folders (ending in "/") the agent may write. */
  writable: string[]
  /** Continue the conversation from the previous round. */
  resume: boolean
  maxTurns: number
  /** Let the agent fetch pages from these domains (Claude Code backend only). */
  webDomains?: string[]
}

export interface AgentEvent {
  kind: 'text' | 'tool' | 'status' | 'error'
  text: string
}

export interface AgentResult {
  ok: boolean
  text: string
  costUsd?: number
  sessionId?: string
  error?: string
}

export interface AskOptions {
  system?: string
  /** Allow fetching pages from these domains, for backends that can browse. */
  webDomains?: string[]
  maxTokens?: number
}

export interface AiBackend {
  kind: AiBackendKind
  label: string
  canBrowse: boolean
  test(): Promise<{ ok: boolean; detail: string }>
  runAgent(task: AgentTask, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<AgentResult>
  ask(prompt: string, opts?: AskOptions): Promise<string>
}
