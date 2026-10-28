import path from 'node:path'
import type { CollectionInfo, ModRef, NexusModInfo } from '../../shared/types'
import { readJson, stripBbcode, writeJson } from '../util'

export type NexusInput =
  | { kind: 'mod'; domain: string; modId: number; fileId?: number }
  | { kind: 'collection'; domain: string; slug: string; revision?: number }

/** Understands Nexus mod and collection links in their old and new forms, nxm:// links, and bare ids. */
export function parseNexusInput(input: string, defaultDomain: string): NexusInput | null {
  const s = input.trim()
  if (/^\d+$/.test(s)) return { kind: 'mod', domain: defaultDomain, modId: Number(s) }
  const col =
    s.match(/nexusmods\.com\/(?:games\/)?([\w-]+)\/collections\/([\w-]+)(?:\/revisions\/(\d+))?/i) ??
    s.match(/^nxm:\/\/([\w-]+)\/collections\/([\w-]+)(?:\/revisions\/(\d+))?/i)
  if (col) return { kind: 'collection', domain: col[1].toLowerCase(), slug: col[2], revision: col[3] ? Number(col[3]) : undefined }
  const mod = s.match(/nexusmods\.com\/(?:games\/)?([\w-]+)\/mods\/(\d+)/i) ?? s.match(/^nxm:\/\/([\w-]+)\/mods\/(\d+)/i)
  if (mod) {
    const file = s.match(/[?&]file_id=(\d+)/i) ?? s.match(/\/files\/(\d+)/i)
    return { kind: 'mod', domain: mod[1].toLowerCase(), modId: Number(mod[2]), fileId: file ? Number(file[1]) : undefined }
  }
  return null
}

interface V1Mod {
  mod_id: number
  name?: string
  summary?: string
  description?: string
  version?: string
  author?: string
  updated_timestamp?: number
  created_timestamp?: number
  available?: boolean
  status?: string
}

interface V1File {
  file_id: number
  name?: string
  version?: string
  category_name?: string | null
  uploaded_timestamp?: number
  is_primary?: boolean
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Small Nexus Mods API client. Uses the v1 REST API for mods and files and the v2 GraphQL API for
 * collections. Responses are cached on disk for a few hours to stay well inside the rate limits.
 */
export class NexusClient {
  constructor(
    private apiKey: string | undefined,
    private cacheDir: string,
    private fetchImpl: typeof fetch,
    private appVersion: string
  ) {}

  get hasKey(): boolean {
    return !!this.apiKey
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.apiKey ?? '',
      accept: 'application/json',
      'Application-Name': 'Patchwright',
      'Application-Version': this.appVersion
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const file = path.join(this.cacheDir, `${key.replace(/[^\w.-]/g, '_')}.json`)
    const hit = await readJson<{ at: number; data: T } | null>(file, null)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data
    const data = await load()
    await writeJson(file, { at: Date.now(), data }).catch(() => {})
    return data
  }

