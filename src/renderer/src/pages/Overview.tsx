import { useEffect, useState } from 'react'
import type { FrameworkStatus, Settings, VortexStatus } from '../../../shared/types'
import { ActionButton, Badge, Dot, fmtDate } from '../components'
import { FRAMEWORK_STATE, groupOf } from '../labels'
import { useStore } from '../store'

export function OverviewPage() {
  const { api, game, refreshGame, settings, results, jobs, go, toast } = useStore()
  const [frameworks, setFrameworks] = useState<FrameworkStatus[] | null>(null)
  const [vortex, setVortex] = useState<VortexStatus | null>(null)
  const [input, setInput] = useState('')

  useEffect(() => {
    void api.getFrameworks().then(setFrameworks).catch(() => setFrameworks([]))
    void api.vortexStatus().then(setVortex)
  }, [api])

  const patch = game?.baselinePatch
  const daysSince = patch ? Math.max(0, Math.round((Date.now() - Date.parse(patch.releaseDate)) / 86_400_000)) : undefined
  const groups = results.reduce<Record<string, number>>((acc, r) => ((acc[groupOf(r)] = (acc[groupOf(r)] ?? 0) + 1), acc), {})
  const setup = settings ? setupItems(settings, vortex) : []
  const missing = setup.filter((s) => !s.ok && !s.optional)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Find out which mods the latest patch broke, fix them in a test profile, and keep what works.</p>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card hero span-2">
          <div className="row" style={{ alignItems: 'flex-start', gap: 28 }}>
            <div>
              <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Latest patch
              </div>
              <div className="hero-version">{patch?.version ?? '…'}</div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {patch ? `Released ${fmtDate(patch.releaseDate)}${daysSince !== undefined ? `, ${daysSince} days ago` : ''}` : 'Looking up patches…'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <dl className="kv">
                <dt>Game</dt>
                <dd>{game?.name ?? '…'}</dd>
                <dt>Your version</dt>
                <dd>
                  {game?.installedVersion ?? 'not found'}{' '}
                  {game?.upToDate === true && <Badge tone="green">up to date</Badge>}
                  {game?.upToDate === false && <Badge tone="amber">update the game first</Badge>}
                </dd>
                {game?.latestBuild && game.latestBuild.version !== patch?.version && (
                  <>
                    <dt>Latest hotfix</dt>
                    <dd>
                      {game.latestBuild.version} ({fmtDate(game.latestBuild.releaseDate)})
                    </dd>
                  </>
                )}
                <dt>Patch info from</dt>
                <dd className="muted">{patch?.source === 'steam' ? 'Steam news' : patch?.source === 'manual' ? 'your setting' : 'built-in list'}</dd>
              </dl>
              {game?.warnings.map((w) => (
                <div key={w} className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}>
                  {w}
                </div>
              ))}
            </div>
          </div>
          <hr className="sep" />
          <div className="row">
            <input
              className="input big"
              placeholder="Paste a Nexus mod or collection link, a mod id, or a mod folder"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && input.trim() && go('mods', input.trim())}
            />
            <button className="btn primary" style={{ height: 42 }} disabled={!input.trim()} onClick={() => go('mods', input.trim())}>
              Check
            </button>
            <button className="btn" style={{ height: 42 }} onClick={() => go('mods', '*installed')}>
              Check all my mods
            </button>
          </div>
        </div>

        <div className="card">
          <h2>
            Setup
            <span className="right">{missing.length ? <Badge tone="amber">{missing.length} to do</Badge> : <Badge tone="green">ready</Badge>}</span>
          </h2>
          <div className="setup-list">
            {setup.map((s) => (
              <div className="setup-item" key={s.label}>
                <Dot tone={s.ok ? 'green' : s.optional ? 'gray' : 'amber'} />
                <span className="what">
                  {s.label}
                  {s.optional && !s.ok && <span className="faint"> (optional)</span>}
                </span>
                {!s.ok && (
                  <a className="small" onClick={() => go('settings')}>
                    Set up
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="Need a fix" value={groups.fix} tone="var(--red)" onClick={() => go('mods')} />
        <Stat label="Update or test" value={(groups.update ?? 0) + (groups.test ?? 0) || undefined} tone="var(--cyan)" onClick={() => go('mods')} />
        <Stat
          label="Fixes ready to test"
          value={jobs.filter((j) => j.status === 'ready').length || undefined}
          tone="var(--accent)"
          onClick={() => go('fixes')}
          empty={jobs.length ? 'none waiting' : 'no fixes yet'}
        />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>
            Frameworks
            <span className="right faint small">Most mods need these. Update them before anything else.</span>
          </h2>
          {!frameworks ? (
            <div className="muted">Checking…</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Framework</th>
                  <th>Yours</th>
                  <th>Latest</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {frameworks.map((f) => {
                  const st = FRAMEWORK_STATE[f.state]
                  return (
                    <tr key={f.id} className="clickable" onClick={() => void api.openExternal(`https://www.nexusmods.com/cyberpunk2077/mods/${f.nexusModId}`)}>
                      <td>{f.name}</td>
                      <td className="mono">{f.installedVersion ?? '—'}</td>
                      <td>
                        <span className="mono">{f.latestVersion ?? f.minVersionForPatch ?? '—'}</span>
                        {f.latestDate && <div className="sub">{fmtDate(f.latestDate)}</div>}
                      </td>
                      <td>
                        <Badge tone={st.tone} title={f.note}>
                          {st.label}
                        </Badge>
                        {f.note && <div className="sub">{f.note}</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>Vortex</h2>
            {!vortex ? (
              <div className="muted">Looking for Vortex…</div>
            ) : (
              <>
                <dl className="kv" style={{ marginBottom: 14 }}>
                  <dt>Status</dt>
                  <dd>
                    {vortex.found ? (vortex.running ? <Badge tone="amber">running</Badge> : <Badge tone="green">found, closed</Badge>) : <Badge tone="red">not found</Badge>}
                  </dd>
                  <dt>Active profile</dt>
                  <dd>{vortex.activeProfile?.name ?? '—'}</dd>
                  <dt>Profiles</dt>
                  <dd>{vortex.profiles.map((p) => p.name).join(', ') || '—'}</dd>
                  <dt>Mods</dt>
                  <dd>{vortex.modCount}</dd>
                  <dt>Staging folder</dt>
                  <dd className="mono">{vortex.stagingPath ?? '—'}</dd>
                </dl>
                {vortex.notes.map((n) => (
                  <div key={n} className="notice warn">
                    {n}
                  </div>
                ))}
                <div className="row">
                  <ActionButton
                    onClick={async () => {
                      const r = await api.createTestProfile()
                      toast(r.message, r.ok ? 'ok' : 'error')
                      setVortex(await api.vortexStatus())
                    }}
                    title="Copies your active profile, so fixes are tested without touching your main setup."
                  >
                    Create test profile
                  </ActionButton>
                  <button className="btn ghost" onClick={() => void api.vortexStatus().then(setVortex)}>
                    Refresh
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h2>How it works</h2>
            <ol className="reasons">
              <li>Check your mods against the patch: release dates, Nexus posts, and a look inside each mod.</li>
              <li>Update what the authors already fixed. Leave native plugins to their authors.</li>
              <li>For the rest, the AI builds a fix as a separate mod. Your original mods are never changed.</li>
              <li>Test the fixes in a copy of your Vortex profile, with your saves backed up.</li>
              <li>Keep what works. Anything Patchwright did can be undone from History.</li>
            </ol>
            <div className="row" style={{ marginTop: 12 }}>
              <ActionButton className="ghost sm" onClick={() => refreshGame(true)}>
                Look for a new patch
              </ActionButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, onClick, empty = 'none' }: { label: string; value?: number; tone: string; onClick: () => void; empty?: string }) {
  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={onClick}>
      <div className="faint small" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 750, color: value ? tone : 'var(--faint)', lineHeight: 1.3 }}>{value ?? '0'}</div>
      {!value && <div className="faint small">{empty}</div>}
    </div>
  )
}

function setupItems(s: Settings, v: VortexStatus | null): { label: string; ok: boolean; optional?: boolean }[] {
  const ai =
    s.ai.backend === 'claude-api' ? !!s.ai.anthropicApiKey : s.ai.backend === 'openai-compatible' ? !!(s.ai.baseUrl && s.ai.localModel) : true
  return [
    { label: 'Game folder', ok: !!s.gamePath },
    { label: 'Vortex and its staging folder', ok: !!(s.vortexStagingPath && (v?.found ?? true)) },
    { label: 'Nexus API key', ok: !!s.nexusApiKey },
    { label: 'AI connection', ok: ai },
    { label: 'WolvenKit command line', ok: !!s.wolvenkitCli },
    { label: 'redscript compiler', ok: !!s.redscriptCli, optional: true },
    { label: 'Backups folder', ok: !!s.backupsPath }
  ]
}
