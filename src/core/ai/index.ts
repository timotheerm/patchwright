import type { AiSettings } from '../../shared/types'
import { ClaudeApiBackend } from './claudeApi'
import { ClaudeCliBackend } from './claudeCli'
import { OpenAiCompatBackend } from './openaiCompat'
import type { AiBackend } from './types'

export function createBackend(s: AiSettings, fetchImpl: typeof fetch = fetch): AiBackend {
  switch (s.backend) {
    case 'claude-api':
      return new ClaudeApiBackend(s)
    case 'openai-compatible':
      return new OpenAiCompatBackend(s, fetchImpl)
    case 'claude-cli':
    default:
      return new ClaudeCliBackend(s)
  }
}

export type { AiBackend } from './types'
