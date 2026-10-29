import { describe, expect, it } from 'vitest'
import { buildModInfo, compatibilityMentions, parseNexusInput } from '../src/core/sources/nexus'

describe('parseNexusInput', () => {
  it('reads mod links, ids and file ids', () => {
    expect(parseNexusInput('https://www.nexusmods.com/cyberpunk2077/mods/20808', 'cyberpunk2077')).toEqual({ kind: 'mod', domain: 'cyberpunk2077', modId: 20808, fileId: undefined })
    expect(parseNexusInput('https://www.nexusmods.com/cyberpunk2077/mods/1424?tab=files&file_id=99', 'x')).toMatchObject({ modId: 1424, fileId: 99 })
    expect(parseNexusInput(' 4923 ', 'cyberpunk2077')).toEqual({ kind: 'mod', domain: 'cyberpunk2077', modId: 4923 })
    expect(parseNexusInput('nxm://cyberpunk2077/mods/107/files/12345', 'x')).toMatchObject({ kind: 'mod', modId: 107, fileId: 12345 })
  })

  it('reads collection links with and without a revision', () => {
    expect(parseNexusInput('https://next.nexusmods.com/cyberpunk2077/collections/qzbxlv', 'x')).toEqual({ kind: 'collection', domain: 'cyberpunk2077', slug: 'qzbxlv', revision: undefined })
    expect(parseNexusInput('https://www.nexusmods.com/games/cyberpunk2077/collections/abc123/revisions/12', 'x')).toMatchObject({ slug: 'abc123', revision: 12 })
  })

  it('returns null for anything else', () => {
    expect(parseNexusInput('ReLUX', 'cyberpunk2077')).toBeNull()
    expect(parseNexusInput('https://example.com/mods/12', 'cyberpunk2077')).toBeNull()
  })
})

describe('compatibilityMentions', () => {
  it('picks sentences about the patch version', () => {
    const text = 'A lighting overhaul.\n[b]Updated for 2.5![/b] Works with the latest patch.\nRequires ArchiveXL 1.28 or newer.'
    const out = compatibilityMentions(text, '2.5')
    expect(out.some((s) => s.includes('Updated for 2.5'))).toBe(true)
    expect(out.some((s) => s.includes('2.51'))).toBe(false)
  })
})

describe('buildModInfo', () => {
  it('ignores archived files when finding the latest release', () => {
    const t = (iso: string) => Date.parse(iso) / 1000
    const info = buildModInfo(
      'cyberpunk2077',
      { mod_id: 1, name: 'Test', updated_timestamp: t('2026-10-25T00:00:00Z') },
      [
        { file_id: 10, version: '1.0', category_name: 'MAIN', uploaded_timestamp: t('2026-01-01T00:00:00Z') },
        { file_id: 11, version: '0.9', category_name: 'ARCHIVED', uploaded_timestamp: t('2026-10-25T00:00:00Z') }
      ],
      10,
      '2.5'
    )
    expect(info.latestFileVersion).toBe('1.0')
    expect(info.latestFileDate?.slice(0, 10)).toBe('2026-01-01')
    expect(info.installedFileVersion).toBe('1.0')
    expect(info.url).toBe('https://www.nexusmods.com/cyberpunk2077/mods/1')
  })
})
