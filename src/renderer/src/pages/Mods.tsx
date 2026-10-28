import { useEffect, useRef, useState } from 'react'
import type { CommunityReport, ModRef, TriageResult } from '../../../shared/types'
import { ActionButton, Badge, Empty, Kinds, VerdictBadge, fmtDate } from '../components'
import { ACTION, FRAMEWORK_NAMES, GROUPS, groupOf, isRunning, type Group } from '../labels'
import { useStore } from '../store'

export function ModsPage() {
  const { api, results, setResults, collection, scope, setCollection, progress, pageArg, game, toast } = useStore()
  const [input, setInput] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [group, setGroup] = useState<Group>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const handledArg = useRef<string | undefined>(undefined)

  const check = async (mods: ModRef[]): Promise<void> => {
    if (!mods.length) return
    const out = await api.triage(mods)
    const keys = new Set(out.map((r) => r.mod.key))
    setResults([...out, ...results.filter((r) => !keys.has(r.mod.key))])
    if (out.length === 1) setSelected(out[0].mod.key)
  }

  const run = async (what: string): Promise<void> => {
    setBusy(true)
    setNotes([])
    try {
      if (what === '*installed') {
        setCollection(null)
        await check(await api.listInstalledMods())
      } else {
        const r = await api.resolveInput(what)
        setNotes(r.notes)
        if (r.collection) setCollection(r.collection, r.mods.map((m) => m.key))
        else if (r.mods.length) setCollection(null)
        await check(r.mods)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (pageArg && handledArg.current !== pageArg) {
      handledArg.current = pageArg
      if (pageArg !== '*installed') setInput(pageArg)
      void run(pageArg)
    }
  }, [pageArg])

  const inScope = scope ? results.filter((r) => scope.includes(r.mod.key)) : results
  const counts = inScope.reduce<Record<string, number>>((acc, r) => ((acc[groupOf(r)] = (acc[groupOf(r)] ?? 0) + 1), acc), { all: inScope.length })
  const q = query.trim().toLowerCase()
  const shown = inScope.filter((r) => (group === 'all' || groupOf(r) === group) && (!q || r.mod.name.toLowerCase().includes(q)))
  const sel = results.find((r) => r.mod.key === selected) ?? null
  const patch = game?.baselinePatch

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div>
          <h1>Mods</h1>
          <p>Check one mod, a whole Nexus collection, or everything installed in Vortex against patch {patch?.version ?? '…'}.</p>
        </div>
      </div>

      <div className="searchbar">
        <input
          className="input big"
          placeholder="Nexus mod or collection link, mod id, mod name, or a mod folder"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && input.trim() && void run(input.trim())}
        />
        <button className="btn primary" style={{ height: 42 }} disabled={busy || !input.trim()} onClick={() => void run(input.trim())}>
          Check
        </button>
        <button className="btn" style={{ height: 42 }} disabled={busy} onClick={() => void run('*installed')}>
          Check all installed mods
        </button>
      </div>

      {progress && (
        <>
          <div className="progress">
            <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <div className="faint small" style={{ marginTop: -6, marginBottom: 12 }}>
            Checking {progress.done + 1} of {progress.total}: {progress.current}
          </div>
        </>
      )}

      {collection && (
        <div className="notice">
          Collection <b>{collection.name ?? collection.slug}</b>
          {collection.revision !== undefined && <> (revision {collection.revision})</>}, {collection.modCount} mods.{' '}
          <span className="muted">Install it in a new Vortex profile so the original setup stays as it is.</span>{' '}
          <a onClick={() => setCollection(null)}>Show all checked mods</a>
        </div>
      )}
      {notes.map((n) => (
        <div key={n} className="notice warn">
          {n}
        </div>
      ))}

      {!results.length ? (
        <div className="card">
          <Empty icon="▦" title="No mods checked yet">
            Paste a link above, or check everything installed in Vortex.
          </Empty>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
            <div className="chips" style={{ marginBottom: 0 }}>
              {GROUPS.map((g) => (
                <span key={g.id} className={`chip${group === g.id ? ' on' : ''}`} onClick={() => setGroup(g.id)}>
                  {g.label}
                  <b>{counts[g.id] ?? 0}</b>
                </span>
              ))}
            </div>
            <input className="input" style={{ width: 220 }} placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className={sel ? 'split' : ''}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mod</th>
                    <th>Last release</th>
                    <th>Players say</th>
                    <th>Verdict</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.mod.key} className={`clickable${selected === r.mod.key ? ' selected' : ''}`} onClick={() => setSelected(selected === r.mod.key ? null : r.mod.key)}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.mod.name}</div>
                        <div className="row" style={{ gap: 6, marginTop: 3 }}>
                          {r.mod.version && <span className="sub mono">v{r.mod.version}</span>}
                          {r.classification && <Kinds kinds={r.classification.kinds} />}
                          {r.mod.optional && <span className="sub">optional</span>}
                        </div>
                      </td>
                      <td>
                        <ReleaseDate r={r} patchDate={patch?.releaseDate} />
                      </td>
                      <td>
                        <Community c={r.community} />
                      </td>
                      <td>
                        <VerdictBadge verdict={r.verdict} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <NextStep r={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!shown.length && <div className="empty">Nothing in this group.</div>}
            </div>
            {sel && <Details r={sel} onClose={() => setSelected(null)} />}
          </div>
        </>
      )}
    </div>
  )
}

