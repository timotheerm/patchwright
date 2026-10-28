import { useState, type ReactNode } from 'react'
import type { ModKind, Verdict } from '../../shared/types'
import { KIND, VERDICT, type Tone } from './labels'
import { useStore } from './store'

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict]
  return <Badge tone={v.tone}>{v.label}</Badge>
}

export function Kinds({ kinds }: { kinds: ModKind[] }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {kinds.map((k) => (
        <span key={k} className="kind">
          {KIND[k]}
        </span>
      ))}
    </span>
  )
}

export function Dot({ tone }: { tone: 'green' | 'amber' | 'red' | 'gray' }) {
  return <span className={`dot ${tone}`} />
}

export function Spinner() {
  return <span className="spin" />
}

/**
 * A button that runs an async action, shows a spinner while it runs, and turns a thrown error into a
 * toast, so pages don't each need their own busy and error state.
 */
export function ActionButton({
  onClick,
  children,
  className = '',
  disabled,
  title
}: {
  onClick: () => Promise<unknown> | unknown
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
}) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await onClick()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className={`btn ${className}`} disabled={disabled || busy} onClick={() => void run()} title={title}>
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

export function PathField({
  label,
  value,
  onChange,
  kind,
  hint,
  placeholder
}: {
  label: string
  value?: string
  onChange: (v: string) => void
  kind: 'file' | 'folder'
  hint?: ReactNode
  placeholder?: string
}) {
  const { api } = useStore()
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-row">
        <input className="input mono" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button
          className="btn"
          onClick={async () => {
            const p = await api.pickPath(kind, label)
            if (p) onChange(p)
          }}
        >
          Browse
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = 'text',
  mono
}: {
  label: string
  value?: string | number
  onChange: (v: string) => void
  hint?: ReactNode
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  mono?: boolean
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className={`input${mono ? ' mono' : ''}`} type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function fmtUsd(n?: number): string {
  return n === undefined ? '—' : `$${n.toFixed(2)}`
}
