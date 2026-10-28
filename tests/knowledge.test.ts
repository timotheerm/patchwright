import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CYBERPUNK_KNOWLEDGE } from '../src/core/games/cyberpunk2077/knowledge'
import { patchValue, queryFromTriage, selectKnowledge, similarity, type KnowledgeQuery } from '../src/core/knowledge/match'
import { KnowledgeStore } from '../src/core/knowledge/store'
import { knowledgeMarkdown } from '../src/core/workflow/prompts'
import type { JobState, TriageResult } from '../src/shared/types'

const q = (over: Partial<KnowledgeQuery>): KnowledgeQuery => ({ patch: '2.5', modName: 'Some mod', kinds: [], frameworks: [], text: '', ...over })

describe('patchValue', () => {
  it('orders hotfixes between content patches', () => {
    expect(patchValue('2.12')).toBeLessThan(patchValue('2.2'))
    expect(patchValue('2.21')).toBeLessThan(patchValue('2.3'))
    expect(patchValue('2.5')).toBeGreaterThan(patchValue('2.31'))
  })
})

describe('selectKnowledge', () => {
  it('puts an earlier fix of the same mod first, even with a different name spelling', () => {
    const r = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ modName: 'relux', nexusModId: 20808, kinds: ['archivexl'] }))
    expect(r.fixes[0].entry.modName).toBe('ReLUX')
    expect(r.fixes[0].why).toContain('this same mod was fixed before')
  })

  it('finds the 2.5 sector change for an ArchiveXL mod that edits sectors', () => {
    const r = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ kinds: ['archive', 'archivexl'], text: 'streaming:\n  sectors:\n    nodedeletions' }))
    expect(r.changes[0].entry.id).toBe('cp2077-2.5-cooked-nodes')
    expect(r.fixes.map((f) => f.entry.modName)).toContain('ReLUX')
  })

  it('finds the dual-wield change for a body mod with player entity copies', () => {
    const r = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ modName: 'Another Body', kinds: ['archive'], text: 'base/characters/entities/player/player_wa_fpp.ent player_ranged' }))
    expect(r.changes.map((c) => c.entry.id)).toContain('cp2077-2.5-dualwield-animgraph')
    expect(r.fixes[0].entry.modName).toBe('SP0 Body Mod 2.0')
  })

  it('leaves out changes from later patches and unrelated mod types', () => {
    const r = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ patch: '2.3', kinds: ['archivexl'], text: 'streaming:' }))
    expect(r.changes).toEqual([])
    const ini = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ kinds: ['ini'] }))
    expect(ini.changes).toEqual([])
    expect(ini.fixes).toEqual([])
  })

  it('warns about fixes that failed', () => {
    const kb = { changes: [], fixes: [{ ...CYBERPUNK_KNOWLEDGE.fixes[0], id: 'x', modName: 'Body X', nexusModId: 9, outcome: 'failed' as const }] }
    const r = selectKnowledge(kb, q({ modName: 'Body X', nexusModId: 9, kinds: ['archive'] }))
    expect(r.fixes[0].why.join(' ')).toContain("did NOT work")
  })

  it('builds a query from the mod files, checks and reasons', () => {
    const t: TriageResult = {
      mod: { key: 'k', name: 'M', source: 'local' },
      classification: { kinds: ['archivexl'], files: [{ relPath: 'archive/pc/mod/M.xl', kind: 'archivexl', size: 1 }], frameworksUsed: ['archivexl'], risk: 'high', aiFixable: true, notes: [] },
      checks: [{ id: 's', label: 'Sectors', status: 'fail', details: ['NodeDeletions index 4'] }],
      verdict: 'not-updated',
      reasons: [],
      action: 'ai-fix',
      checkedAt: ''
    }
    const query = queryFromTriage(t, '2.5', 'Extra\\Report')
    expect(query.text).toContain('archive/pc/mod/m.xl')
    expect(query.text).toContain('nodedeletions index 4')
    expect(query.text).toContain('extra/report')
  })
})

describe('similarity', () => {
  it('spots the same change written twice', () => {
    expect(similarity('Many vanilla lamps became cooked node types', 'many vanilla lamps became cooked node types in 2.5')).toBeGreaterThan(0.5)
    expect(similarity('Lamps became cooked nodes', 'TweakDB records for weapons were renamed')).toBeLessThan(0.2)
  })
})

