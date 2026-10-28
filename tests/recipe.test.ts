import { describe, expect, it } from 'vitest'
import { applyOps, parsePath, validateRecipe } from '../src/core/workflow/recipe'

const entity = () => ({
  Data: {
    RootChunk: {
      components: [
        { HandleId: '0', Data: { $type: 'entSkinnedMeshComponent', name: { $type: 'CName', $value: 'body' } } },
        {
          HandleId: '1',
          Data: {
            $type: 'entAnimatedComponent',
            name: { $type: 'CName', $value: 'deformations' },
            rig: { DepotPath: { $type: 'ResourcePath', $value: 'base\\characters\\woman_base\\deformations_rigs\\rig_a.rig' } }
          }
        }
      ],
      tags: ['a', 'b']
    }
  }
})

describe('parsePath', () => {
  it('splits keys, indexes, matches and wildcards', () => {
    expect(parsePath('Data.RootChunk.components[name=deformations].rig')).toEqual([
      { key: 'Data' },
      { key: 'RootChunk' },
      { key: 'components' },
      { match: ['name', 'deformations'] },
      { key: 'rig' }
    ])
    expect(parsePath('a[2][*]')).toEqual([{ key: 'a' }, { index: 2 }, { all: true }])
  })

  it('rejects a selector without =', () => {
    expect(() => parsePath('a[foo]')).toThrow()
  })
})

describe('applyOps', () => {
  it('sets a value through handle wrappers and CName $value matches', () => {
    const doc = entity()
    const r = applyOps(doc, [{ op: 'set', path: 'Data.RootChunk.components[name=deformations].rig.DepotPath.$value', value: 'new\\rig.rig' }])
    expect(r).toEqual({ applied: 1, misses: [] })
    expect(doc.Data.RootChunk.components[1].Data.rig!.DepotPath.$value).toBe('new\\rig.rig')
  })

  it('reports a miss instead of throwing when a path is missing', () => {
    const r = applyOps(entity(), [{ op: 'set', path: 'Data.RootChunk.components[name=nope].x', value: 1 }])
    expect(r.applied).toBe(0)
    expect(r.misses[0]).toContain('path not found')
  })

  it('removes array items and appends', () => {
    const doc = entity()
    applyOps(doc, [
      { op: 'remove', path: 'Data.RootChunk.components[0]' },
      { op: 'append', path: 'Data.RootChunk.tags', value: 'c' }
    ])
    expect(doc.Data.RootChunk.components).toHaveLength(1)
    expect(doc.Data.RootChunk.tags).toEqual(['a', 'b', 'c'])
  })

  it('applies to every item with [*]', () => {
    const doc = { list: [{ v: 1 }, { v: 2 }] }
    const r = applyOps(doc, [{ op: 'set', path: 'list[*].v', value: 0 }])
    expect(r.applied).toBe(2)
    expect(doc.list).toEqual([{ v: 0 }, { v: 0 }])
  })

  it('refuses to append to something that is not an array', () => {
    const r = applyOps({ a: { b: 1 } }, [{ op: 'append', path: 'a.b', value: 2 }])
    expect(r.misses[0]).toContain('not an array')
  })
})

describe('validateRecipe', () => {
  it('accepts a good recipe', () => {
    expect(
      validateRecipe({ archives: [{ name: '!!SP0_V_25fix', files: [{ to: 'base/a.ent.json', from: 'vanilla:base/a.ent.json', ops: [] }] }] })
    ).toEqual([])
  })

  it('rejects unsafe sources and archive names', () => {
    const errs = validateRecipe({ archives: [{ name: '../evil', files: [{ to: '../x.json', from: 'C:/Windows/x' }] }] })
    expect(errs.length).toBeGreaterThanOrEqual(2)
  })
})
