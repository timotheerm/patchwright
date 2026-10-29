import { describe, expect, it } from 'vitest'
import { decideVerdict, type VerdictInput } from '../src/core/workflow/triage'
import type { Classification, FrameworkStatus, NexusModInfo } from '../src/shared/types'

const patch = { version: '2.5', releaseDate: '2026-10-22', source: 'bundled' as const }

const cls = (over: Partial<Classification> = {}): Classification => ({
  kinds: ['archive'],
  files: [],
  frameworksUsed: [],
  risk: 'medium',
  aiFixable: true,
  notes: [],
  ...over
})

const nexus = (over: Partial<NexusModInfo> = {}): NexusModInfo => ({
  modId: 1,
  name: 'Mod',
  url: 'https://www.nexusmods.com/cyberpunk2077/mods/1',
  latestFileDate: '2025-08-14T00:00:00Z',
  latestFileVersion: '1.0',
  installedFileDate: '2025-08-14T00:00:00Z',
  installedFileVersion: '1.0',
  descriptionMentions: [],
  available: true,
  ...over
})

const input = (over: Partial<VerdictInput> = {}): VerdictInput => ({ patch, checks: [], frameworks: [], classification: cls(), nexus: nexus(), ...over })

describe('decideVerdict', () => {
  it('never patches frameworks', () => {
    expect(decideVerdict(input({ classification: cls({ isFramework: 'archivexl' }) }))).toMatchObject({ verdict: 'framework', action: 'none' })
  })

  it('sends the user to Vortex when the author released after the patch', () => {
    const r = decideVerdict(input({ nexus: nexus({ latestFileDate: '2026-10-25T00:00:00Z', latestFileVersion: '1.1' }) }))
    expect(r).toMatchObject({ verdict: 'update-available', action: 'update-in-vortex' })
  })

  it('says nothing to do when the installed version came out after the patch', () => {
    const r = decideVerdict(input({ nexus: nexus({ latestFileDate: '2026-10-25T00:00:00Z', installedFileDate: '2026-10-25T00:00:00Z' }) }))
    expect(r).toMatchObject({ verdict: 'updated-after-patch', action: 'none' })
  })

  it('waits for a framework with no build for the patch', () => {
    const fw: FrameworkStatus = { id: 'tweakxl', name: 'TweakXL', nexusModId: 4197, installed: true, state: 'no-patch-build' }
    const r = decideVerdict(input({ classification: cls({ frameworksUsed: ['tweakxl'] }), frameworks: [fw] }))
    expect(r.action).toBe('wait-for-author')
  })

  it('leaves native plugins to their author', () => {
    const r = decideVerdict(input({ classification: cls({ kinds: ['red4ext'], aiFixable: false, risk: 'high' }) }))
    expect(r).toMatchObject({ verdict: 'binary-wait', action: 'wait-for-author' })
  })

  it('offers a fix when players report it broken', () => {
    const community = { checkedAt: '', works: 1, broken: 4, snippets: [], source: 'keyword' as const }
    expect(decideVerdict(input({ community }))).toMatchObject({ verdict: 'reported-broken', action: 'ai-fix' })
  })

  it('offers a fix when our own check fails', () => {
    const checks = [{ id: 'redscript', label: 'Scripts compile', status: 'fail' as const, details: ['error'] }]
    expect(decideVerdict(input({ checks })).action).toBe('ai-fix')
  })

  it('suggests a test when players say it works', () => {
    const community = { checkedAt: '', works: 3, broken: 0, snippets: [], source: 'keyword' as const }
    expect(decideVerdict(input({ community }))).toMatchObject({ verdict: 'reported-working', action: 'test-in-game' })
  })

  it('suggests a test for low-risk mods', () => {
    expect(decideVerdict(input({ classification: cls({ kinds: ['ini'], risk: 'low' }) })).action).toBe('test-in-game')
  })
})