  private async get<T>(url: string): Promise<T> {
    if (!this.apiKey) throw new Error('Nexus API key is not set (Settings > Nexus Mods).')
    const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) })
    if (res.status === 429) throw new Error('Nexus rate limit reached. Try again later.')
    if (!res.ok) throw new Error(`Nexus API returned HTTP ${res.status} for ${url}`)
    return (await res.json()) as T
  }

  async validate(): Promise<{ name: string; premium: boolean }> {
    const r = await this.get<{ name: string; is_premium?: boolean }>('https://api.nexusmods.com/v1/users/validate.json')
    return { name: r.name, premium: !!r.is_premium }
  }

  getModRaw(domain: string, modId: number): Promise<V1Mod> {
    return this.cached(`mod-${domain}-${modId}`, () => this.get<V1Mod>(`https://api.nexusmods.com/v1/games/${domain}/mods/${modId}.json`))
  }

  getFilesRaw(domain: string, modId: number): Promise<{ files: V1File[] }> {
    return this.cached(`files-${domain}-${modId}`, () =>
      this.get<{ files: V1File[] }>(`https://api.nexusmods.com/v1/games/${domain}/mods/${modId}/files.json`)
    )
  }

  async getModInfo(domain: string, modId: number, installedFileId: number | undefined, patchVersion: string | undefined): Promise<NexusModInfo> {
    const [mod, files] = await Promise.all([this.getModRaw(domain, modId), this.getFilesRaw(domain, modId).catch(() => ({ files: [] }))])
    return buildModInfo(domain, mod, files.files, installedFileId, patchVersion)
  }

  /** Lists the mods in a collection revision (the latest published one when no revision is given). */
  async getCollection(domain: string, slug: string, revision?: number): Promise<{ info: CollectionInfo; mods: ModRef[] }> {
    if (!this.apiKey) throw new Error('Nexus API key is not set (Settings > Nexus Mods).')
    const query = `query CollectionRevisionMods($revision: Int, $slug: String!, $viewAdultContent: Boolean) {
      collectionRevision(revision: $revision, slug: $slug, viewAdultContent: $viewAdultContent) {
        revisionNumber
        collection { name }
        modFiles { fileId optional file { fileId name version mod { modId name version game { domainName } } } }
      }
    }`
    const data = await this.cached(`collection-${slug}-${revision ?? 'latest'}`, async () => {
      const res = await this.fetchImpl('https://api.nexusmods.com/v2/graphql', {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { slug, revision: revision ?? null, viewAdultContent: true } }),
        signal: AbortSignal.timeout(30_000)
      })
      if (!res.ok) throw new Error(`Nexus GraphQL returned HTTP ${res.status}`)
      const body = (await res.json()) as { data?: { collectionRevision?: GqlRevision }; errors?: { message: string }[] }
      if (body.errors?.length && !body.data?.collectionRevision) throw new Error(`Nexus GraphQL: ${body.errors.map((e) => e.message).join('; ')}`)
      return body.data?.collectionRevision ?? null
    })
    if (!data) throw new Error(`Collection ${slug} was not found.`)
    const mods: ModRef[] = []
    for (const mf of data.modFiles ?? []) {
      const m = mf.file?.mod
      if (!m) continue
      if (m.game?.domainName && m.game.domainName !== domain) continue
      mods.push({
        key: `nexus:${m.modId}`,
        name: m.name ?? `Mod ${m.modId}`,
        nexusModId: m.modId,
        nexusFileId: mf.fileId ?? mf.file?.fileId,
        version: mf.file?.version ?? m.version,
        source: 'collection',
        optional: !!mf.optional
      })
    }
    return {
      info: { slug, domain, name: data.collection?.name, revision: data.revisionNumber, modCount: mods.length },
      mods
    }
  }
}

interface GqlRevision {
  revisionNumber?: number
  collection?: { name?: string }
  modFiles?: {
    fileId?: number
    optional?: boolean
    file?: { fileId?: number; name?: string; version?: string; mod?: { modId: number; name?: string; version?: string; game?: { domainName?: string } } }
  }[]
}

const iso = (ts?: number): string | undefined => (ts ? new Date(ts * 1000).toISOString() : undefined)

const COMPAT_WORDS =
  /(compatib|not working|doesn'?t work|broken|outdated|needs? (an )?update|waiting (on|for)|works? (with|on)|updated for|patch|version)/i

/** Sentences from the description and summary that talk about game versions or compatibility. */
export function compatibilityMentions(text: string, patchVersion?: string): string[] {
  const clean = stripBbcode(text)
  const sentences = clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 6 && s.length < 400)
  const ver = patchVersion ? new RegExp(`(^|[^\\d.])${patchVersion.replace('.', '\\.')}(?![\\d])`) : null
  const out: string[] = []
  for (const s of sentences) {
    if ((ver && ver.test(s)) || (COMPAT_WORDS.test(s) && /\d\.\d/.test(s))) out.push(s)
    if (out.length >= 8) break
  }
  return out
}

export function buildModInfo(
  domain: string,
  mod: V1Mod,
  files: V1File[],
  installedFileId: number | undefined,
  patchVersion: string | undefined
): NexusModInfo {
  // Only files that are current releases count as "latest"; archived and old versions don't.
  const current = files.filter((f) => !['OLD_VERSION', 'ARCHIVED', 'DELETED'].includes((f.category_name ?? '').toUpperCase()))
  const latest = [...current].sort((a, b) => (b.uploaded_timestamp ?? 0) - (a.uploaded_timestamp ?? 0))[0]
  const installed = installedFileId ? files.find((f) => f.file_id === installedFileId) : undefined
  return {
    modId: mod.mod_id,
    name: mod.name ?? `Mod ${mod.mod_id}`,
    version: mod.version,
    author: mod.author,
    summary: mod.summary,
    url: `https://www.nexusmods.com/${domain}/mods/${mod.mod_id}`,
    updatedAt: iso(mod.updated_timestamp),
    latestFileDate: iso(latest?.uploaded_timestamp),
    latestFileVersion: latest?.version,
    installedFileDate: iso(installed?.uploaded_timestamp),
    installedFileVersion: installed?.version,
    descriptionMentions: compatibilityMentions(`${mod.summary ?? ''}\n${mod.description ?? ''}`, patchVersion),
    available: mod.available !== false && mod.status !== 'hidden' && mod.status !== 'removed'
  }
}