function ReleaseDate({ r, patchDate }: { r: TriageResult; patchDate?: string }) {
  const d = r.nexus?.latestFileDate ?? r.nexus?.updatedAt
  if (!d) return <span className="faint">—</span>
  const after = patchDate ? d.slice(0, 10) >= patchDate : undefined
  return (
    <div className="dates">
      <span style={{ color: after === undefined ? undefined : after ? 'var(--green)' : 'var(--amber)' }}>{fmtDate(d)}</span>
      <span className="vs">{after === undefined ? '' : after ? 'after the patch' : 'before the patch'}</span>
    </div>
  )
}

function Community({ c }: { c?: CommunityReport }) {
  if (!c) return <span className="faint">—</span>
  if (c.error) return <span className="faint" title={c.error}>couldn't read</span>
  if (!c.works && !c.broken) return <span className="faint">no reports</span>
  return (
    <span className="row" style={{ gap: 6 }}>
      {c.works > 0 && <Badge tone="green">{c.works} works</Badge>}
      {c.broken > 0 && <Badge tone="red">{c.broken} broken</Badge>}
    </span>
  )
}

function NextStep({ r }: { r: TriageResult }) {
  const { api, jobs, go, toast } = useStore()
  const active = jobs.find((j) => j.modKey === r.mod.key && (isRunning(j.status) || j.status === 'ready'))
  if (active) {
    return (
      <button className="btn sm" onClick={() => go('fixes', active.id)}>
        View fix
      </button>
    )
  }
  switch (r.action) {
    case 'ai-fix':
      return (
        <ActionButton
          className="primary sm"
          disabled={!r.classification?.aiFixable || !r.mod.stagingPath}
          title={!r.mod.stagingPath ? 'Install the mod with Vortex first.' : undefined}
          onClick={async () => {
            const j = await api.startJob(r)
            toast(`Started a fix for ${r.mod.name}.`, 'ok')
            go('fixes', j.id)
          }}
        >
          Make a fix
        </ActionButton>
      )
    case 'update-in-vortex':
    case 'update-framework':
      return (
        <button className="btn sm" disabled={!r.nexus?.url} onClick={() => r.nexus && void api.openExternal(`${r.nexus.url}?tab=files`)}>
          Get update
        </button>
      )
    case 'test-in-game':
      return (
        <button className="btn sm" onClick={() => go('test')}>
          Test in game
        </button>
      )
    case 'wait-for-author':
      return <span className="faint small">Disable it for now</span>
    default:
      return <span className="faint small">—</span>
  }
}

