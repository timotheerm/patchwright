import { useEffect, useRef, useState } from 'react'
import type { JobState, LogLine } from '../../../shared/types'
import { ActionButton, Badge, Empty, Spinner, fmtDateTime, fmtTime, fmtUsd } from '../components'
import { JOB_STATUS, OUTCOME, isRunning } from '../labels'
import { useStore } from '../store'

const TABS: { id: string; label: string }[] = [
  { id: 'log', label: 'Live log' },
  { id: 'NOTES.md', label: 'What the fix does' },
  { id: 'FEEDBACK.md', label: 'Check results' },
  { id: 'TASK.md', label: 'Task given to the AI' },
  { id: 'KNOWLEDGE.md', label: 'Knowledge used' },
  { id: 'reports/prepared.md', label: 'Reports' }
]

const STEP_MARK: Record<string, string> = { done: '✓', failed: '✕', skipped: '–', pending: '○' }

export function FixesPage() {
  const { jobs, pageArg } = useStore()
  const [sel, setSel] = useState<string | null>(pageArg ?? null)

  useEffect(() => {
    if (pageArg) setSel(pageArg)
  }, [pageArg])

  const job = jobs.find((j) => j.id === sel) ?? jobs[0]

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div>
          <h1>Fixes</h1>
          <p>Each fix is built in its own folder and installed as a separate mod. The original mod is never changed.</p>
        </div>
      </div>
      {!jobs.length ? (
        <div className="card">
          <Empty icon="✦" title="No fixes yet">
            Check your mods, then press "Make a fix" on a mod that needs one.
          </Empty>
        </div>
      ) : (
        <div className="jobs-layout">
          <div>
            {jobs.map((j) => (
              <JobCard key={j.id} job={j} selected={j.id === job?.id} onClick={() => setSel(j.id)} />
            ))}
          </div>
          {job && <JobDetail key={job.id} job={job} />}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, selected, onClick }: { job: JobState; selected: boolean; onClick: () => void }) {
  const st = JOB_STATUS[job.status]
  return (
    <div className={`job-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="name">{job.modName}</div>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone={st.tone}>
          {isRunning(job.status) && <Spinner />}
          {st.label}
        </Badge>
        <span className="faint small">
          round {job.round}/{job.maxRounds} · {fmtUsd(job.costUsd)}
        </span>
      </div>
    </div>
  )
}

function JobDetail({ job }: { job: JobState }) {
  const { api, toast } = useStore()
  const [tab, setTab] = useState('log')
  const [log, setLog] = useState<LogLine[]>([])
  const [doc, setDoc] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const running = isRunning(job.status)

  useEffect(() => {
    let alive = true
    setLog([])
    const off = api.onEvent((e) => {
      if (e.type === 'job-log' && e.jobId === job.id) setLog((l) => [...l, e.line])
    })
    // Lines that arrived as events while the saved log loads are kept after it.
    void api.getJobLog(job.id).then((saved) => {
      if (!alive) return
      const seen = new Set(saved.map((l) => l.ts + l.text))
      setLog((live) => [...saved, ...live.filter((l) => !seen.has(l.ts + l.text))])
    })
    return () => {
      alive = false
      off()
    }
  }, [api, job.id])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log, tab])

  useEffect(() => {
    if (tab === 'log') return
    setDoc(null)
    void api.readJobFile(job.id, tab).then(setDoc)
  }, [api, job.id, tab, job.updatedAt])

  const deliver = async (mode: 'staging' | 'zip'): Promise<void> => {
    const r = await api.deliverJob(job.id, mode)
    toast(r.message, r.ok ? 'ok' : 'error')
  }

  const st = JOB_STATUS[job.status]
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 650 }}>{job.fixName}</div>
          <div className="faint small">
            Started {fmtDateTime(job.createdAt)} · {job.backend} · round {job.round} of {job.maxRounds} · {fmtUsd(job.costUsd)}
          </div>
        </div>
        <span className="row" style={{ gap: 6 }}>
          {job.outcome && job.outcome !== 'untested' && <Badge tone={OUTCOME[job.outcome].tone}>{OUTCOME[job.outcome].label}</Badge>}
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
      </div>

      {job.summary && job.status !== 'failed' && <div className="notice ok">{firstParagraph(job.summary)}</div>}
      {job.error && <div className="notice error">{job.error}</div>}
      {job.deliveredTo && (
        <div className="notice">
          Installed at <span className="mono">{job.deliveredTo}</span>
        </div>
      )}

      <div className="steps">
        {job.steps.map((s) => (
          <div key={s.id} className={`step ${s.status}`}>
            <div className="label">
              {s.status === 'running' ? <Spinner /> : STEP_MARK[s.status]} {s.label}
            </div>
            {s.detail && <div className="detail">{s.detail}</div>}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <ActionButton className="primary" disabled={job.status !== 'ready' && job.status !== 'delivered'} onClick={() => deliver('staging')} title="Copies the fix into a new folder in the Vortex staging folder.">
          Install in Vortex
        </ActionButton>
        <ActionButton disabled={job.status !== 'ready' && job.status !== 'delivered'} onClick={() => deliver('zip')} title="Saves the fix as a zip you can drag into Vortex.">
          Save as zip
        </ActionButton>
        <button className="btn ghost" onClick={() => void api.openPath(job.outputDir)}>
          Open fix files
        </button>
        <button className="btn ghost" onClick={() => void api.openPath(job.dir)}>
          Open work folder
        </button>
        <span style={{ flex: 1 }} />
        {running && (
          <ActionButton className="danger" onClick={() => api.cancelJob(job.id)}>
            Stop
          </ActionButton>
        )}
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
      </div>
      {tab === 'log' ? (
        <div key="log" className="log" ref={logRef}>
          {log.map((l, i) => (
            <div key={i} className="l">
              <span className="t">{fmtTime(l.ts)}</span>
              <span className={l.level}>
                {l.level === 'tool' ? '› ' : ''}
                {l.text}
              </span>
            </div>
          ))}
          {running && (
            <div className="l">
              <span className="t" />
              <span className="info">
                <Spinner />
              </span>
            </div>
          )}
        </div>
      ) : (
        <div key={tab} className="doc">{doc ?? <span className="faint">Not written yet.</span>}</div>
      )}
    </div>
  )
}

/** The first paragraph of the AI's notes, without Markdown headings, for the summary line. */
function firstParagraph(md: string): string {
  const para = md
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s.*$/gm, '').trim())
    .find(Boolean)
  return para && para.length > 400 ? `${para.slice(0, 400)}…` : (para ?? '')
}
