import { describe, expect, it } from 'vitest'
import { checkSectorEdit, sectorNodes, xlSectorEdits } from '../src/core/games/cyberpunk2077/cr2wjson'

const sector = {
  Data: {
    RootChunk: {
      nodes: [
        { HandleId: '0', Data: { $type: 'worldStaticLightNode', debugName: { $value: 'lamp' } } },
        { HandleId: '1', Data: { $type: 'worldInstancedMeshNode' } }
      ],
      nodeData: {
        Data: [
          { NodeIndex: 0, Position: { X: 1, Y: 2, Z: 3 } },
          { NodeIndex: 1, Position: { X: 4, Y: 5, Z: 6 } },
          { NodeIndex: 1, Position: { X: 7, Y: 8, Z: 9 } }
        ]
      }
    }
  }
}

describe('sectorNodes', () => {
  it('lists node data entries with the type of the node they point at', () => {
    const s = sectorNodes(sector)
    expect(s.nodeDataCount).toBe(3)
    expect(s.nodeCount).toBe(2)
    expect(s.nodes[0]).toMatchObject({ index: 0, nodeIndex: 0, type: 'worldStaticLightNode', position: [1, 2, 3] })
    expect(s.nodes[2].type).toBe('worldInstancedMeshNode')
  })
})

describe('xlSectorEdits and checkSectorEdit', () => {
  const xl = {
    streaming: {
      sectors: [
        {
          path: 'base\\worlds\\03_night_city\\_compiled\\default\\exterior_-23_-35_0_1.streamingsector',
          expectedNodes: 2,
          nodeDeletions: [
            { index: 0, type: 'worldStaticLightNode' },
            { index: 1, type: 'worldStaticLightNode' },
            { index: 5, type: 'worldStaticLightNode' }
          ]
        }
      ]
    }
  }

  it('reads edits and finds stale ones', () => {
    const edits = xlSectorEdits(xl)
    expect(edits).toHaveLength(1)
    const problems = checkSectorEdit(edits[0], sectorNodes(sector))
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('expectedNodes is 2')
    expect(problems.some((p) => p.includes('index 1 is now worldInstancedMeshNode'))).toBe(true)
    expect(problems.some((p) => p.includes("index 5 doesn't exist"))).toBe(true)
  })

  it('ignores documents without sector edits', () => {
    expect(xlSectorEdits({ resource: { patch: {} } })).toEqual([])
  })
})
