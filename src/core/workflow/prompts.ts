import type { CheckResult, FrameworkStatus, TriageResult } from '../../shared/types'
import type { GameAdapter, JobWorkspace } from '../games/types'

export const WRITABLE = ['output/', 'src/', 'recipe.json', 'requests.json', 'fix.json', 'NOTES.md']

/** Standing instructions for every round of a job. Identical across rounds, so it can be cached. */
export function systemPrompt(game: GameAdapter): string {
  return `You are the mod-update agent inside Patchwright, a desktop app that updates ${game.name} mods after a game patch.
You update one mod per job by writing a separate fix mod. You only read and write files inside the job folder, through the tools you have.
You can't run programs. Patchwright runs the tools (unpacking, packing, compiling, checking) between your turns and reports results in FEEDBACK.md.
Work carefully and minimally. When you are unsure, say so in NOTES.md instead of guessing silently.

${game.playbook}`
}

function checkLines(checks: CheckResult[]): string[] {
  if (!checks.length) return ['- No checks ran.']
  return checks.flatMap((c) => [`- [${c.status.toUpperCase()}] ${c.label}`, ...c.details.slice(0, 12).map((d) => `  - ${d}`)])
}

/** The task description for round one, written to TASK.md in the job folder. */
export function taskMarkdown(
  ws: JobWorkspace,
  t: TriageResult,
  prepChecks: CheckResult[],
  frameworks: FrameworkStatus[],
  dependents: string[],
  game: GameAdapter
): string {
  const n = t.nexus
  const c = ws.classification
  const files = c.files.slice(0, 250).map((f) => `- original/${f.relPath} (${f.kind}, ${f.size} bytes)`)
  if (c.files.length > 250) files.push(`- … and ${c.files.length - 250} more`)
  const fw = c.frameworksUsed
    .map((id) => frameworks.find((f) => f.id === id))
    .filter((f): f is FrameworkStatus => !!f)
    .map((f) => `- ${f.name}: ${f.installed ? `installed ${f.installedVersion ?? '(version unknown)'}` : 'not installed'}, status ${f.state}${f.note ? ` (${f.note})` : ''}`)

  return `# Task: update "${ws.modName}" for ${game.name} ${ws.patch}

Make "${ws.modName}" work on game patch ${ws.patch} by writing a separate fix mod named "${ws.fixName}".
Don't change anything in original/, unpacked/ or vanilla/.

## The mod
- Nexus: ${n ? `${n.url} (version ${n.version ?? '?'}, last release ${n.latestFileDate?.slice(0, 10) ?? n.updatedAt?.slice(0, 10) ?? '?'})` : 'no Nexus data'}
- Installed version: ${t.mod.version ?? n?.installedFileVersion ?? 'unknown'}
- Contents: ${c.kinds.join(', ')}; risk ${c.risk}
${c.notes.map((x) => `- ${x}`).join('\n')}

### Files
${files.join('\n')}

### Frameworks it uses
${fw.length ? fw.join('\n') : '- None detected'}

## What triage found
- Verdict: ${t.verdict}
${t.reasons.map((r) => `- ${r}`).join('\n')}
${t.community ? `- User reports on ${ws.patch}: ${t.community.works} say it works, ${t.community.broken} say it's broken.${t.community.summary ? ` ${t.community.summary}` : ''}` : ''}
${(t.community?.snippets ?? []).slice(0, 8).map((s) => `  - (${s.verdict}) "${s.text}"`).join('\n')}

## Checks already run
${checkLines([...t.checks, ...prepChecks]).join('\n')}

Read the reports in reports/ first: they hold compile output, log lines, and diffs between the mod's files and the new vanilla files.

## Other mods that depend on this one
${dependents.length ? dependents.map((d) => `- ${d}`).join('\n') + '\nKeep every name listed here exactly as it is.' : '- None found among the installed mods.'}

## Folders
- original/: the mod as installed, laid out like the game folder. Read only.
- unpacked/<archive>/: the mod's archives unpacked; .json files are editable JSON forms of game files. unpacked/raw/ holds the binary files.
- vanilla/: files from the current game version, with a .json next to each convertible file. Sector node tables are in *.nodes.tsv.
- reports/: triage, check results, compile output, log lines, asset diffs.
- output/ (write): loose files of the fix, laid out like the game folder: r6/scripts/<folder>/*.reds, r6/tweaks/*.yaml, archive/pc/mod/*.xl, bin/x64/plugins/cyber_engine_tweaks/mods/<name>/*.lua, engine/config/...
- src/archives/<ArchiveName>/ (write): JSON game files (WolvenKit format, path + ".json") that Patchwright packs into archive/pc/mod/<ArchiveName>.archive. Start new archive names with "!!" so they load before the original.
- recipe.json (write): for many asset files that are vanilla (or the mod's) files with small edits. Format below.
- requests.json (write): ask for more vanilla files, then end your turn: {"vanilla": ["base\\\\path\\\\file.ent"], "vanillaRegex": ["regex over depot paths"]}
- fix.json (write, required): {"mode": "addon" or "replace", "disableOriginal": true or false, "summary": "one sentence"}. "addon" means the original stays enabled next to the fix. "replace" means the fix replaces it and the user must disable the original.
- NOTES.md (write, required): for the user, in plain words: what was broken, what you changed, what you couldn't fix, and a short in-game test (where to go, what should happen).

## recipe.json format
{"archives": [{"name": "!!${ws.fixName.replace(/[^\w]/g, '')}", "files": [
  {"to": "base/path/new_file.ent", "from": "vanilla:base/path/file.ent.json",
   "ops": [{"op": "set", "path": "Data.RootChunk.components[name=deformations].rig.DepotPath.$value", "value": "base\\\\path\\\\rig"}]}
]}]}
"from" starts with vanilla:, mod: (unpacked/) or src:. Ops: set, remove, append. Path syntax: dot keys, [3] index, [key=value] first match (also matches key.$value), [*] all items.

## When you're done
End your turn with a short summary. Patchwright then packs archives, compiles scripts against your installed scripts, parses YAML, checks sector edits, and writes FEEDBACK.md if anything fails. You'll then get another round.
`
}

export function feedbackMarkdown(round: number, results: CheckResult[], extra: string[] = []): string {
  return `# Feedback after round ${round}

Some checks failed. Fix these, then end your turn again.

${checkLines(results).join('\n')}
${extra.length ? `\n${extra.join('\n')}\n` : ''}`
}
