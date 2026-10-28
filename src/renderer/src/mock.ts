// Demo data for running the UI in a plain browser (npm run preview:web). Nothing here touches a PC.
// Mod names and Nexus ids are real, but every verdict, date and version below is sample data.
import type { PatchwrightApi } from '../../shared/api'
import type {
  AppEvent,
  ChangelogEntry,
  Classification,
  CollectionInfo,
  FrameworkStatus,
  GameStatus,
  JobState,
  JobStep,
  LogFinding,
  LogLine,
  ModKind,
  ModRef,
  Settings,
  FixRecord,
  KnowledgeBase,
  PatchChange,
  RelevantKnowledge,
  TriageResult
} from '../../shared/types'
import { CYBERPUNK_KNOWLEDGE } from '../../core/games/cyberpunk2077/knowledge'
import { queryFromTriage, selectKnowledge } from '../../core/knowledge/match'

const PATCH = { version: '2.5', releaseDate: '2026-10-22', title: 'Cyberpunk 2077 Update 2.5', source: 'bundled' as const }
const STAGING = 'D:\\Vortex Mods\\cyberpunk2077'
const BACKUPS = 'C:\\Users\\Tim\\Downloads\\CP2077 backups'
const JOBS_DIR = 'C:\\Users\\Tim\\Documents\\Patchwright\\jobs'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const now = (): string => new Date().toISOString()
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString()

function cls(kinds: ModKind[], files: number, extra: Partial<Classification> = {}): Classification {
  return {
    kinds,
    files: Array.from({ length: files }, (_, i) => ({ relPath: `file${i}`, kind: kinds[i % kinds.length], size: 1000 })),
    frameworksUsed: [],
    risk: 'medium',
    aiFixable: true,
    notes: [],
    ...extra
  }
}

function mod(name: string, nexusModId: number | undefined, version: string): ModRef {
  const folder = `${name}-${nexusModId ?? 0}-${version.replace(/\./g, '-')}-1730000000`
  return { key: folder, name, nexusModId, version, vortexId: folder, stagingPath: `${STAGING}\\${folder}`, enabled: true, source: 'vortex' }
}

function nexusInfo(m: ModRef, latestDate: string, latestVersion: string, installedDate: string, mentions: string[] = []) {
  return {
    modId: m.nexusModId!,
    name: m.name,
    version: latestVersion,
    url: `https://www.nexusmods.com/cyberpunk2077/mods/${m.nexusModId}`,
    updatedAt: latestDate,
    latestFileDate: latestDate,
    latestFileVersion: latestVersion,
    installedFileDate: installedDate,
    installedFileVersion: m.version,
    descriptionMentions: mentions,
    available: true
  }
}

const SP0 = mod('SP0 Body Mod 2.0', 1424, '2.0.3')
const RELUX = mod('ReLUX', 20808, '1.6.2')
const REIMAGINED = mod('ReImagined', 25845, '1.4.0')
const LODS = mod('Improved Environment LODs', 4923, '1.2')
const AMM = mod('Appearance Menu Mod', 790, '2.8.4')
const HUD = mod('Neon Nights HUD', undefined, '0.9')
const CROWD = mod('Crowd Density Plugin', undefined, '1.1')
const ARCHIVEXL = mod('ArchiveXL', 4198, '1.28.1')
const CODEWARE = mod('Codeware', 7780, '1.21.1')

