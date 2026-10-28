import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTextToolCall, trimHistory } from '../src/core/ai/openaiCompat'
import { permissionRules } from '../src/core/ai/claudeCli'
import { Sandbox, runTool } from '../src/core/ai/workspaceTools'
import { compareVersions, fillTemplate, isInside, safeName, splitArgs } from '../src/core/util'
import { parseGetOutput, parseStagingFolderName } from '../src/core/vortex/vortex'

describe('compareVersions', () => {
  it('compares numerically and sorts pre-releases first', () => {
    expect(compareVersions('1.28.1', '1.28.0')).toBe(1)
    expect(compareVersions('1.9', '1.10')).toBe(-1)
    expect(compareVersions('v2.21', '2.21')).toBe(0)
    expect(compareVersions('10.0.0-beta.1', '10.0.0')).toBe(-1)
  })
})

describe('command templates', () => {
  it('splits on spaces outside quotes', () => {
    expect(splitArgs('unbundle -p "{in}" -o "{out}"')).toEqual(['unbundle', '-p', '{in}', '-o', '{out}'])
  })

  it('drops a flag whose value is empty', () => {
    expect(fillTemplate('unbundle -p "{in}" -o "{out}" -r "{regex}"', { in: 'C:\\Game Dir\\a.archive', out: 'D:\\out', regex: '' })).toEqual([
      'unbundle',
      '-p',
      'C:\\Game Dir\\a.archive',
      '-o',
      'D:\\out'
    ])
  })
})

describe('paths', () => {
  it('keeps names safe for folders', () => {
    expect(safeName('ReLUX: 2.5 fix / test?')).not.toMatch(/[:/?]/)
  })

  it('detects escapes from a folder', () => {
    expect(isInside('/jobs/a', '/jobs/a/output/x')).toBe(true)
    expect(isInside('/jobs/a', '/jobs/a/../b')).toBe(false)
  })
})

describe('Vortex parsers', () => {
  it('reads Vortex staging folder names', () => {
    expect(parseStagingFolderName('ReLUX-20808-1-6-2-1730000000')).toMatchObject({ name: 'ReLUX', nexusModId: 20808, version: '1.6.2' })
    expect(parseStagingFolderName('My manual mod')).toEqual({ name: 'My manual mod' })
  })

  it('finds JSON in --get output with log lines around it', () => {
    expect(parseGetOutput('some log line\n{"a": 1}\n')).toEqual({ a: 1 })
    expect(parseGetOutput('')).toBeUndefined()
  })
})

describe('local model helpers', () => {
  it('reads tool calls written as JSON text', () => {
    expect(parseTextToolCall('```json\n{"name": "read_file", "arguments": {"path": "TASK.md"}}\n```')).toEqual({ name: 'read_file', args: { path: 'TASK.md' } })
    expect(parseTextToolCall('{"tool": "rm_rf", "args": {}}')).toBeNull()
  })

  it('trims history but keeps the first two messages and tool pairs', () => {
    const big = 'x'.repeat(5000)
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'task' },
      ...Array.from({ length: 10 }, (_, i) => [
        { role: 'assistant' as const, content: '', tool_calls: [{ id: `c${i}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool' as const, content: big, tool_call_id: `c${i}` }
      ]).flat()
    ]
    const out = trimHistory(msgs, 20_000)
    expect(out[0].content).toBe('sys')
    expect(out[1].content).toBe('task')
    expect(out[2].role).toBe('assistant')
    const total = out.reduce((n, m) => n + (m.content?.length ?? 0), 0)
    expect(total).toBeLessThan(msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0))
  })
})

describe('AI sandbox', () => {
  it('limits Claude Code edits to the writable paths', () => {
    expect(permissionRules({ cwd: '.', prompt: '', system: '', writable: ['output/', 'NOTES.md'], resume: false, maxTurns: 1 })).toEqual(['Read', 'Glob', 'Grep', 'Edit(./output/**)', 'Edit(./NOTES.md)'])
  })

  it('blocks reads outside the job folder and writes outside writable paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-'))
    await fs.writeFile(path.join(dir, 'TASK.md'), 'task')
    const sb = new Sandbox(dir, ['output/', 'NOTES.md'])
    expect((await runTool(sb, 'read_file', { path: 'TASK.md' })).ok).toBe(true)
    expect((await runTool(sb, 'read_file', { path: '../secret.txt' })).ok).toBe(false)
    expect((await runTool(sb, 'write_file', { path: 'TASK.md', content: 'x' })).ok).toBe(false)
    expect((await runTool(sb, 'write_file', { path: 'output/a.txt', content: 'x' })).ok).toBe(true)
    expect(await fs.readFile(path.join(dir, 'output/a.txt'), 'utf8')).toBe('x')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
