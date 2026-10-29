import { useEffect, useState } from 'react'
import type { FixOutcome, FixRecord, KnowledgeBase, ModKind, PatchChange } from '../../../shared/types'
import { ActionButton, Badge, Empty, Kinds, TextField, fmtDate } from '../components'
import { KIND, OUTCOME, SOURCE } from '../labels'
import { useStore } from '../store'

type Tab = 'all' | 'changes' | 'fixes'

const EDITABLE_KINDS: ModKind[] = ['archive', 'archivexl', 'tweakxl', 'redscript', 'cet', 'ini']

export function KnowledgePage() {
  const { api, toast, game } = useStore()
  const [kb, setKb] = useState<KnowledgeBase | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void api.getKnowledge().then(setKb)
  }, [api])

  if (!kb) return <div className="page muted">Loading…</div>

  const q = query.trim().toLowerCase()
  const match = (...parts: (string | undefined)[]): boolean => !q || parts.some((p) => p?.toLowerCase().includes(q))
  const changes = kb.changes
    .filter((c) => match(c.summary, c.symptoms, c.remedy, c.patch, ...c.keywords, ...c.affects))
    .sort((a, b) => parseFloat(b.patch) - parseFloat(a.patch))
  const fixes = kb.fixes
    .filter((f) => match(f.modName, f.problem, f.approach, f.patch, ...f.lessons, ...f.kinds))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const patches = [...new Set(changes.map((c) => c.patch))]

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-head">
        <div>
          <h1>Knowledge</h1>
          <p>
            What Patchwright knows about patches and fixes. Every fix starts from the entries that match its mod, so you never have to write a prompt.
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add a patch change'}
        </button>
        <ActionButton
          className="ghost"
          onClick={async () => {
            const r = await api.exportKnowledge()
            toast(r.message, r.ok ? 'ok' : 'error')
          }}
          title="Saves what this PC learned to a file you can share or keep."
        >
          Export
        </ActionButton>
        <ActionButton
          className="ghost"
          onClick={async () => {
            const file = await api.pickPath('file', 'Pick a Patchwright knowledge file')
            if (!file) return
            const r = await api.importKnowledge(file)
            toast(r.message, r.ok ? 'ok' : 'error')
            setKb(await api.getKnowledge())
          }}
        >
          Import
        </ActionButton>
      </div>

      {adding && (
        <AddChange
          patch={game?.baselinePatch?.version ?? ''}
          onSaved={(next) => {
            setKb(next)
            setAdding(false)
            toast('Saved. Fixes for matching mods will see it.', 'ok')
          }}
        />
      )}

      <div className="row" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <div className="chips" style={{ marginBottom: 0 }}>
          {(
            [
              ['all', 'All', kb.changes.length + kb.fixes.length],
              ['changes', 'Patch changes', kb.changes.length],
              ['fixes', 'Fixes', kb.fixes.length]
            ] as [Tab, string, number][]
          ).map(([id, label, n]) => (
            <span key={id} className={`chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
              {label}
              <b>{n}</b>
            </span>
          ))}
        </div>
        <input className="input" style={{ width: 260 }} placeholder="Search: a mod, a file, a word" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {tab !== 'fixes' && (
        <>
          <div className="section-title">What changed in each patch</div>
          {!changes.length && <div className="faint small">Nothing matches.</div>}
          {patches.map((p) => (
            <div key={p} className="card" style={{ marginBottom: 12 }}>
              <h2>Patch {p}</h2>
              {changes
                .filter((c) => c.patch === p)
                .map((c) => (
                  <ChangeItem key={c.id} c={c} onChange={setKb} />
                ))}
            </div>
          ))}
        </>
      )}

      {tab !== 'changes' && (
        <>
          <div className="section-title">Fixes and how they did in game</div>
          {!fixes.length && (
            <div className="card">
              <Empty icon="◆" title="No fixes match">
                Fixes are added here when a fix job finishes.
              </Empty>
            </div>
          )}
          <div className="grid cols-2">
            {fixes.map((f) => (
              <FixItem key={f.id} f={f} onChange={setKb} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ChangeItem({ c, onChange }: { c: PatchChange; onChange: (kb: KnowledgeBase) => void }) {
  const { api } = useStore()
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, fontWeight: 600 }}>{c.summary}</div>
        <Badge tone={SOURCE[c.source].tone}>{SOURCE[c.source].label}</Badge>
        <ActionButton
          className="ghost sm"
          title={c.source === 'built-in' ? 'Hide this built-in entry' : 'Delete'}
          onClick={async () => {
            if (window.confirm(c.source === 'built-in' ? 'Hide this built-in entry? Fixes will stop seeing it.' : 'Delete this entry?')) onChange(await api.deleteKnowledgeEntry(c.id))
          }}
        >
          ✕
        </ActionButton>
      </div>
      <div className="row" style={{ gap: 6, margin: '6px 0' }}>
        {c.affects.length ? <Kinds kinds={c.affects} /> : <span className="faint small">any mod type</span>}
      </div>
      {c.symptoms && (
        <div className="small">
          <span className="faint">Symptoms: </span>
          {c.symptoms}
        </div>
      )}
      {c.remedy && (
        <div className="small">
          <span className="faint">Remedy: </span>
          {c.remedy}
        </div>
      )}
      {c.keywords.length > 0 && (
        <div className="faint small" style={{ marginTop: 4 }}>
          Matched by: <span className="mono">{c.keywords.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

function FixItem({ f, onChange }: { f: FixRecord; onChange: (kb: KnowledgeBase) => void }) {
  const { api, jobs, go, toast } = useStore()
  const job = f.fromJob ? jobs.find((j) => j.id === f.fromJob) : undefined
  const setOutcome = async (o: FixOutcome): Promise<void> => {
    if (job) {
      const r = await api.recordOutcome(job.id, o)
      toast(r.message, r.ok ? 'ok' : 'error')
      onChange(await api.getKnowledge())
    } else onChange(await api.saveKnowledgeEntry('fix', { ...f, outcome: o }))
  }
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 15 }}>{f.modName}</div>
          <div className="faint small">
            Patch {f.patch} · {fmtDate(f.updatedAt)}
          </div>
        </div>
        <select className="input" style={{ height: 28, fontSize: 12.5 }} value={f.outcome} onChange={(e) => void setOutcome(e.target.value as FixOutcome)}>
          {(Object.keys(OUTCOME) as FixOutcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME[o].label}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <Badge tone={OUTCOME[f.outcome].tone}>{OUTCOME[f.outcome].label}</Badge>
        <Badge tone={SOURCE[f.source].tone}>{SOURCE[f.source].label}</Badge>
        <Kinds kinds={f.kinds} />
      </div>
      {f.outcomeNote && <div className="quote works">{f.outcomeNote}</div>}
      <div className="small" style={{ marginBottom: 6 }}>
        <span className="faint">Problem: </span>
        {f.problem}
      </div>
      <div className="small" style={{ marginBottom: 6 }}>
        <span className="faint">Fix: </span>
        {f.approach}
      </div>
      {f.lessons.length > 0 && (
        <ul className="reasons small" style={{ marginTop: 6 }}>
          {f.lessons.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {job && (
          <button className="btn sm" onClick={() => go('fixes', job.id)}>
            Open the fix
          </button>
        )}
        <span style={{ flex: 1 }} />
        <ActionButton
          className="ghost sm"
          onClick={async () => {
            if (window.confirm(f.source === 'built-in' ? 'Hide this built-in entry? Fixes will stop seeing it.' : 'Delete this entry?')) onChange(await api.deleteKnowledgeEntry(f.id))
          }}
        >
          {f.source === 'built-in' ? 'Hide' : 'Delete'}
        </ActionButton>
      </div>
    </div>
  )
}

function AddChange({ patch, onSaved }: { patch: string; onSaved: (kb: KnowledgeBase) => void }) {
  const { api } = useStore()
  const [d, setD] = useState({ patch, summary: '', symptoms: '', remedy: '', keywords: '', affects: [] as ModKind[] })
  const toggle = (k: ModKind): void => setD({ ...d, affects: d.affects.includes(k) ? d.affects.filter((x) => x !== k) : [...d.affects, k] })
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Add something a patch changed</h2>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <TextField label="Patch" value={d.patch} onChange={(v) => setD({ ...d, patch: v })} />
        <TextField label="Words or paths that show a mod is affected" value={d.keywords} onChange={(v) => setD({ ...d, keywords: v })} placeholder="comma separated, e.g. player_ranged, streaming:" />
      </div>
      <TextField label="What changed" value={d.summary} onChange={(v) => setD({ ...d, summary: v })} />
      <div className="field">
        <label>Mod types it breaks</label>
        <div className="chips" style={{ marginBottom: 0 }}>
          {EDITABLE_KINDS.map((k) => (
            <span key={k} className={`chip${d.affects.includes(k) ? ' on' : ''}`} onClick={() => toggle(k)}>
              {KIND[k]}
            </span>
          ))}
        </div>
      </div>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <TextField label="How it shows up" value={d.symptoms} onChange={(v) => setD({ ...d, symptoms: v })} />
        <TextField label="How to fix it" value={d.remedy} onChange={(v) => setD({ ...d, remedy: v })} />
      </div>
      <ActionButton
        className="primary"
        disabled={!d.summary.trim() || !d.patch.trim()}
        onClick={async () => {
          const entry: PatchChange = {
            id: `user-${Date.now().toString(36)}`,
            gameId: 'cyberpunk2077',
            patch: d.patch.trim(),
            summary: d.summary.trim(),
            affects: d.affects,
            symptoms: d.symptoms.trim() || undefined,
            remedy: d.remedy.trim() || undefined,
            keywords: d.keywords
              .split(',')
              .map((k) => k.trim().toLowerCase())
              .filter(Boolean),
            source: 'user',
            addedAt: new Date().toISOString()
          }
          onSaved(await api.saveKnowledgeEntry('change', entry))
        }}
      >
        Save
      </ActionButton>
    </div>
  )
}
