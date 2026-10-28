import path from 'node:path'
import os from 'node:os'
import type { AppEvent, Settings } from '../shared/types'
import { DEFAULT_TOOL_COMMANDS } from './games/cyberpunk2077/tools'

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

/** What every engine module gets: settings, where to keep data, and a way to tell the UI things. */
export interface CoreContext {
  dataDir: string
  settings: Settings
  emit(e: AppEvent): void
  log: Logger
  fetch: typeof fetch
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  appVersion: string
}

export function defaultSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const home = env.USERPROFILE || env.HOME || os.homedir()
  return {
    gameId: 'cyberpunk2077',
    backupsPath: path.join(home, 'Documents', 'Patchwright', 'backups'),
    workspacePath: path.join(home, 'Documents', 'Patchwright', 'jobs'),
    ai: {
      backend: 'claude-cli',
      claudeModel: 'claude-opus-5-5',
      baseUrl: 'http://localhost:1234/v1',
      maxRounds: 4,
      maxTurns: 60
    },
    toolCommands: { ...DEFAULT_TOOL_COMMANDS },
    communityChecks: true,
    communityViaAi: false,
    fixNameTemplate: '{name} - {patch} fix (Patchwright)',
    vortexAutomation: false,
    testProfileName: 'Patchwright {patch} test',
    onboarded: false
  }
}

export function consoleLogger(prefix = 'patchwright'): Logger {
  return {
    info: (m) => console.log(`[${prefix}] ${m}`),
    warn: (m) => console.warn(`[${prefix}] ${m}`),
    error: (m) => console.error(`[${prefix}] ${m}`)
  }
}

export function fixName(settings: Settings, modName: string, patch: string): string {
  return settings.fixNameTemplate.replace('{name}', modName).replace('{patch}', patch)
}
