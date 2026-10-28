import { describe, expect, it } from 'vitest'
import { classifyFiles, classifyPath } from '../src/core/games/cyberpunk2077/classify'

describe('classifyPath', () => {
  it('maps file locations to mod types', () => {
    expect(classifyPath('archive/pc/mod/ReLUX.archive')).toBe('archive')
    expect(classifyPath('archive\\pc\\mod\\ReLUX.archive.xl')).toBe('archivexl')
    expect(classifyPath('r6/scripts/ReImagined/Lighting.reds')).toBe('redscript')
    expect(classifyPath('r6/tweaks/mymod/items.yaml')).toBe('tweakxl')
    expect(classifyPath('bin/x64/plugins/cyber_engine_tweaks/mods/AppearanceMenuMod/init.lua')).toBe('cet')
    expect(classifyPath('red4ext/plugins/Crowd/Crowd.dll')).toBe('red4ext')
    expect(classifyPath('engine/config/platform/pc/lods.ini')).toBe('ini')
    expect(classifyPath('README.txt')).toBe('other')
  })
})

describe('classifyFiles', () => {
  const read = (texts: Record<string, string>) => async (rel: string) => texts[rel] ?? ''

  it('flags ArchiveXL sector edits as high risk', async () => {
    const files = [
      { rel: 'archive/pc/mod/ReLUX.archive', size: 10 },
      { rel: 'archive/pc/mod/ReLUX.archive.xl', size: 10 }
    ]
    const c = await classifyFiles(files, read({ 'archive/pc/mod/ReLUX.archive.xl': 'streaming:\n  sectors:\n    - path: a' }))
    expect(c.kinds).toEqual(expect.arrayContaining(['archive', 'archivexl']))
    expect(c.frameworksUsed).toContain('archivexl')
    expect(c.risk).toBe('high')
    expect(c.aiFixable).toBe(true)
  })

  it('treats a mod with only a native plugin as not fixable', async () => {
    const c = await classifyFiles([{ rel: 'red4ext/plugins/Crowd/Crowd.dll', size: 10 }], read({}))
    expect(c.aiFixable).toBe(false)
    expect(c.risk).toBe('high')
  })

  it('keeps an ini-only mod low risk', async () => {
    const c = await classifyFiles([{ rel: 'engine/config/platform/pc/lods.ini', size: 10 }], read({}))
    expect(c.risk).toBe('low')
    expect(c.kinds).toEqual(['ini'])
  })
})
