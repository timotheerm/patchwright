import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CollectionInfo, GameStatus, JobState, Settings, TriageResult } from '../../shared/types'
import { api, demo } from './api'
import { isRunning } from './labels'
import { FixesPage } from './pages/Fixes'
import { HistoryPage } from './pages/History'
import { ModsPage } from './pages/Mods'
import { OverviewPage } from './pages/Overview'
import { SettingsPage } from './pages/Settings'
import { TestPage } from './pages/Test'
import { StoreContext, type Page, type Store } from './store'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '◎' },
  { id: 'mods', label: 'Mods', icon: '▦' },
  { id: 'fixes', label: 'Fixes', icon: '✦' },
  { id: 'test', label: 'Test', icon: '▶' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

interface Toast {
  id: number
  text: string
  level: 'info' | 'ok' | 'error'
}

let toastId = 0

export function App() {
  const [page, setPage] = useState<Page>('overview')
  const [pageArg, setPageArg] = useState<string | undefined>()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [game, setGame] = useState<GameStatus | null>(null)
  const [results, setResults] = useState<TriageResult[]>([])
  const [collection, setCollectionState] = useState<CollectionInfo | null>(null)
  const [scope, setScope] = useState<string[] | null>(null)
  const [progress, setProgress] = useState<Store['progress']>(null)
  const [jobs, setJobs] = useState<JobState[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string, level: Toast['level'] = 'info') => {
    const id = ++toastId
    setToasts((t) => [...t, { id, text, level }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'error' ? 9000 : 5000)
  }, [])

  const refreshGame = useCallback(async (refresh = false) => {
    setGame(await api.getGameStatus(refresh))
  }, [])

  useEffect(() => {
    void api.getSettings().then((s) => {
      setSettings(s)
      if (!s.onboarded) setPage('settings')
    })
    void refreshGame().catch((e) => toast(String(e), 'error'))
    void api.listJobs().then(setJobs)
    return api.onEvent((e) => {
      switch (e.type) {
        case 'job':
          setJobs((js) => {
            const i = js.findIndex((j) => j.id === e.job.id)
            if (i < 0) return [e.job, ...js]
            const next = js.slice()
            next[i] = e.job
            return next
          })
          break
        case 'triage-progress':
          setProgress(e.done >= e.total ? null : e)
          break
        case 'triage-result':
          setResults((rs) => [e.result, ...rs.filter((r) => r.mod.key !== e.result.mod.key)])
          break
        case 'notice':
          toast(e.text, e.level === 'warn' ? 'info' : e.level)
          break
      }
    })
  }, [refreshGame, toast])

  const setCollection = useCallback((c: CollectionInfo | null, keys?: string[]) => {
    setCollectionState(c)
    setScope(c && keys ? keys : null)
  }, [])

  const go = useCallback((p: Page, arg?: string) => {
    setPage(p)
    setPageArg(arg)
  }, [])

  const store: Store = useMemo(
    () => ({
      api,
      demo,
      settings,
      setSettings,
      game,
      refreshGame,
      results,
      setResults,
      collection,
      scope,
      setCollection,
      progress,
      jobs,
      page,
      pageArg,
      go,
      toast
    }),
    [settings, game, refreshGame, results, collection, scope, setCollection, progress, jobs, page, pageArg, go, toast]
  )

  const counts: Partial<Record<Page, number>> = {
    mods: results.filter((r) => r.action === 'ai-fix').length || undefined,
    fixes: jobs.filter((j) => isRunning(j.status) || j.status === 'ready').length || undefined
  }

  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <div className="brand-name">Patchwright</div>
              <div className="brand-sub">mod updater</div>
            </div>
          </div>
          {NAV.map((n) => (
            <div key={n.id} className={`nav-item${page === n.id ? ' active' : ''}`} onClick={() => go(n.id)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
              {counts[n.id] !== undefined && <span className="nav-count">{counts[n.id]}</span>}
            </div>
          ))}
          <div className="sidebar-foot">
            <div>{game?.name ?? 'Cyberpunk 2077'}</div>
            <div>
              Patch <b style={{ color: 'var(--accent)' }}>{game?.baselinePatch?.version ?? '…'}</b>
              {game?.installedVersion && <span> · you have {game.installedVersion}</span>}
            </div>
            <div>AI: {backendName(settings)}</div>
          </div>
        </aside>
        <main className="main">
          {demo && <div className="demo-banner">Demo mode: this is sample data in a browser, not your PC. Run the desktop app to use your own mods.</div>}
          {page === 'overview' && <OverviewPage />}
          {page === 'mods' && <ModsPage />}
          {page === 'fixes' && <FixesPage />}
          {page === 'test' && <TestPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </StoreContext.Provider>
  )
}

function backendName(s: Settings | null): string {
  if (!s) return '…'
  switch (s.ai.backend) {
    case 'claude-cli':
      return 'Claude Code'
    case 'claude-api':
      return 'Claude API'
    case 'openai-compatible':
      return s.ai.localModel ? `local (${s.ai.localModel})` : 'local model'
  }
}
