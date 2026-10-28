import type { CommunityReport, CommunitySnippet } from '../../shared/types'
import { nowIso, stripHtml } from '../util'

const WORKS = /\b(works?|working|worked|fine|no (issues|problems)|compatible|confirmed|all good)\b/i
const BROKEN =
  /\b(broken|broke|doesn'?t work|does not work|not working|stopped working|crash(es|ing)?|ctd|error|not compatible|incompatible|outdated|nothing happens|no effect|needs? (an )?update|t-?pose|missing)\b/i
const NEGATED_WORKS = /\b(doesn'?t|does not|not|no longer|stopped)\s+(work|working)\b/i

/**
 * Scans comment text for reports about the given patch. Only comments that mention the patch version
 * (or "latest patch/update") count, so old praise doesn't hide new breakage.
 */
export function scanComments(comments: string[], patchVersion: string): CommunityReport {
  const ver = new RegExp(`(^|[^\\d.])${patchVersion.replace('.', '\\.')}(?![\\d])|latest (patch|update)|new (patch|update)`, 'i')
  const snippets: CommunitySnippet[] = []
  let works = 0
  let broken = 0
  for (const raw of comments) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text || !ver.test(text)) continue
    const isBroken = BROKEN.test(text) || NEGATED_WORKS.test(text)
    const isWorks = !isBroken && WORKS.test(text)
    const verdict: CommunitySnippet['verdict'] = isBroken ? 'broken' : isWorks ? 'works' : 'neutral'
    if (verdict === 'broken') broken++
    if (verdict === 'works') works++
    snippets.push({ text: text.length > 300 ? `${text.slice(0, 300)}…` : text, verdict })
  }
  return { checkedAt: nowIso(), works, broken, snippets: snippets.slice(0, 25), source: 'keyword' }
}

/** Splits a fetched Nexus posts page into rough comment-sized chunks. */
export function commentsFromHtml(html: string): string[] {
  const blocks = html.split(/<(?:li|article)[^>]*class="[^"]*comment[^"]*"[^>]*>/i)
  const chunks = blocks.length > 2 ? blocks.slice(1) : html.split(/<\/p>|<br\s*\/?>/i)
  return chunks.map(stripHtml).filter((t) => t.length > 10)
}

/**
 * Best effort: reads the mod's posts page. The Nexus site may block or change this page at any time,
 * so callers should treat a failure as "no data", not as a problem with the mod.
 */
export async function fetchPostsPage(domain: string, modId: number, fetchImpl: typeof fetch): Promise<string[]> {
  const url = `https://www.nexusmods.com/${domain}/mods/${modId}?tab=posts`
  const res = await fetchImpl(url, {
    headers: { 'user-agent': 'Patchwright (mod update helper)', accept: 'text/html' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`Posts page returned HTTP ${res.status}`)
  return commentsFromHtml(await res.text())
}

export const COMMUNITY_AI_PROMPT = (url: string, patch: string): string =>
  `Read the Posts tab and the Bugs tab of this Nexus Mods page: ${url}?tab=posts and ${url}?tab=bugs .
Find what users and the author say about whether the mod works on game patch ${patch}.
Reply with only a JSON object, no other text:
{"works": <number of reports that it works on ${patch}>, "broken": <number of reports that it is broken on ${patch}>,
 "summary": "<two sentences: what breaks, any workaround, what the author said>",
 "snippets": [{"text": "<short quote>", "verdict": "works" | "broken" | "neutral"}]}`

export function parseAiCommunity(text: string): CommunityReport {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { checkedAt: nowIso(), works: 0, broken: 0, snippets: [], source: 'ai', error: 'The AI reply had no JSON.' }
  try {
    const j = JSON.parse(m[0]) as Partial<CommunityReport>
    return {
      checkedAt: nowIso(),
      works: Number(j.works) || 0,
      broken: Number(j.broken) || 0,
      summary: typeof j.summary === 'string' ? j.summary : undefined,
      snippets: Array.isArray(j.snippets) ? j.snippets.slice(0, 20) : [],
      source: 'ai'
    }
  } catch (e) {
    return { checkedAt: nowIso(), works: 0, broken: 0, snippets: [], source: 'ai', error: `Could not read the AI reply: ${String(e)}` }
  }
}
