import { useEffect, useState } from 'react'
import type { ChangelogEntry } from '../../../shared/types'
import { ActionButton, Badge, Empty, fmtDateTime } from '../components'
import { useStore } from '../store'

export function HistoryPage() {
  const { api, settings, toast } = useStore()
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null)

  const load = async (): Promise<void> => setEntries(await api.getChangelog())
  useEffect(() => {
    void load()
  }, [api])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p>Everything Patchwright changed on your PC. Undo moves things to a backup folder; nothing is deleted.</p>
        </div>
        <span className="spacer" />
        {settings?.backupsPath && (
          <button className="btn" onClick={() => void api.openPath(settings.backupsPath!)}>
            Open backups folder
          </button>
        )}
      </div>
      {entries && !entries.length ? (
        <div className="card">
          <Empty icon="↺" title="Nothing changed yet" />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 170 }}>When</th>
                <th>What</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => (
                <tr key={e.id} style={{ opacity: e.undoneAt ? 0.5 : 1 }}>
                  <td className="small muted">{fmtDateTime(e.ts)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.action}</div>
                    <div className="sub mono" style={{ overflowWrap: 'anywhere' }}>
                      {e.target}
                    </div>
                    <div className="sub">{e.details}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {e.undoneAt ? (
                      <Badge tone="gray">undone</Badge>
                    ) : e.undo ? (
                      <ActionButton
                        className="sm"
                        onClick={async () => {
                          if (!window.confirm(`Undo "${e.action}"?`)) return
                          const r = await api.undo(e.id)
                          toast(r.message, r.ok ? 'ok' : 'error')
                          await load()
                        }}
                      >
                        Undo
                      </ActionButton>
                    ) : (
                      <span className="faint small">kept</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint small" style={{ marginTop: 14 }}>
        The same list is written to CHANGELOG.md in the backups folder, so it can be read without the app.
      </p>
    </div>
  )
}
