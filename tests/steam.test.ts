import { describe, expect, it } from 'vitest'
import { isHotfixVersion, parsePatchVersion, parseSteamNews, pickPatches } from '../src/core/sources/steam'
import type { PatchInfo } from '../src/shared/types'

describe('parsePatchVersion', () => {
  it('reads common announcement titles', () => {
    expect(parsePatchVersion('Update 2.5 is out now')).toBe('2.5')
    expect(parsePatchVersion('Hotfix 2.31')).toBe('2.31')
    expect(parsePatchVersion('Patch 2.21 – fixes')).toBe('2.21')
    expect(parsePatchVersion('2.3 Update: what is new')).toBe('2.3')
    expect(parsePatchVersion('Cyberpunk 2077 wins an award')).toBeUndefined()
  })
})

describe('isHotfixVersion', () => {
  it('treats x.yz as a hotfix and x.y as a content patch', () => {
    expect(isHotfixVersion('2.5')).toBe(false)
    expect(isHotfixVersion('2.21')).toBe(true)
    expect(isHotfixVersion('2.1.1')).toBe(true)
  })
})

describe('parseSteamNews', () => {
  it('keeps official announcements and the earliest date per version', () => {
    const day = (iso: string) => Date.parse(iso) / 1000
    const json = {
      appnews: {
        newsitems: [
          { title: 'Update 2.5 release notes', url: 'u1', date: day('2026-10-23T10:00:00Z'), feedname: 'steam_community_announcements' },
          { title: 'Update 2.5 is out', url: 'u2', date: day('2026-10-22T10:00:00Z'), feedname: 'steam_community_announcements' },
          { title: 'Patch 2.5 review', url: 'u3', date: day('2026-10-22T10:00:00Z'), feedname: 'pcgamer' }
        ]
      }
    }
    const out = parseSteamNews(json)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ version: '2.5', releaseDate: '2026-10-22', url: 'u2', isHotfix: false, source: 'steam' })
  })
})

describe('pickPatches', () => {
  const bundled: PatchInfo[] = [
    { version: '2.5', releaseDate: '2026-10-22', source: 'bundled' },
    { version: '2.3', releaseDate: '2025-07-17', source: 'bundled' }
  ]

  it('uses the latest content patch as the baseline and tracks hotfixes separately', () => {
    const live: PatchInfo[] = [{ version: '2.51', releaseDate: '2026-10-27', isHotfix: true, source: 'steam' }]
    const r = pickPatches(live, bundled, '2026-10-28')
    expect(r.baseline?.version).toBe('2.5')
    expect(r.latest?.version).toBe('2.51')
  })

  it('ignores announcements dated in the future', () => {
    const live: PatchInfo[] = [{ version: '2.6', releaseDate: '2026-12-01', source: 'steam' }]
    expect(pickPatches(live, bundled, '2026-10-28').baseline?.version).toBe('2.5')
  })

  it('keeps the bundled release day over a live teaser', () => {
    const live: PatchInfo[] = [{ version: '2.5', releaseDate: '2026-10-15', source: 'steam' }]
    expect(pickPatches(live, bundled, '2026-10-28').baseline).toMatchObject({ releaseDate: '2026-10-22', source: 'bundled' })
  })
})
