import { createContext, useContext } from 'react'
import type { PatchwrightApi } from '../../shared/api'
import type { CollectionInfo, GameStatus, JobState, Settings, TriageResult } from '../../shared/types'

export type Page = 'overview' | 'mods' | 'fixes' | 'test' | 'knowledge' | 'history' | 'settings'

export interface Store {
  api: PatchwrightApi
  demo: boolean
  settings: Settings | null
  setSettings: (s: Settings) => void
  game: GameStatus | null
  refreshGame: (refresh?: boolean) => Promise<void>
  /** Latest triage result for each mod, newest check first. */
  results: TriageResult[]
  setResults: (r: TriageResult[]) => void
  collection: CollectionInfo | null
  /** Set while a collection is shown: the keys of its mods, so the table lists only those. */
  scope: string[] | null
  setCollection: (c: CollectionInfo | null, keys?: string[]) => void
  progress: { done: number; total: number; current?: string } | null
  jobs: JobState[]
  page: Page
  /** Page argument: a job id for Fixes, an input to check for Mods. */
  pageArg?: string
  go: (page: Page, arg?: string) => void
  toast: (text: string, level?: 'info' | 'ok' | 'error') => void
}

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreContext')
  return s
}

/** localStorage that never throws: storage can be unavailable, and the page must work without it. */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore
    }
  }
}
