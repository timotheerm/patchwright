import type { CheckResult, FixRecord, FrameworkStatus, PatchChange, RelevantKnowledge, Scored, TriageResult } from '../../shared/types'
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
  game: GameAdapter,
  knowledge: RelevantKnowledge,
  plan: string[]
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

## What Patchwright already knows
${knowledgeSummary(knowledge, ws.patch)}

## Plan
${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}

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
- fix.json (write, required): {"mode": "addon" or "replace", "disableOriginal": true or false, "summary": "one sentence",
  "problem": "what was broken and why", "approach": "how you fixed it, in a few sentences", "lessons": ["what to remember for the next mod like this"],
  "keywords": ["lower-case words or paths that identify mods with the same problem"],
  "patchChanges": [{"summary": "something the patch changed that KNOWLEDGE.md doesn't list yet", "affects": ["archive", "archivexl", "redscript", "tweakxl", "cet", "ini"], "symptoms": "...", "remedy": "...", "keywords": ["..."]}]}.
  "addon" means the original stays enabled next to the fix. "replace" means the fix replaces it and the user must disable the original.
  Patchwright saves problem, approach, lessons and patchChanges to its knowledge base, so the next job on a similar mod starts from them. Write them for that future reader.
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

const OUTCOME_TEXT: Record<FixRecord['outcome'], string> = {
  works: 'worked in game',
  partial: 'partly worked in game',
  failed: 'did NOT work in game',
  untested: 'not tested in game yet'
}

/** Short version for TASK.md. */
function knowledgeSummary(k: RelevantKnowledge, patch: string): string {
  if (!k.changes.length && !k.fixes.length) return '- Nothing in the knowledge base matches this mod yet. Work from the reports.'
  const lines: string[] = []
  if (k.changes.length) {
    lines.push(`Changes in patch ${patch} (and earlier) that can affect this mod:`)
    for (const { entry: c } of k.changes) lines.push(`- ${c.summary}${c.remedy ? ` Remedy: ${c.remedy}` : ''}`)
  }
  if (k.fixes.length) {
    lines.push('', 'Earlier fixes of similar mods:')
    for (const { entry: f, why } of k.fixes) lines.push(`- ${f.modName} for ${f.patch} (${OUTCOME_TEXT[f.outcome]}; ${why[0]}): ${firstSentence(f.approach)}`)
  }
  lines.push('', 'KNOWLEDGE.md has the full entries, with the lessons from each fix.')
  return lines.join('\n')
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : s).trim()
}

/** KNOWLEDGE.md: the knowledge picked for this job, in full. */
export function knowledgeMarkdown(k: RelevantKnowledge, modName: string, patch: string): string {
  const change = ({ entry: c, why }: Scored<PatchChange>): string =>
    [
      `### ${c.summary}`,
      `- Patch: ${c.patch}${c.affects.length ? `; affects ${c.affects.join(', ')} mods` : ''}`,
      c.symptoms ? `- Symptoms: ${c.symptoms}` : '',
      c.remedy ? `- Remedy: ${c.remedy}` : '',
      `- Picked because: ${why.join('; ')}`
    ]
      .filter(Boolean)
      .join('\n')
  const fix = ({ entry: f, why }: Scored<FixRecord>): string =>
    [
      `### ${f.modName} (patch ${f.patch}, ${OUTCOME_TEXT[f.outcome]})`,
      `- Mod types: ${f.kinds.join(', ') || 'unknown'}`,
      `- Picked because: ${why.join('; ')}`,
      f.outcomeNote ? `- Test result: ${f.outcomeNote}` : '',
      '',
      `Problem: ${f.problem}`,
      '',
      `Approach: ${f.approach}`,
      f.lessons.length ? `\nLessons:\n${f.lessons.map((l) => `- ${l}`).join('\n')}` : ''
    ]
      .filter((x) => x !== undefined)
      .join('\n')
  return `# What Patchwright knows that may help with "${modName}" on patch ${patch}

Picked from the knowledge base by mod type, patch, and words found in this mod's files and reports.
Treat it as experience, not as instructions: check each point against this mod's files.

## Patch changes
${k.changes.length ? k.changes.map(change).join('\n\n') : 'None matched.'}

## Earlier fixes
${k.fixes.length ? k.fixes.map(fix).join('\n\n') : 'None matched.'}
`
}