function Details({ r, onClose }: { r: TriageResult; onClose: () => void }) {
  const { api, setResults, results } = useStore()
  const c = r.classification
  return (
    <div className="card drawer">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3>{r.mod.name}</h3>
          <div className="faint small">
            {r.mod.version ? `v${r.mod.version}` : ''} {r.mod.nexusModId ? `· Nexus ${r.mod.nexusModId}` : ''} {r.mod.source === 'collection' ? '· from collection' : ''}
          </div>
        </div>
        <button className="btn ghost sm" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="row" style={{ margin: '12px 0' }}>
        <VerdictBadge verdict={r.verdict} />
        <span className="muted small">{ACTION[r.action]}</span>
      </div>

      <div className="section-title">Why</div>
      <ul className="reasons">
        {r.reasons.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>

      {r.nexus && (
        <>
          <div className="section-title">On Nexus</div>
          <dl className="kv small">
            <dt>Latest file</dt>
            <dd>
              {r.nexus.latestFileVersion ?? '—'} ({fmtDate(r.nexus.latestFileDate)})
            </dd>
            <dt>Yours</dt>
            <dd>
              {r.nexus.installedFileVersion ?? r.mod.version ?? '—'} {r.nexus.installedFileDate && `(${fmtDate(r.nexus.installedFileDate)})`}
            </dd>
          </dl>
          {r.nexus.descriptionMentions.map((m) => (
            <div key={m} className="quote">
              {m}
            </div>
          ))}
          <a className="small" onClick={() => void api.openExternal(r.nexus!.url)}>
            Open on Nexus
          </a>
        </>
      )}

      {c && (
        <>
          <div className="section-title">Inside the mod</div>
          <dl className="kv small">
            <dt>Types</dt>
            <dd>
              <Kinds kinds={c.kinds} />
            </dd>
            <dt>Files</dt>
            <dd>{c.files.length}</dd>
            <dt>Needs</dt>
            <dd>{c.frameworksUsed.map((f) => FRAMEWORK_NAMES[f] ?? f).join(', ') || 'no frameworks'}</dd>
            <dt>Risk</dt>
            <dd>
              <Badge tone={c.risk === 'high' ? 'red' : c.risk === 'medium' ? 'amber' : 'green'}>{c.risk}</Badge>
            </dd>
            <dt>AI can fix</dt>
            <dd>{c.aiFixable ? 'yes' : 'no, only its author can'}</dd>
          </dl>
          {c.notes.map((n) => (
            <div key={n} className="notice" style={{ marginTop: 8, marginBottom: 0 }}>
              {n}
            </div>
          ))}
        </>
      )}

      {r.checks.length > 0 && (
        <>
          <div className="section-title">Checks</div>
          <div className="checklist">
            {r.checks.map((ch) => (
              <div key={ch.id} className="check-item">
                <span>{ch.status === 'pass' ? '✓' : ch.status === 'fail' ? '✕' : ch.status === 'warn' ? '!' : '–'}</span>
                <span style={{ color: ch.status === 'fail' ? 'var(--red)' : ch.status === 'warn' ? 'var(--amber)' : undefined }}>{ch.label}</span>
                {ch.details.length > 0 && <div className="details">{ch.details.join('\n')}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {r.mod.nexusModId && (
        <>
          <div className="section-title">
            What players say {r.community && <span className="faint">({r.community.source === 'ai' ? 'read by AI' : 'keyword scan'})</span>}
          </div>
          {r.community?.summary && <p className="small">{r.community.summary}</p>}
          {r.community?.snippets.map((s) => (
            <div key={s.text} className={`quote ${s.verdict}`}>
              {s.text}
            </div>
          ))}
          {r.community && !r.community.snippets.length && <div className="faint small">No posts mention the patch.</div>}
          <ActionButton
            className="ghost sm"
            onClick={async () => {
              const community = await api.checkCommunity(r.mod)
              setResults(results.map((x) => (x.mod.key === r.mod.key ? { ...x, community } : x)))
            }}
          >
            Read the posts again
          </ActionButton>
        </>
      )}

      <hr className="sep" />
      <NextStep r={r} />
    </div>
  )
}
