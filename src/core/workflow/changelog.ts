import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { ChangelogEntry, UndoAction } from '../../shared/types'
import { ensureDir, exists, movePath, nowIso, readJson, shortId, timestampSlug, writeJson } from '../util'

/**
 * Every change Patchwright makes outside its own job folders is recorded here, with how to undo it.
 * Kept as JSON for the app and as CHANGELOG.md for people.
 */
export class Changelog {
  constructor(private backupsDir: string) {}

  private get jsonPath(): string {
    return path.join(this.backupsDir, 'patchwright-changes.json')
  }

  async list(): Promise<ChangelogEntry[]> {
    return readJson<ChangelogEntry[]>(this.jsonPath, [])
  }

  async add(action: string, target: string, details: string, undo?: UndoAction): Promise<ChangelogEntry> {
    const entry: ChangelogEntry = { id: shortId(10), ts: nowIso(), action, target, details, undo }
    const all = await this.list()
    all.unshift(entry)
    await writeJson(this.jsonPath, all)
    await ensureDir(this.backupsDir)
    const undoText = !undo
      ? ''
      : undo.type === 'remove-path'
        ? `\n  - Undo: delete \`${undo.path}\` (Patchwright moves it to backups\\undone instead).`
        : undo.type === 'restore-path'
          ? `\n  - Undo: put \`${undo.backup}\` back at \`${undo.path}\`.`
          : `\n  - Undo: with Vortex closed, run \`Vortex.exe --del ${undo.statePath}\`.`
    await fs.appendFile(
      path.join(this.backupsDir, 'CHANGELOG.md'),
      `\n- **${entry.ts.slice(0, 16).replace('T', ' ')}** ${action}: \`${target}\`. ${details}${undoText}\n`,
      'utf8'
    )
    return entry
  }

  private async mark(id: string): Promise<void> {
    const all = await this.list()
    const e = all.find((x) => x.id === id)
    if (e) e.undoneAt = nowIso()
    await writeJson(this.jsonPath, all)
  }

  /**
   * Undoes one entry. Files are never deleted: whatever is removed goes to backups/undone/<time>/.
   * `vortexDel` is called for Vortex state entries.
   */
  async undo(id: string, vortexDel: (statePath: string) => Promise<boolean>): Promise<{ ok: boolean; message: string }> {
    const e = (await this.list()).find((x) => x.id === id)
    if (!e) return { ok: false, message: 'That change is not in the log.' }
    if (e.undoneAt) return { ok: false, message: 'Already undone.' }
    if (!e.undo) return { ok: false, message: 'This change has nothing to undo.' }
    const parking = path.join(this.backupsDir, 'undone', timestampSlug())
    const u = e.undo
    if (u.type === 'remove-path') {
      if (await exists(u.path)) await movePath(u.path, path.join(parking, path.basename(u.path)))
      await this.mark(id)
      await this.add('Undid', u.path, `Moved to ${parking}.`)
      return { ok: true, message: `Removed. A copy is in ${parking}.` }
    }
    if (u.type === 'restore-path') {
      if (!(await exists(u.backup))) return { ok: false, message: `The backup ${u.backup} is gone.` }
      if (await exists(u.path)) await movePath(u.path, path.join(parking, path.basename(u.path)))
      await movePath(u.backup, u.path)
      await this.mark(id)
      await this.add('Restored', u.path, `From ${u.backup}.`)
      return { ok: true, message: 'Restored the previous version.' }
    }
    const ok = await vortexDel(u.statePath)
    if (ok) {
      await this.mark(id)
      await this.add('Undid Vortex change', u.statePath, 'Removed from Vortex state.')
    }
    return ok ? { ok, message: 'Removed from Vortex.' } : { ok, message: 'Vortex refused. Close Vortex and try again.' }
  }
}
