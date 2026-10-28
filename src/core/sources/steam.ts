import type { PatchInfo } from '../../shared/types'

interface SteamNewsItem {
  title: string
  url: string
  date: number
  feedname?: string
  contents?: string
}

/** Recognizes "Update 2.5", "Patch 2.21", "Hotfix 2.31", "2.5 Update" and similar announcement titles. */
export function parsePatchVersion(title: string): string | undefined {
  const m =
    title.match(/\b(?:update|patch|hotfix)\s+v?(\d+\.\d+[0-9a-z.]*)/i) ??
    title.match(/\bv?(\d+\.\d+[0-9a-z.]*)\s+(?:update|patch|hotfix)\b/i)
  return m?.[1].replace(/\.$/, '')
}

/** True for x.yz style versions (2.21, 2.31), which CD PROJEKT RED uses for hotfixes. */
export function isHotfixVersion(v: string): boolean {
  const [, minor = ''] = v.split('.')
  return minor.length > 1 || /hotfix/i.test(v) || v.split('.').length > 2
}

export function parseSteamNews(json: unknown): PatchInfo[] {
  const items = (json as { appnews?: { newsitems?: SteamNewsItem[] } })?.appnews?.newsitems ?? []
  const out: PatchInfo[] = []
  for (const it of items) {
    if (it.feedname && it.feedname !== 'steam_community_announcements') continue
    const version = parsePatchVersion(it.title)
    if (!version) continue
    out.push({
      version,
      releaseDate: new Date(it.date * 1000).toISOString().slice(0, 10),
      title: it.title,
      url: it.url,
      isHotfix: isHotfixVersion(version) || /hotfix/i.test(it.title),
      source: 'steam'
    })
  }
  // Several announcements can name the same version (preview, release notes); keep the earliest.
  const byVersion = new Map<string, PatchInfo>()
  for (const p of out) {
    const prev = byVersion.get(p.version)
    if (!prev || p.releaseDate < prev.releaseDate) byVersion.set(p.version, p)
  }
  return [...byVersion.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
}

export async function fetchSteamPatches(appId: number, fetchImpl: typeof fetch): Promise<PatchInfo[]> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=100&maxlength=300&feeds=steam_community_announcements`
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Steam news returned HTTP ${res.status}`)
  return parseSteamNews(await res.json())
}

/**
 * Picks the patch mods are compared against (the latest content patch) and the latest build overall.
 * Announcements published before a release ("Update 2.5 is coming on...") are skipped by only
 * trusting dates that aren't in the future.
 */
export function pickPatches(
  live: PatchInfo[],
  bundled: PatchInfo[],
  today = new Date().toISOString().slice(0, 10)
): { baseline?: PatchInfo; latest?: PatchInfo } {
  const merged = new Map<string, PatchInfo>()
  for (const p of [...bundled, ...live]) {
    const prev = merged.get(p.version)
    // Bundled dates are verified release days; a live announcement can be a pre-release teaser.
    if (!prev || (prev.source !== 'bundled' && p.releaseDate < prev.releaseDate)) merged.set(p.version, p)
  }
  const all = [...merged.values()]
    .filter((p) => p.releaseDate <= today)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
  const baseline = all.find((p) => !(p.isHotfix ?? isHotfixVersion(p.version)))
  return { baseline, latest: all[0] }
}
