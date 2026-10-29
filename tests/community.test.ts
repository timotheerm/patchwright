import { describe, expect, it } from 'vitest'
import { parseAiCommunity, scanComments } from '../src/core/sources/community'

describe('scanComments', () => {
  it('counts only posts that mention the patch', () => {
    const r = scanComments(
      [
        'Great mod, works perfectly!',
        'Since 2.5 the removals do nothing, broken for me.',
        "Doesn't work on 2.5 anymore",
        'Confirmed working on 2.5, no issues.',
        'Works on 2.51 hotfix too'
      ],
      '2.5'
    )
    expect(r.broken).toBe(2)
    expect(r.works).toBe(1)
    expect(r.snippets).toHaveLength(3)
  })

  it('treats "latest patch" as a mention', () => {
    expect(scanComments(['Crashes on the latest patch'], '2.5').broken).toBe(1)
  })
})

describe('parseAiCommunity', () => {
  it('reads the JSON object out of a reply', () => {
    const r = parseAiCommunity('Here you go:\n{"works": 3, "broken": 1, "summary": "Mostly fine.", "snippets": [{"text": "ok on 2.5", "verdict": "works"}]}')
    expect(r).toMatchObject({ works: 3, broken: 1, summary: 'Mostly fine.', source: 'ai' })
    expect(r.snippets).toHaveLength(1)
  })

  it('reports an error when there is no JSON', () => {
    expect(parseAiCommunity('Sorry, I could not open the page.').error).toBeDefined()
  })
})
