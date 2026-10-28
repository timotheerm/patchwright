import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { LogFinding } from '../../shared/types'
import { exists, readTail, timestampSlug } from '../util'

/** Copies the whole saves folder to backups/saves/<time>. Returns the copy's path. */
export async function backupSaves(savesDir: string, backupsDir: string): Promise<{ path: string; count: number }> {
  if (!(await exists(savesDir))) throw new Error(`Saves folder not found: ${savesDir}`)
  const dest = path.join(backupsDir, 'saves', timestampSlug())
  await fs.cp(savesDir, dest, { recursive: true })
  const count = (await fs.readdir(dest, { withFileTypes: true })).filter((e) => e.isDirectory()).length
  return { path: dest, count }
}

const ERROR_RE = /\b(error|exception|fatal|failed|failure|can't|cannot|unable|invalid|not found|crash)\b/i
const WARN_RE = /\bwarn(ing)?\b/i
const NOISE_RE = /\b(0 errors?|no errors?|without errors?)\b/i

/**
 * Reads the game's logs written since `sinceIso` and returns error and warning lines. Lines that name
 * one of `modNames` are tagged with that mod.
 */
export async function collectFindings(logFiles: { source: string; file: string }[], sinceIso: string, modNames: string[]): Promise<LogFinding[]> {
  const since = Date.parse(sinceIso)
  const needles = modNames.map((m) => ({ name: m, low: m.toLowerCase() })).filter((m) => m.low.length >= 4)
  const out: LogFinding[] = []
  for (const lf of logFiles) {
    let mtime = 0
    try {
      mtime = (await fs.stat(lf.file)).mtimeMs
    } catch {
      continue
    }
    if (!Number.isNaN(since) && mtime < since) continue
    const text = await readTail(lf.file, 512 * 1024)
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || NOISE_RE.test(t)) continue
      const level = ERROR_RE.test(t) ? 'error' : WARN_RE.test(t) ? 'warn' : null
      if (!level) continue
      const low = t.toLowerCase()
      const mod = needles.find((n) => low.includes(n.low))?.name
      out.push({ source: lf.source, file: lf.file, level, text: t.slice(0, 500), mod })
      if (out.length > 400) return out
    }
  }
  // Errors that name a mod first, then other errors, then warnings.
  const rank = (f: LogFinding): number => (f.mod ? 0 : 2) + (f.level === 'error' ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}

export function testSummaryPrompt(findings: LogFinding[], notes: string, patch: string): string {
  const lines = findings.slice(0, 120).map((f) => `[${f.source}] ${f.level}${f.mod ? ` (${f.mod})` : ''}: ${f.text}`)
  return `The user just tested mod fixes in Cyberpunk 2077 ${patch}. Here is what they said, and the error and warning lines from the game's logs written during the test.

User's notes:
${notes || '(none)'}

Log lines:
${lines.join('\n') || '(no errors or warnings)'}

In plain words and under 150 words: did the fixes work, which log lines matter (ignore routine noise), and what should happen next for each mod (keep the fix, make another fix round, or wait for the author).`
}