describe('KnowledgeStore', () => {
  const job = (id: string): JobState => ({
    id,
    modKey: 'k',
    modName: 'Neon HUD',
    createdAt: '',
    updatedAt: '',
    status: 'ready',
    round: 1,
    maxRounds: 4,
    steps: [],
    dir: '',
    outputDir: '',
    backend: '',
    fixName: 'Neon HUD - 2.5 fix'
  })
  const triage: TriageResult = {
    mod: { key: 'k', name: 'Neon HUD', nexusModId: 77, source: 'vortex' },
    classification: { kinds: ['redscript'], files: [], frameworksUsed: ['redscript'], risk: 'medium', aiFixable: true, notes: [] },
    checks: [],
    verdict: 'not-updated',
    reasons: ['Compile error'],
    action: 'ai-fix',
    checkedAt: ''
  }

  it('learns from a job, skips patch changes it already knows, and records the outcome', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-kb-'))
    const store = new KnowledgeStore(path.join(dir, 'kb.json'), 'cyberpunk2077', CYBERPUNK_KNOWLEDGE)
    const { fix, newChanges } = await store.learnFromJob(
      job('j1'),
      triage,
      '2.5',
      {
        mode: 'addon',
        problem: 'HUD widget class renamed.',
        approach: 'Pointed the script at the new class.',
        lessons: ['Look up renamed classes in the new scripts.'],
        patchChanges: [
          { summary: 'worldInstancedMeshNode no longer exposes "mesh" to scripts.', affects: ['redscript'] },
          { summary: 'The HUD widget class inkHudThing was renamed to inkHudThing2.', affects: ['redscript', 'nonsense'], keywords: ['inkHudThing'] }
        ]
      },
      '# Notes\n\nFixed the HUD.'
    )
    expect(fix).toMatchObject({ id: 'job-j1', modName: 'Neon HUD', outcome: 'untested', source: 'learned', lessons: ['Look up renamed classes in the new scripts.'] })
    expect(newChanges).toHaveLength(1)
    expect(newChanges[0]).toMatchObject({ affects: ['redscript'], keywords: ['inkhudthing'] })

    await store.setOutcome('job-j1', 'works', 'HUD shows again')
    const kb = await store.all()
    expect(kb.fixes.find((f) => f.id === 'job-j1')).toMatchObject({ outcome: 'works', outcomeNote: 'HUD shows again' })
    expect(kb.fixes.length).toBe(CYBERPUNK_KNOWLEDGE.fixes.length + 1)

    // A later job on a similar mod picks the learned fix and the learned change.
    const r = selectKnowledge(kb, q({ modName: 'Other HUD', kinds: ['redscript'], frameworks: ['redscript'], text: 'uses inkhudthing' }))
    expect(r.fixes[0].entry.id).toBe('job-j1')
    expect(r.changes[0].entry.summary).toContain('inkHudThing2')

    // Built-in entries can be overridden and hidden; learned ones deleted.
    await store.setOutcome('cp2077-2.5-reimagined', 'works')
    expect((await store.all()).fixes.find((f) => f.id === 'cp2077-2.5-reimagined')?.outcome).toBe('works')
    await store.remove('cp2077-2.5-lod-tables')
    await store.remove('job-j1')
    const after = await store.all()
    expect(after.changes.some((c) => c.id === 'cp2077-2.5-lod-tables')).toBe(false)
    expect(after.fixes.some((f) => f.id === 'job-j1')).toBe(false)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('imports exported entries once', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-kb-'))
    const store = new KnowledgeStore(path.join(dir, 'kb.json'), 'cyberpunk2077', { changes: [], fixes: [] })
    const entry = { ...CYBERPUNK_KNOWLEDGE.changes[0], id: 'shared-1' }
    expect(await store.importFrom({ changes: [entry] })).toEqual({ added: 1, skipped: 0 })
    expect(await store.importFrom({ changes: [entry] })).toEqual({ added: 0, skipped: 1 })
    expect((await store.all()).changes[0].source).toBe('user')
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('knowledgeMarkdown', () => {
  it('writes the picked entries with why they were picked', () => {
    const r = selectKnowledge(CYBERPUNK_KNOWLEDGE, q({ modName: 'ReLUX', nexusModId: 20808, kinds: ['archive', 'archivexl'], text: 'streaming:' }))
    const md = knowledgeMarkdown(r, 'ReLUX', '2.5')
    expect(md).toContain('### ReLUX (patch 2.5, worked in game)')
    expect(md).toContain('Picked because: this same mod was fixed before')
    expect(md).toContain('Lessons:')
  })
})
