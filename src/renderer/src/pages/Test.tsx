import { useEffect, useState, type ReactNode } from 'react'
import type { FixOutcome, LogFinding } from '../../../shared/types'
import { ActionButton, Badge, fmtDateTime } from '../components'
import { JOB_STATUS, OUTCOME } from '../labels'
import { local, useStore } from '../store'

interface Session {
  saves?: string
  profile?: string
  startedAt?: string
}

const KEY = 'patchwright.test-session'

export function TestPage() {
  const { api, jobs, results, toast, game, go } = useStore()
  const [session, setSessionState] = useState<Session>(() => local.get<Session>(KEY, {}))
  const [hints, setHints] = useState<{ jobId: string; fixName: string; hints: string[] }[]>([])
  const [notes, setNotes] = useState('')
  const [findings, setFindings] = useState<LogFinding[] | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const setSession = (s: Session): void => {
    setSessionState(s)
    local.set(KEY, s)
  }

  const fixes = jobs.filter((j) => j.status === 'ready' || j.status === 'delivered')
  const installed = fixes.filter((j) => j.status === 'delivered')
  const toTry = results.filter((r) => r.action === 'test-in-game')

  useEffect(() => {
    if (installed.length) void api.getTestHints(installed.map((j) => j.id)).then(setHints)
    else setHints([])
  }, [api, installed.map((j) => j.id).join()])

  const patch = game?.baselinePatch?.version ?? 'the patch'

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>Test in game</h1>
          <p>Try the fixes in a copy of your Vortex profile, with your saves backed up first.</p>
        </div>
        <span className="spacer" />
        {(session.saves || session.profile || session.startedAt) && (
          <button
            className="btn ghost"
            onClick={() => {
              setSession({})
              setFindings(null)
              setSummary(null)
              setNotes('')
            }}
          >
            Start over
          </button>
        )}
      </div>

      <div className="stepper">
        <Step n={1} done={!!session.saves} title="Back up your saves" text={session.saves ?? 'Copies your whole saves folder. A broken mod can damage a save, and this lets you go back.'}>
          <ActionButton
            className={session.saves ? '' : 'primary'}
            onClick={async () => {
              const r = await api.backupSaves()
              toast(r.message, r.ok ? 'ok' : 'error')
              if (r.ok) setSession({ ...session, saves: r.message })
            }}
          >
            {session.saves ? 'Back up again' : 'Back up saves'}
          </ActionButton>
        </Step>

        <Step
          n={2}
          done={!!session.profile}
          title="Use a test profile in Vortex"
          text={session.profile ?? `A copy of your active profile named "Patchwright ${patch} test". Your main profile stays as it is. Vortex must be closed for this.`}
        >
          <div className="row">
            <ActionButton
              onClick={async () => {
                const r = await api.createTestProfile()
                toast(r.message, r.ok ? 'ok' : 'error')
                if (r.ok) setSession({ ...session, profile: r.message })
              }}
            >
              Create test profile
            </ActionButton>
            {!session.profile && (
              <button className="btn ghost" onClick={() => setSession({ ...session, profile: 'You set up the test profile yourself.' })}>
                I made one myself
              </button>
            )}
          </div>
        </Step>

        <Step n={3} done={installed.length > 0} title="Install the fixes" text="Each fix goes into Vortex as its own mod. Restart Vortex, switch to the test profile, enable the fixes, and deploy.">
          <div />
        </Step>
        <div style={{ marginLeft: 48, marginTop: -4 }}>
          {!fixes.length ? (
            <div className="faint small">
              No fixes are ready yet. <a onClick={() => go('fixes')}>See fixes</a>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {fixes.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{j.fixName}</div>
                        {j.deliveredTo && <div className="sub mono">{j.deliveredTo}</div>}
                      </td>
                      <td style={{ width: 120 }}>
                        <Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
                      </td>
                      <td style={{ width: 160, textAlign: 'right' }}>
                        <ActionButton
                          className={j.status === 'ready' ? 'primary sm' : 'sm'}
                          onClick={async () => {
                            const r = await api.deliverJob(j.id, 'staging')
                            toast(r.message, r.ok ? 'ok' : 'error')
                          }}
                        >
                          {j.status === 'ready' ? 'Install in Vortex' : 'Install again'}
                        </ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Step
          n={4}
          done={!!session.startedAt}
          title="Play and look for these"
          text={session.startedAt ? `Test started ${fmtDateTime(session.startedAt)}. Logs written after this are read in the next step.` : 'Press Start when you launch the game, so only logs from this test are read.'}
        >
          <ActionButton className={session.startedAt ? '' : 'primary'} onClick={() => setSession({ ...session, startedAt: new Date().toISOString() })}>
            {session.startedAt ? 'Restart the clock' : 'Start test'}
          </ActionButton>
        </Step>
        <div style={{ marginLeft: 48, marginTop: -4 }}>
          {hints.map((h) => (
            <div key={h.jobId} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{h.fixName}</div>
              <ul className="reasons small">
                {h.hints.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
          {toTry.length > 0 && (
            <div className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Mods that weren't updated but may still work</div>
              <div className="muted small">{toTry.map((r) => r.mod.name).join(', ')}</div>
            </div>
          )}
          {!hints.length && !toTry.length && <div className="faint small">Install a fix to see what to look at.</div>}
        </div>

        <Step n={5} done={!!summary} title="I'm done testing" text="Say what you saw. Patchwright reads the game's logs from the test and the AI sums up what to do with each fix.">
          <div />
        </Step>
        <div style={{ marginLeft: 48, marginTop: -4 }}>
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%', marginBottom: 8 }}
            placeholder="e.g. Reload animation works now. The lamps in Japantown are gone. One crash when opening the map."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="row" style={{ marginBottom: 12 }}>
            <ActionButton
              className="primary"
              disabled={!session.startedAt}
              onClick={async () => {
                const f = await api.readTestLogs(session.startedAt!, [...installed.map((j) => j.modName), ...toTry.map((r) => r.mod.name)])
                setFindings(f)
                setSummary(await api.summarizeTest(f, notes))
              }}
            >
              Read logs and sum up
            </ActionButton>
            {!session.startedAt && <span className="faint small">Start the test first (step 4).</span>}
          </div>
          {findings && (
            <div className="card" style={{ marginBottom: 10 }}>
              <h2>
                From the game's logs <span className="right faint small">{findings.length} lines</span>
              </h2>
              {!findings.length && <div className="muted">No errors or warnings since the test started.</div>}
              {findings.slice(0, 40).map((f, i) => (
                <div key={i} className={`quote ${f.level === 'error' ? 'broken' : ''}`}>
                  <span className="row" style={{ gap: 6, marginBottom: 2 }}>
                    <Badge tone={f.level === 'error' ? 'red' : 'amber'}>{f.level}</Badge>
                    <span className="faint small">{f.source}</span>
                    {f.mod && <Badge tone="cyan">{f.mod}</Badge>}
                  </span>
                  <span className="mono">{f.text}</span>
                </div>
              ))}
            </div>
          )}
          {summary && (
            <div className="card" style={{ marginBottom: 10 }}>
              <h2>Summary</h2>
              <div style={{ whiteSpace: 'pre-wrap' }}>{summary}</div>
              <hr className="sep" />
              <div className="faint small">
                To drop a fix, disable it in Vortex, or undo its install in <a onClick={() => go('history')}>History</a>. Your saves backup stays until you delete it.
              </div>
            </div>
          )}
          {installed.length > 0 && (
            <div className="card">
              <h2>How did each fix do?</h2>
              <p className="muted small" style={{ marginTop: -4 }}>
                Patchwright remembers your answer. Fixes that work become the starting point for similar mods; fixes that don't are marked so they aren't repeated.
              </p>
              {installed.map((j) => (
                <OutcomeRow key={j.id} jobId={j.id} name={j.fixName} outcome={j.outcome} notes={notes} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Step({ n, done, title, text, children }: { n: number; done: boolean; title: string; text: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className={`num${done ? ' done' : ''}`}>{done ? '✓' : n}</div>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

function OutcomeRow({ jobId, name, outcome, notes }: { jobId: string; name: string; outcome?: FixOutcome; notes: string }) {
  const { api, toast } = useStore()
  const mark = async (o: FixOutcome): Promise<void> => {
    const r = await api.recordOutcome(jobId, o, notes || undefined)
    toast(r.message, r.ok ? 'ok' : 'error')
  }
  return (
    <div className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ flex: 1, fontWeight: 600 }}>{name}</span>
      {outcome && <Badge tone={OUTCOME[outcome].tone}>{OUTCOME[outcome].label}</Badge>}
      <ActionButton className="sm" onClick={() => mark('works')}>
        It works
      </ActionButton>
      <ActionButton className="sm" onClick={() => mark('partial')}>
        Partly
      </ActionButton>
      <ActionButton className="sm danger" onClick={() => mark('failed')}>
        It doesn't work
      </ActionButton>
    </div>
  )
}
