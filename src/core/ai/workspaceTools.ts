import path from 'node:path'
import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { ensureDir, isInside, toPosix, walk } from '../util'

/**
 * File tools for backends that run their own tool loop (Claude API, local LLMs). Every path is
 * model output, so it is resolved inside the job folder and writes are limited to `writable`.
 */
export class Sandbox {
  readonly root: string
  constructor(
    root: string,
    private writable: string[]
  ) {
    this.root = path.resolve(root)
  }

  resolve(p: string): string {
    const abs = path.resolve(this.root, p.replace(/^[/\\]+/, ''))
    if (!isInside(this.root, abs)) throw new Error(`Path is outside the job folder: ${p}`)
    return abs
  }

  canWrite(abs: string): boolean {
    const rel = toPosix(path.relative(this.root, abs))
    return this.writable.some((w) => (w.endsWith('/') ? rel.startsWith(w) : rel === w))
  }

  resolveWrite(p: string): string {
    const abs = this.resolve(p)
    if (!this.canWrite(abs)) throw new Error(`Writing ${p} isn't allowed. You may write: ${this.writable.join(', ')}`)
    return abs
  }
}

const MAX_READ_CHARS = 120_000

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  schema: S
  jsonSchema: Record<string, unknown>
  run(sb: Sandbox, input: z.infer<S>): Promise<string>
}

function def<S extends z.ZodTypeAny>(d: ToolDef<S>): ToolDef<S> {
  return d
}

export const WORKSPACE_TOOLS: ToolDef[] = [
  def({
    name: 'list_files',
    description: 'List files under a folder of the job (recursive). Use "." for the whole job.',
    schema: z.object({ dir: z.string().default('.') }),
    jsonSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Folder relative to the job root' } }, required: [] },
    async run(sb, { dir }) {
      const files = await walk(sb.resolve(dir ?? '.'), 2000)
      const lines = files.filter((f) => !f.rel.startsWith('.ai/')).map((f) => `${f.rel}\t${f.size}`)
      return lines.length > 600 ? `${lines.slice(0, 600).join('\n')}\n… ${lines.length - 600} more. List a subfolder.` : lines.join('\n') || '(empty)'
    }
  }),
  def({
    name: 'read_file',
    description: 'Read a text file with line numbers. Large files: pass offset (first line, 1-based) and limit (number of lines).',
    schema: z.object({ path: z.string(), offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(5000).optional() }),
    jsonSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
      required: ['path']
    },
    async run(sb, { path: p, offset, limit }) {
      const text = await fs.readFile(sb.resolve(p), 'utf8')
      const lines = text.split(/\r?\n/)
      const start = (offset ?? 1) - 1
      const slice = lines.slice(start, start + (limit ?? 2000))
      let out = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n')
      if (out.length > MAX_READ_CHARS) out = `${out.slice(0, MAX_READ_CHARS)}\n… cut; read a smaller range`
      const more = start + slice.length < lines.length ? `\n… ${lines.length - start - slice.length} more lines` : ''
      return out + more
    }
  }),
  def({
    name: 'search',
    description: 'Search file contents with a regular expression. Optional dir and extension (e.g. ".reds").',
    schema: z.object({ pattern: z.string(), dir: z.string().optional(), extension: z.string().optional() }),
    jsonSchema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, dir: { type: 'string' }, extension: { type: 'string' } },
      required: ['pattern']
    },
    async run(sb, { pattern, dir, extension }) {
      const re = new RegExp(pattern, 'i')
      const files = await walk(sb.resolve(dir ?? '.'), 20_000)
      const hits: string[] = []
      for (const f of files) {
        if (extension && !f.rel.toLowerCase().endsWith(extension.toLowerCase())) continue
        if (f.size > 8_000_000 || f.rel.includes('/raw/')) continue
        const text = await fs.readFile(f.abs, 'utf8').catch(() => '')
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`${toPosix(path.relative(sb.root, f.abs))}:${i + 1}: ${lines[i].trim().slice(0, 300)}`)
          if (hits.length >= 200) return `${hits.join('\n')}\n… stopped at 200 matches`
        }
      }
      return hits.join('\n') || 'No matches'
    }
  }),
  def({
    name: 'write_file',
    description: 'Create or overwrite a file. Only allowed in the folders the task names.',
    schema: z.object({ path: z.string(), content: z.string() }),
    jsonSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async run(sb, { path: p, content }) {
      const abs = sb.resolveWrite(p)
      await ensureDir(path.dirname(abs))
      await fs.writeFile(abs, content, 'utf8')
      return `Wrote ${p} (${content.length} characters)`
    }
  }),
  def({
    name: 'edit_file',
    description: 'Replace one exact, unique piece of text in a file you may write.',
    schema: z.object({ path: z.string(), old_text: z.string().min(1), new_text: z.string() }),
    jsonSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
      required: ['path', 'old_text', 'new_text']
    },
    async run(sb, { path: p, old_text, new_text }) {
      const abs = sb.resolveWrite(p)
      const text = await fs.readFile(abs, 'utf8')
      const count = text.split(old_text).length - 1
      if (count !== 1) throw new Error(count === 0 ? 'old_text was not found' : `old_text appears ${count} times; include more context`)
      await fs.writeFile(abs, text.replace(old_text, () => new_text), 'utf8')
      return `Edited ${p}`
    }
  }),
  def({
    name: 'copy_file',
    description: 'Copy a file (for example a vanilla or original file) to a place you may write, before editing it.',
    schema: z.object({ from: z.string(), to: z.string() }),
    jsonSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    async run(sb, { from, to }) {
      const src = sb.resolve(from)
      const dest = sb.resolveWrite(to)
      await ensureDir(path.dirname(dest))
      await fs.copyFile(src, dest)
      return `Copied ${from} to ${to}`
    }
  })
]

export async function runTool(sb: Sandbox, name: string, input: unknown): Promise<{ ok: boolean; output: string }> {
  const tool = WORKSPACE_TOOLS.find((t) => t.name === name)
  if (!tool) return { ok: false, output: `Unknown tool ${name}` }
  const parsed = tool.schema.safeParse(input ?? {})
  if (!parsed.success) return { ok: false, output: `Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}` }
  try {
    return { ok: true, output: await tool.run(sb, parsed.data) }
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

export function describeToolCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const arg = i.path ?? i.file_path ?? i.dir ?? i.pattern ?? i.from ?? i.url ?? ''
  return `${name} ${String(arg)}`.trim()
}