const RESULTS: TriageResult[] = [
  {
    mod: RELUX,
    nexus: nexusInfo(RELUX, '2026-03-02', '1.6.2', '2026-03-02'),
    classification: cls(['archive', 'archivexl'], 38, {
      frameworksUsed: ['archivexl'],
      risk: 'high',
      notes: ['Edits world sectors (streaming:). Sector node indexes change between patches, so these edits often stop working.']
    }),
    community: {
      checkedAt: minutesAgo(3),
      works: 1,
      broken: 6,
      source: 'keyword',
      snippets: [
        { text: 'Since 2.5 a lot of the light removals do nothing, the old lamps are back in Japantown.', verdict: 'broken' },
        { text: 'ArchiveXL log is full of "node type mismatch" lines for ReLUX after the update.', verdict: 'broken' },
        { text: 'Lighting itself still loads fine for me on 2.5.', verdict: 'works' }
      ]
    },
    checks: [
      { id: 'sectors', label: 'World edits still match the game', status: 'fail', details: ['31 of 117 sector edits point at nodes whose type changed in 2.5', 'e.g. ex_in_terior_-23_-35_0_1.streamingsector: node 412 is now worldStaticLightNode'] },
      { id: 'logs', label: 'No errors in the game logs', status: 'warn', details: ['ArchiveXL.log: 31 lines mention ReLUX'] }
    ],
    verdict: 'reported-broken',
    action: 'ai-fix',
    reasons: ['Last file was released 2 Mar 2026, before 2.5 (22 Oct 2026).', '6 posts say it is broken on 2.5, 1 says it works.', 'Its world sector edits no longer match the 2.5 sectors.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: REIMAGINED,
    nexus: nexusInfo(REIMAGINED, '2026-06-10', '1.4.0', '2026-06-10'),
    classification: cls(['archive', 'archivexl', 'redscript'], 52, { frameworksUsed: ['archivexl', 'redscript'], risk: 'high' }),
    community: { checkedAt: minutesAgo(3), works: 0, broken: 2, source: 'keyword', snippets: [{ text: 'Getting a redscript compile error popup at start since the patch.', verdict: 'broken' }] },
    checks: [
      { id: 'redscript', label: 'Scripts compile against 2.5', status: 'fail', details: ['ReImagined/Lighting.reds:88: function GetLightComponent not found on gameObject'] },
      { id: 'sectors', label: 'World edits still match the game', status: 'warn', details: ['37 of 47 prop hides point at nodes that moved'] }
    ],
    verdict: 'reported-broken',
    action: 'ai-fix',
    reasons: ['Last file was released 10 Jun 2026, before 2.5.', 'Its scripts fail to compile against the 2.5 game scripts.', 'Depends on ReLUX archive names: keep them when fixing ReLUX.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: SP0,
    nexus: nexusInfo(SP0, '2025-08-14', '2.0.3', '2025-08-14'),
    classification: cls(['archive'], 161, { risk: 'medium', notes: ['Ships 160 copies of the player entity files, which 2.5 changed.'] }),
    community: { checkedAt: minutesAgo(3), works: 2, broken: 4, source: 'keyword', snippets: [{ text: 'Reload animation is broken on female V with this on 2.5.', verdict: 'broken' }] },
    checks: [{ id: 'assets', label: 'Replaced game files still match 2.5', status: 'fail', details: ['player_ma_fpp.ent: vanilla 2.5 uses player_dualwield.animgraph, the mod still uses player_ranged.animgraph'] }],
    verdict: 'reported-broken',
    action: 'ai-fix',
    reasons: ['Last file was released 14 Aug 2025, before 2.5.', 'Its copies of the player entity files are older than 2.5 and miss the new dual-wield animations.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: AMM,
    nexus: nexusInfo(AMM, '2026-10-25', '2.9.1', '2026-05-01', ['2.9.1: updated for Cyberpunk 2.5.']),
    classification: cls(['cet'], 210, { frameworksUsed: ['cet'], risk: 'low' }),
    checks: [],
    verdict: 'update-available',
    action: 'update-in-vortex',
    reasons: ['2.9.1 was released 25 Oct 2026, after 2.5. You have 2.8.4.', 'The description says: "2.9.1: updated for Cyberpunk 2.5."'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: LODS,
    nexus: nexusInfo(LODS, '2024-11-30', '1.2', '2024-11-30'),
    classification: cls(['redscript'], 3, { frameworksUsed: ['redscript'], risk: 'medium' }),
    community: { checkedAt: minutesAgo(3), works: 0, broken: 0, source: 'keyword', snippets: [] },
    checks: [{ id: 'redscript', label: 'Scripts compile against 2.5', status: 'pass', details: [] }],
    verdict: 'not-updated',
    action: 'test-in-game',
    reasons: ['Last file was released 30 Nov 2024, before 2.5.', "Its scripts compile against 2.5, but a clean compile doesn't prove it works. Check it in game."],
    checkedAt: minutesAgo(3)
  },
  {
    mod: HUD,
    classification: cls(['redscript'], 4, { frameworksUsed: ['redscript'], risk: 'medium' }),
    checks: [{ id: 'redscript', label: 'Scripts compile against 2.5', status: 'pass', details: [] }],
    verdict: 'unknown',
    action: 'test-in-game',
    reasons: ['Not on Nexus, so there is no release date to compare.', 'Its scripts compile against 2.5, so it will probably work. Check it in game.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: CROWD,
    classification: cls(['red4ext'], 2, { risk: 'high', aiFixable: false, notes: ['A native plugin (.dll). Only its author can rebuild it.'] }),
    checks: [],
    verdict: 'binary-wait',
    action: 'wait-for-author',
    reasons: ['Native plugins are built for one game version. Wait for the author, and disable it until then.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: ARCHIVEXL,
    nexus: nexusInfo(ARCHIVEXL, '2026-10-23', '1.28.1', '2026-10-23'),
    classification: cls(['red4ext'], 3, { isFramework: 'archivexl', risk: 'high', aiFixable: false }),
    checks: [],
    verdict: 'framework',
    action: 'none',
    reasons: ['Framework. 1.28.1 supports 2.5.'],
    checkedAt: minutesAgo(3)
  },
  {
    mod: CODEWARE,
    nexus: nexusInfo(CODEWARE, '2026-10-23', '1.21.1', '2026-10-23'),
    classification: cls(['red4ext', 'redscript'], 5, { isFramework: 'codeware', risk: 'high', aiFixable: false }),
    checks: [],
    verdict: 'framework',
    action: 'none',
    reasons: ['Framework. 1.21.1 supports 2.5.'],
    checkedAt: minutesAgo(3)
  }
]

const FRAMEWORKS: FrameworkStatus[] = [
  { id: 'red4ext', name: 'RED4ext', nexusModId: 2380, installed: true, installedVersion: '1.30.0', latestVersion: '1.30.0', latestDate: '2026-10-23', state: 'ok' },
  { id: 'cet', name: 'Cyber Engine Tweaks', nexusModId: 107, installed: true, installedVersion: '1.38.0', latestVersion: '1.38.0', latestDate: '2026-10-24', state: 'ok' },
  { id: 'redscript', name: 'redscript', nexusModId: 1511, installed: true, installedVersion: '0.5.31', latestVersion: '0.5.31', latestDate: '2026-10-23', state: 'ok' },
  { id: 'archivexl', name: 'ArchiveXL', nexusModId: 4198, installed: true, installedVersion: '1.28.1', minVersionForPatch: '1.28.1', latestVersion: '1.28.1', state: 'ok' },
  { id: 'tweakxl', name: 'TweakXL', nexusModId: 4197, installed: true, installedVersion: '1.11.2', latestVersion: '1.11.4', latestDate: '2026-10-24', state: 'outdated', note: '1.11.4 is out' },
  { id: 'codeware', name: 'Codeware', nexusModId: 7780, installed: true, installedVersion: '1.21.1', minVersionForPatch: '1.21.1', state: 'ok' },
  { id: 'nativesettings', name: 'Native Settings UI', nexusModId: 3518, installed: true, installedVersion: '1.96', latestVersion: '1.96', latestDate: '2026-02-11', state: 'no-patch-build', note: 'No release since 2.5 came out' },
  { id: 'modsettings', name: 'Mod Settings', nexusModId: 4885, installed: false, state: 'missing' }
]

const STEP_LABELS: [string, string][] = [
  ['prepare', 'Copy the mod and gather inputs'],
  ['checks', 'Compare with the new game files'],
  ['ai', 'AI writes the fix'],
  ['verify', 'Build and check the fix'],
  ['ready', 'Ready to install in a test profile']
]

function steps(doneCount: number, running?: number, details: Record<string, string> = {}): JobStep[] {
  return STEP_LABELS.map(([id, label], i) => ({
    id,
    label,
    status: i < doneCount ? 'done' : i === running ? 'running' : 'pending',
    detail: details[id]
  }))
}

function job(id: string, m: ModRef, status: JobState['status'], st: JobStep[], extra: Partial<JobState>): JobState {
  const dir = `${JOBS_DIR}\\${m.name} ${id}`
  return {
    id,
    modKey: m.key,
    modName: m.name,
    createdAt: minutesAgo(90),
    updatedAt: minutesAgo(2),
    status,
    round: 1,
    maxRounds: 4,
    steps: st,
    dir,
    outputDir: `${dir}\\output`,
    backend: 'Claude Code (installed on this PC)',
    fixName: `${m.name} - 2.5 fix (Patchwright)`,
    ...extra
  }
}

const LOGS: Record<string, LogLine[]> = {}

function seedLog(id: string, lines: [LogLine['level'], string][], startMin: number): void {
  LOGS[id] = lines.map(([level, text], i) => ({ ts: minutesAgo(startMin - i * 0.4), level, text }))
}

const NOTES: Record<string, Record<string, string>> = {
  sp0: {
    'NOTES.md': `# SP0 Body Mod 2.0 - 2.5 fix

## What was wrong
2.5 gave V's first-person entity new dual-wield animation sets and switched it to player_dualwield.animgraph. SP0 ships 160 copies of V's entity files from before 2.5, so they still point at player_ranged.animgraph and the reload animation breaks.

## What the fix does
Rebuilt the 5 player entities (fpp, tpp, cutscene, reflexion, photomode) from the 2.5 game files for each of SP0's 32 body sizes. The only change from vanilla is SP0's deformation rig folder for that size.

Packed as !!SP0_V_25fix.archive so it loads before SP0. Keep SP0 enabled. Disable this fix once SP0 is updated for 2.5.

## How to test
Reload a pistol and a rifle in first person, then look at V in photo mode and a mirror.`,
    'TASK.md': '# Task\n\nFix SP0 Body Mod 2.0 for Cyberpunk 2077 2.5. See reports/assets.md for the differences between the mod and the 2.5 files.',
    'FEEDBACK.md': '# Round 1 checks\n\n- [pass] recipe.json applied: 160 files, 0 misses\n- [pass] Packed !!SP0_V_25fix.archive (160 files)\n- [pass] Layout: archive/pc/mod only\n- [pass] Fix description written'
  },
  relux: {
    'NOTES.md': '(The AI writes this file when it finishes.)',
    'TASK.md': `# Task

Fix ReLUX for Cyberpunk 2077 2.5.

- ReLUX's .xl files remove and move light nodes in world sectors. 31 of 117 edits now point at nodes whose type changed (see reports/sectors.md and reports/nodes.tsv).
- ReImagined depends on ReLUX's archive names. Keep every archive name unchanged.
- Write the fixed .xl files under output/archive/pc/mod/. Never change the original mod.`,
    'FEEDBACK.md': `# Round 1 checks

- [fail] Sector edits match 2.5
  - ex_in_terior_-23_-35_0_1.streamingsector: edit 4 expects worldStaticLightNode at index 412, found worldInstancedMeshNode
  - 3 more mismatches
- [pass] YAML parses
- [pass] Layout: archive/pc/mod only`
  },
  reimagined: {
    'NOTES.md': `# ReImagined - 2.5 compat patch

Fixed the compile error in Lighting.reds: 2.5 renamed GetLightComponent, so the script now finds the light component by type.
Rebuilt the prop hides for 2.5: 10 of the 47 still match. The other 37 point at props that 2.5 moved or merged, and are left out.

This fix replaces ReImagined's scripts, so disable the original's r6/scripts folder or install the fix with a higher priority in Vortex.`,
    'TASK.md': '# Task\n\nFix ReImagined for 2.5. reports/redscript.md has the compile errors.',
    'FEEDBACK.md': '# Round 2 checks\n\n- [pass] Scripts compile against 2.5 (0 errors)\n- [pass] 10 sector edits match 2.5\n- [pass] Fix description written'
  }
}

export function createMockApi(): PatchwrightApi {
  const listeners = new Set<(e: AppEvent) => void>()
  const emit = (e: AppEvent): void => listeners.forEach((l) => l(e))

  let settings: Settings = {
    gameId: 'cyberpunk2077',
    gamePath: 'D:\\SteamLibrary\\steamapps\\common\\Cyberpunk 2077',
    vortexExe: 'C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe',
    vortexAppData: 'C:\\Users\\Tim\\AppData\\Roaming\\Vortex',
    vortexStagingPath: STAGING,
    wolvenkitCli: 'C:\\Users\\Tim\\Downloads\\WolvenKit.Console-10.0.0-beta.1\\WolvenKit.CLI.exe',
    backupsPath: BACKUPS,
    workspacePath: JOBS_DIR,
    savesPath: 'C:\\Users\\Tim\\Saved Games\\CD Projekt Red\\Cyberpunk 2077',
    nexusApiKey: 'demo-key',
    ai: { backend: 'claude-cli', claudeModel: 'claude-opus-5-5', baseUrl: 'http://localhost:1234/v1', maxRounds: 4, maxTurns: 60, maxBudgetUsd: 5 },
    toolCommands: {
      wkUnbundle: 'unbundle -p "{in}" -o "{out}" -r "{regex}"',
      wkSerialize: 'convert serialize "{in}" -o "{out}"',
      wkDeserialize: 'convert deserialize "{in}" -o "{out}"',
      wkPack: 'pack -p "{in}" -o "{out}"',
      redscriptCompile: 'compile -s "{in}" -b "{bundle}" -o "{out}"'
    },
    communityChecks: true,
    communityViaAi: false,
    fixNameTemplate: '{name} - {patch} fix (Patchwright)',
    vortexAutomation: false,
    testProfileName: 'Patchwright {patch} test',
    onboarded: true
  }

  const jobs: JobState[] = [
    job('k3f9a2', RELUX, 'running-ai', steps(2, 2, { prepare: '38 files, 117 sector edits', checks: '31 edits no longer match', ai: 'Round 2 of 4' }), { round: 2, costUsd: 0.94, createdAt: minutesAgo(14) }),
    job('p81c0d', REIMAGINED, 'ready', steps(5, undefined, { prepare: '52 files', checks: 'compile error, 37 stale hides', ai: '2 rounds', verify: 'All checks passed', ready: 'Not installed yet' }), {
      round: 2,
      costUsd: 2.31,
      summary: 'Fixed the compile error and rebuilt the 10 prop hides that still match 2.5.',
      createdAt: minutesAgo(70)
    }),
    job('a07e55', SP0, 'delivered', steps(5, undefined, { prepare: '161 files', checks: '160 stale entity copies', ai: '1 round', verify: 'All checks passed', ready: 'Installed' }), {
      round: 1,
      costUsd: 1.84,
      summary: 'Rebuilt 160 player entities from the 2.5 files with SP0 rigs, packed as !!SP0_V_25fix.archive.',
      deliveredTo: `${STAGING}\\SP0 Body Mod 2.0 - 2.5 fix (Patchwright)`,
      createdAt: minutesAgo(26 * 60),
      updatedAt: minutesAgo(25 * 60)
    })
  ]
  const files: Record<string, Record<string, string>> = { k3f9a2: NOTES.relux, p81c0d: NOTES.reimagined, a07e55: NOTES.sp0 }
  jobs[2].outcome = 'works'

  // The demo jobs stand for the fixes that are built into the knowledge base.
  let kb: KnowledgeBase = structuredClone(CYBERPUNK_KNOWLEDGE)
  const fixIdOf: Record<string, string> = { a07e55: 'cp2077-2.5-sp0-body-mod', p81c0d: 'cp2077-2.5-reimagined', k3f9a2: 'cp2077-2.5-relux' }
  const triageOf = (j: JobState): TriageResult | undefined => RESULTS.find((r) => r.mod.key === j.modKey)
  for (const j of jobs) {
    const t = triageOf(j)
    if (t) files[j.id]['KNOWLEDGE.md'] = knowledgeText(selectKnowledge(kb, queryFromTriage(t, '2.5', 'streaming: nodedeletions player_ranged')), j.modName)
  }

  seedLog(
    'k3f9a2',
    [
      ['info', 'Copying ReLUX from Vortex staging (38 files)'],
      ['info', 'Unpacking 6 archives with WolvenKit 10.0.0-beta.1'],
      ['info', 'Extracting 117 vanilla 2.5 sectors'],
      ['warn', 'Sector edits: 31 of 117 no longer match 2.5. Wrote reports/sectors.md and reports/nodes.tsv'],
      ['info', 'Knowledge base: 3 patch change(s) and 2 earlier fix(es) match this mod (ReLUX, ReImagined).'],
      ['info', 'Starting Claude Code (round 1 of 4)'],
      ['tool', 'Read KNOWLEDGE.md'],
      ['ai', 'KNOWLEDGE.md says ReLUX was fixed for 2.5 before by matching moved nodes by position and mesh, and that worked in game. I will start from that.'],
      ['tool', 'Read reports/sectors.md'],
      ['tool', 'Read reports/nodes.tsv'],
      ['ai', 'The mismatches are all in Japantown interiors. 2.5 cooked these lights into worldStaticLightNode, so the indexes moved. I will match each edit by node type and position instead of by index.'],
      ['tool', 'Edit output/archive/pc/mod/ReLUX_japantown.xl'],
      ['info', 'Round 1: building and checking the fix'],
      ['error', 'Sector edits: 4 still point at the wrong node type'],
      ['info', 'Starting Claude Code (round 2 of 4), with FEEDBACK.md'],
      ['tool', 'Read FEEDBACK.md']
    ],
    9
  )
  seedLog('p81c0d', [['info', 'Round 2: all checks passed. Ready to install in a test profile.']], 60)
  seedLog('a07e55', [['info', 'Installed into Vortex staging.']], 25 * 60)

  const changelog: ChangelogEntry[] = [
    { id: 'c5', ts: minutesAgo(25 * 60), action: 'Installed fix into Vortex staging', target: `${STAGING}\\SP0 Body Mod 2.0 - 2.5 fix (Patchwright)`, details: '160 files from job a07e55 for "SP0 Body Mod 2.0".', undo: { type: 'remove-path', path: `${STAGING}\\SP0 Body Mod 2.0 - 2.5 fix (Patchwright)` } },
    { id: 'c4', ts: minutesAgo(26 * 60), action: 'Created Vortex profile', target: 'Patchwright 2.5 test', details: 'Profile Bx81kq, a copy of your active profile.', undo: { type: 'vortex-del', statePath: 'persistent.profiles.Bx81kq' } },
    { id: 'c3', ts: minutesAgo(26 * 60 + 2), action: 'Backed up saves', target: `${BACKUPS}\\saves\\2026-10-27_14-02`, details: '84 saves copied.' },
    { id: 'c2', ts: minutesAgo(3 * 24 * 60), action: 'Packed fix as zip', target: `${BACKUPS}\\fixes\\Improved Environment LODs - 2.5 fix (Patchwright).zip`, details: '1 file from job 9f2e10.', undo: { type: 'remove-path', path: 'zip' }, undoneAt: minutesAgo(2 * 24 * 60) }
  ]

  const relux = jobs[0]
  // Plays the running ReLUX job forward so the live log moves.
  void (async () => {
    const script: [LogLine['level'], string][] = [
      ['ai', 'Four edits still miss. Their lights were merged into one node in 2.5, so I will remove the merged node once instead of four times.'],
      ['tool', 'Edit output/archive/pc/mod/ReLUX_japantown.xl'],
      ['tool', 'Write NOTES.md'],
      ['ai', 'Done. The archive names are unchanged, so ReImagined still finds them.']
    ]
    for (const [level, text] of script) {
      await sleep(2500)
      pushLog(relux.id, level, text)
    }
    await sleep(1500)
    setStep(relux, 'ai', 'done', '2 rounds')
    setStep(relux, 'verify', 'running')
    relux.status = 'verifying'
    files.k3f9a2['NOTES.md'] = '# ReLUX - 2.5 removals fix\n\nRe-matched 117 sector edits to the 2.5 sectors by node type and position. 4 lights that 2.5 merged are removed once.\n\nKeep the original ReLUX enabled: this fix only replaces its .xl files and keeps the archive names, which ReImagined depends on.'
    emit({ type: 'job', job: { ...relux } })
    pushLog(relux.id, 'info', 'Round 2: building and checking the fix')
    await sleep(2500)
    setStep(relux, 'verify', 'done', 'All checks passed')
    setStep(relux, 'ready', 'done', 'Not installed yet')
    relux.status = 'ready'
    relux.costUsd = 1.62
    relux.summary = 'Re-matched 117 sector edits to 2.5 by node type and position.'
    emit({ type: 'job', job: { ...relux } })
    pushLog(relux.id, 'info', 'All checks passed. Ready to install in a test profile.')
  })()

  function pushLog(id: string, level: LogLine['level'], text: string): void {
    const line = { ts: now(), level, text }
    ;(LOGS[id] ??= []).push(line)
    emit({ type: 'job-log', jobId: id, line })
  }

  function setStep(j: JobState, id: string, status: JobStep['status'], detail?: string): void {
    j.steps = j.steps.map((s) => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s))
    j.updatedAt = now()
  }

  async function simulateJob(j: JobState): Promise<void> {
    const plan: [string, string, [LogLine['level'], string][]][] = [
      ['prepare', 'Copied the mod', [['info', `Copying ${j.modName} from Vortex staging`]]],
      ['checks', 'Compared with 2.5', [['info', 'Extracting the matching 2.5 game files'], ['warn', 'Wrote reports/assets.md']]],
      ['ai', '1 round', [['info', 'Knowledge base: 3 patch change(s) and 2 earlier fix(es) match this mod.'], ['info', 'Starting Claude Code (round 1 of 4)'], ['tool', 'Read TASK.md'], ['ai', 'Reading the reports first.'], ['tool', 'Write recipe.json'], ['tool', 'Write NOTES.md']]],
      ['verify', 'All checks passed', [['info', 'Round 1: building and checking the fix']]]
    ]
    const status: Record<string, JobState['status']> = { prepare: 'preparing', checks: 'preparing', ai: 'running-ai', verify: 'verifying' }
    for (const [id, detail, lines] of plan) {
      if (j.status === 'cancelled') return
      j.status = status[id]
      setStep(j, id, 'running')
      emit({ type: 'job', job: { ...j } })
      for (const [level, text] of lines) {
        await sleep(900)
        pushLog(j.id, level, text)
      }
      setStep(j, id, 'done', detail)
    }
    setStep(j, 'ready', 'done', 'Not installed yet')
    j.status = 'ready'
    j.outcome = 'untested'
    j.costUsd = 0.88
    const t = triageOf(j)
    kb.fixes.push({
      id: `job-${j.id}`,
      gameId: 'cyberpunk2077',
      patch: '2.5',
      modName: j.modName,
      nexusModId: t?.mod.nexusModId,
      kinds: t?.classification?.kinds ?? [],
      frameworks: t?.classification?.frameworksUsed ?? [],
      problem: '(Demo) What the AI found broken.',
      approach: "(Demo) How the AI fixed it, from fix.json.",
      lessons: [],
      keywords: [],
      outcome: 'untested',
      source: 'learned',
      fromJob: j.id,
      addedAt: now(),
      updatedAt: now()
    })
    files[j.id] = { 'NOTES.md': `# ${j.modName} - 2.5 fix\n\n(Demo) The AI's description of the fix goes here.`, 'TASK.md': '# Task', 'FEEDBACK.md': '# Round 1 checks\n\n- [pass] all' }
    emit({ type: 'job', job: { ...j } })
    pushLog(j.id, 'info', 'All checks passed. Ready to install in a test profile.')
  }

  const game: GameStatus = {
    gameId: 'cyberpunk2077',
    name: 'Cyberpunk 2077',
    installPath: settings.gamePath,
    installedVersion: '2.5',
    installedVersionSource: 'RED4ext log',
    baselinePatch: PATCH,
    latestBuild: PATCH,
    upToDate: true,
    warnings: []
  }

  const api: PatchwrightApi = {
    getSettings: async () => structuredClone(settings),
    saveSettings: async (p) => {
      settings = { ...settings, ...p, ai: { ...settings.ai, ...(p.ai ?? {}) }, toolCommands: { ...settings.toolCommands, ...(p.toolCommands ?? {}) } }
      return structuredClone(settings)
    },
    detectPaths: async () => {
      await sleep(600)
      return { gamePath: settings.gamePath, vortexStagingPath: STAGING, wolvenkitCli: settings.wolvenkitCli, backupsPath: BACKUPS }
    },
    getGameStatus: async (refresh) => {
      if (refresh) await sleep(700)
      return { ...game }
    },
    getFrameworks: async () => FRAMEWORKS,
    testAi: async () => {
      await sleep(1200)
      return { ok: true, detail: 'Claude Code 3.4.1 answered.' }
    },
    testNexus: async () => {
      await sleep(600)
      return { ok: true, detail: 'Signed in to Nexus as Tim (premium).' }
    },
    vortexStatus: async () => ({
      found: true,
      exe: settings.vortexExe,
      appData: settings.vortexAppData,
      stagingPath: STAGING,
      running: false,
      stateReadable: true,
      activeProfile: { id: 'Hk3x9', name: 'Default' },
      profiles: [
        { id: 'Hk3x9', name: 'Default' },
        { id: 'Bx81kq', name: 'Patchwright 2.5 test' }
      ],
      modCount: 214,
      notes: []
    }),
    listInstalledMods: async () => RESULTS.map((r) => r.mod),
    resolveInput: async (input) => {
      await sleep(500)
      if (/collections\//.test(input)) {
        const mods = [SP0, RELUX, REIMAGINED, AMM, LODS, ARCHIVEXL]
        const collection: CollectionInfo = { slug: 'qzbxlv', name: 'Night City Remastered', revision: 12, domain: 'cyberpunk2077', modCount: mods.length }
        return { mods, collection, notes: [] }
      }
      const id = /(?:mods\/)?(\d+)/.exec(input)?.[1]
      const hit = RESULTS.find((r) => (id && r.mod.nexusModId === Number(id)) || r.mod.name.toLowerCase().includes(input.trim().toLowerCase()))
      if (hit) return { mods: [hit.mod], notes: [] }
      if (id) return { mods: [{ key: `nexus:${id}`, name: `Nexus mod ${id}`, nexusModId: Number(id), source: 'nexus' }], notes: [`"Nexus mod ${id}" isn't installed. It can be checked, but a fix needs it installed with Vortex.`] }
      return { mods: [], notes: ["That isn't a Nexus link, a mod id, a folder, or the name of an installed mod."] }
    },
    triage: async (mods) => {
      const out: TriageResult[] = []
      for (let i = 0; i < mods.length; i++) {
        emit({ type: 'triage-progress', done: i, total: mods.length, current: mods[i].name })
        await sleep(220)
        const r: TriageResult = RESULTS.find((x) => x.mod.key === mods[i].key) ?? {
          mod: mods[i],
          checks: [],
          verdict: 'not-updated',
          action: 'test-in-game',
          reasons: ['Not installed, so its files were not checked.'],
          checkedAt: now()
        }
        out.push(r)
        emit({ type: 'triage-result', result: r })
      }
      emit({ type: 'triage-progress', done: mods.length, total: mods.length })
      return out
    },
    checkCommunity: async (m) => {
      await sleep(900)
      return RESULTS.find((r) => r.mod.key === m.key)?.community ?? { checkedAt: now(), works: 0, broken: 0, snippets: [], source: 'keyword' }
    },
    startJob: async (t) => {
      const j = job(Math.random().toString(36).slice(2, 8), t.mod, 'queued', steps(0), { createdAt: now(), updatedAt: now(), round: 1, costUsd: 0 })
      jobs.unshift(j)
      LOGS[j.id] = []
      void simulateJob(j)
      return { ...j }
    },
    cancelJob: async (id) => {
      const j = jobs.find((x) => x.id === id)
      if (!j) return
      j.status = 'cancelled'
      emit({ type: 'job', job: { ...j } })
    },
    listJobs: async () => jobs.map((j) => ({ ...j })),
    getJobLog: async (id) => [...(LOGS[id] ?? [])],
    readJobFile: async (id, rel) => files[id]?.[rel] ?? null,
    deliverJob: async (id, mode) => {
      await sleep(700)
      const j = jobs.find((x) => x.id === id)
      if (!j) return { ok: false, message: 'Job not found.' }
      const p = mode === 'zip' ? `${BACKUPS}\\fixes\\${j.fixName}.zip` : `${STAGING}\\${j.fixName}`
      j.status = 'delivered'
      j.deliveredTo = p
      setStep(j, 'ready', 'done', 'Installed')
      emit({ type: 'job', job: { ...j } })
      changelog.unshift({ id: `c${Date.now()}`, ts: now(), action: mode === 'zip' ? 'Packed fix as zip' : 'Installed fix into Vortex staging', target: p, details: `From job ${j.id} for "${j.modName}".`, undo: { type: 'remove-path', path: p } })
      return {
        ok: true,
        path: p,
        message: mode === 'zip' ? `Saved ${p}. Drag it into Vortex's Mods tab.` : `Copied to ${p}. Restart Vortex: the fix shows up as a new mod. Enable it in your test profile and deploy.`
      }
    },
    getTestHints: async (ids) =>
      ids.flatMap((id) => {
        const j = jobs.find((x) => x.id === id)
        if (!j) return []
        const hints: Record<string, string[]> = {
          [SP0.key]: ['Look at the things the mod replaces in game. Reload a pistol and a rifle in first person: the reload animation should play.', 'Check V in photo mode and in a mirror.'],
          [RELUX.key]: ['Check red4ext/plugins/ArchiveXL/ArchiveXL.log for rejected edits.', 'Visit Japantown at night: the removed lamps should stay gone.'],
          [REIMAGINED.key]: ['After launching, there should be no redscript warning popup.', 'Check r6/logs/redscript_rCURRENT.log for errors.']
        }
        return [{ jobId: id, fixName: j.fixName, hints: hints[j.modKey] ?? ['Look at what the mod changes in game.'] }]
      }),
    createTestProfile: async () => {
      await sleep(800)
      return { ok: true, message: 'Created the Vortex profile "Patchwright 2.5 test". Switch to it in Vortex before installing fixes.' }
    },
    backupSaves: async () => {
      await sleep(1200)
      const p = `${BACKUPS}\\saves\\2026-10-28_15-10`
      changelog.unshift({ id: `c${Date.now()}`, ts: now(), action: 'Backed up saves', target: p, details: '86 saves copied.' })
      return { ok: true, path: p, message: `Backed up 86 saves to ${p}.` }
    },
    readTestLogs: async () => {
      await sleep(900)
      const f: LogFinding[] = [
        { source: 'ArchiveXL', file: 'red4ext/plugins/ArchiveXL/ArchiveXL.log', level: 'warn', text: '[ReLUX_japantown.xl] Sector ex_in_terior_-23_-35_0_1: node 980 already removed by another mod', mod: 'ReLUX' },
        { source: 'redscript', file: 'r6/logs/redscript_rCURRENT.log', level: 'warn', text: 'UNUSED_VARIABLE at ReImagined/Lighting.reds:41', mod: 'ReImagined' },
        { source: 'RED4ext', file: 'red4ext/logs/red4ext.log', level: 'error', text: 'Crowd Density Plugin: incompatible game version 2.5, plugin not loaded' }
      ]
      return f
    },
    summarizeTest: async () => {
      await sleep(1500)
      return 'The SP0 Body Mod fix works: you saw the reload animation, and no log line names it. Keep it.\n\nThe ArchiveXL warning about ReLUX means two mods remove the same lamp, which is harmless. The ReImagined line is a style warning, not an error.\n\nCrowd Density Plugin did not load because it is built for an older game version. Disable it in Vortex until its author updates it.'
    },
    getKnowledge: async () => structuredClone(kb),
    saveKnowledgeEntry: async (kind, entry) => {
      if (kind === 'change') kb.changes = [...kb.changes.filter((c) => c.id !== entry.id), entry as PatchChange]
      else kb.fixes = [...kb.fixes.filter((f) => f.id !== entry.id), { ...(entry as FixRecord), updatedAt: now() }]
      return structuredClone(kb)
    },
    deleteKnowledgeEntry: async (id) => {
      kb = { changes: kb.changes.filter((c) => c.id !== id), fixes: kb.fixes.filter((f) => f.id !== id) }
      return structuredClone(kb)
    },
    knowledgeFor: async (t) => selectKnowledge(kb, queryFromTriage(t, '2.5')),
    recordOutcome: async (jobId, outcome, note) => {
      const j = jobs.find((x) => x.id === jobId)
      if (!j) return { ok: false, message: 'Job not found.' }
      const id = fixIdOf[jobId] ?? `job-${jobId}`
      const f = kb.fixes.find((x) => x.id === id)
      if (f) Object.assign(f, { outcome, outcomeNote: note ?? f.outcomeNote, updatedAt: now() })
      j.outcome = outcome
      emit({ type: 'job', job: { ...j } })
      const said = { works: 'Saved: the fix works. Later fixes of similar mods will start from it.', partial: 'Saved: the fix partly works.', failed: "Saved: the fix doesn't work. Later fixes will avoid repeating it.", untested: 'Marked as not tested yet.' }
      return { ok: true, message: said[outcome] }
    },
    exportKnowledge: async () => ({ ok: true, path: `${BACKUPS}\\knowledge\\patchwright-knowledge.json`, message: `Saved ${kb.fixes.filter((f) => f.source !== 'built-in').length} entries to ${BACKUPS}\\knowledge.` }),
    importKnowledge: async () => ({ ok: false, message: 'Importing needs the desktop app.' }),
    getChangelog: async () => changelog.map((c) => ({ ...c })),
    undo: async (id) => {
      await sleep(500)
      const c = changelog.find((x) => x.id === id)
      if (!c) return { ok: false, message: 'Not found.' }
      c.undoneAt = now()
      return { ok: true, message: `Undone: ${c.action}. Moved it to backups/undone.` }
    },
    openPath: async () => {},
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener')
    },
    pickPath: async () => null,
    onEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
  return api
}

/** A short KNOWLEDGE.md for the demo jobs. The real one is written by the engine. */
function knowledgeText(k: RelevantKnowledge, modName: string): string {
  return [
    `# What Patchwright knows that may help with "${modName}" on patch 2.5`,
    '',
    '## Patch changes',
    ...k.changes.map(({ entry: c, why }) => `- ${c.summary}${c.remedy ? `\n  Remedy: ${c.remedy}` : ''}\n  Picked because: ${why.join('; ')}`),
    '',
    '## Earlier fixes',
    ...k.fixes.map(({ entry: f, why }) => `- ${f.modName} (${f.outcome}): ${f.approach}\n  Picked because: ${why.join('; ')}`)
  ].join('\n')
}
