import { spawn } from 'node:child_process'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const nowIso = (): string => new Date().toISOString()

export const toPosix = (p: string): string => p.replace(/\\/g, '/')

export async function exists(p: string | undefined): Promise<boolean> {
  if (!p) return false
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

export async function ensureDir(p: string): Promise<string> {
  await fs.mkdir(p, { recursive: true })
  return p
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

export async function writeJson(p: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(p))
  const tmp = `${p}.tmp-${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, p)
}

export interface WalkEntry {
  rel: string // posix-style, relative to the walk root
  abs: string
  size: number
  mtimeMs: number
}

/** Recursively lists files under `root`. Skips symlinks. */
export async function walk(root: string, limit = 50_000): Promise<WalkEntry[]> {
  const out: WalkEntry[] = []
  async function rec(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) return
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await rec(abs)
      else if (e.isFile()) {
        const st = await fs.stat(abs)
        out.push({ rel: toPosix(path.relative(root, abs)), abs, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await rec(root)
  return out
}

export async function copyDir(src: string, dest: string, filter?: (rel: string) => boolean): Promise<number> {
  const files = await walk(src)
  let n = 0
  for (const f of files) {
    if (filter && !filter(f.rel)) continue
    const target = path.join(dest, ...f.rel.split('/'))
    await ensureDir(path.dirname(target))
    await fs.copyFile(f.abs, target)
    n++
  }
  return n
}

/** Moves a path, falling back to copy + delete across drives. */
export async function movePath(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest))
  try {
    await fs.rename(src, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.cp(src, dest, { recursive: true })
    await fs.rm(src, { recursive: true, force: true })
  }
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function shortId(len = 8): string {
  return crypto.randomBytes(16).toString('base64url').replace(/[-_]/g, '').slice(0, len)
}

export function timestampSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

/** Makes a string safe for use as a Windows file or folder name. */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
}

/**
 * Compares dotted versions like "1.28.1", "v2.21", "10.0.0-beta.1".
 * Numeric segments compare as numbers; a pre-release suffix sorts before the release.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const clean = v.trim().replace(/^v/i, '')
    const [main, ...preParts] = clean.split('-')
    return { nums: main.split('.').map((x) => parseInt(x, 10) || 0), pre: preParts.join('-') }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  if (pa.pre && !pb.pre) return -1
  if (!pa.pre && pb.pre) return 1
  return pa.pre.localeCompare(pb.pre)
}

export function dateOnly(iso: string | undefined): string | undefined {
  return iso ? iso.slice(0, 10) : undefined
}

/** Splits a command template into argv, honouring double quotes. */
export function splitArgs(template: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let has = false
  for (const ch of template) {
    if (ch === '"') {
      quoted = !quoted
      has = true
    } else if (ch === ' ' && !quoted) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/**
 * Fills {placeholders} in each argument of a template. An option whose value comes out empty is
 * dropped together with its flag, so `-r "{regex}"` disappears when no regex is given.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string[] {
  const out: string[] = []
  for (const arg of splitArgs(template)) {
    const filled = arg.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    if (filled === '') {
      if (out.length > 0 && out[out.length - 1].startsWith('-')) out.pop()
      continue
    }
    out.push(filled)
  }
  return out
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  signal?: AbortSignal
  input?: string
  shell?: boolean
}

/** Runs a program without a shell and collects its output. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        windowsHide: true,
        shell: opts.shell ?? false
      })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e), timedOut: false })
      return
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : undefined
    const onAbort = (): void => {
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const pipe = (stream: 'stdout' | 'stderr') => {
      let buf = ''
      return (chunk: Buffer): void => {
        const text = chunk.toString('utf8')
        if (stream === 'stdout') stdout += text
        else stderr += text
        if (!opts.onLine) return
        buf += text
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const l of lines) opts.onLine(l, stream)
      }
    }
    child.stdout?.on('data', pipe('stdout'))
    child.stderr?.on('data', pipe('stderr'))
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    } else {
      child.stdin?.end()
    }
    child.on('error', (e) => {
      stderr += String(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/** Reads the FileVersion from a Windows PE file's VS_FIXEDFILEINFO block. */
export async function readPeFileVersion(file: string): Promise<string | undefined> {
  let data: Buffer
  try {
    data = await fs.readFile(file)
  } catch {
    return undefined
  }
  // VS_FIXEDFILEINFO starts with the signature 0xFEEF04BD (little endian: BD 04 EF FE).
  const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe])
  const at = data.indexOf(sig)
  if (at < 0 || at + 16 > data.length) return undefined
  const ms = data.readUInt32LE(at + 8)
  const ls = data.readUInt32LE(at + 12)
  const parts = [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff]
  while (parts.length > 3 && parts[parts.length - 1] === 0) parts.pop()
  return parts.join('.')
}

/** Reads the first `maxBytes` of a text file. */
export async function readHead(file: string, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const s = createReadStream(file, { start: 0, end: maxBytes - 1, encoding: 'utf8' })
    s.on('data', (c) => (out += c))
    s.on('end', () => resolve(out))
    s.on('error', () => resolve(''))
  })
}

/** Reads the last `maxBytes` of a text file. */
export async function readTail(file: string, maxBytes = 512 * 1024): Promise<string> {
  try {
    const st = await fs.stat(file)
    const start = Math.max(0, st.size - maxBytes)
    const fh = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(st.size - start)
      await fh.read(buf, 0, buf.length, start)
      return buf.toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… (${s.length - max} more characters cut)`
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/** Strips Nexus BBCode tags. */
export function stripBbcode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[\/?(?:b|i|u|s|center|right|left|size|color|font|url|img|quote|code|spoiler|list|\*|line|heading|youtube)[^\]]*\]/gi, ' ')
    .replace(/[ \t]+/g, ' ')
}
