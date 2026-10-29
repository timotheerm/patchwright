// What we learned updating Cyberpunk 2077 mods for patch 2.5 by hand, before Patchwright existed.
// Fixes made with Patchwright are added next to these in the user's own knowledge file.
// Only type imports here: the UI's demo mode uses this file too.
import type { FixRecord, KnowledgeBase, PatchChange } from '../../../shared/types'

const ADDED = '2026-10-28'

const change = (c: Omit<PatchChange, 'gameId' | 'source' | 'addedAt'>): PatchChange => ({ ...c, gameId: 'cyberpunk2077', source: 'built-in', addedAt: ADDED })
const fix = (f: Omit<FixRecord, 'gameId' | 'source' | 'addedAt' | 'updatedAt'>): FixRecord => ({
  ...f,
  gameId: 'cyberpunk2077',
  source: 'built-in',
  addedAt: ADDED,
  updatedAt: ADDED
})

export const CYBERPUNK_KNOWLEDGE: KnowledgeBase = {
  changes: [
    change({
      id: 'cp2077-2.5-dualwield-animgraph',
      patch: '2.5',
      summary: "V's first-person entity gained dual-wield animation sets and now uses player_dualwield.animgraph instead of player_ranged.animgraph.",
      affects: ['archive'],
      symptoms: "Reload and dual-wield animations break for V when a mod ships old copies of V's player entity files.",
      remedy: "Rebuild the mod's player entity copies from the 2.5 files and re-apply only the mod's own edit to each (see the SP0 Body Mod fix).",
      keywords: ['player_ranged', 'entities/player/', 'deformations_rigs', 'animgraph']
    }),
    change({
      id: 'cp2077-2.5-cooked-nodes',
      patch: '2.5',
      summary: 'Many vanilla map lamps and props became cooked or instanced node types, and some nodes moved within their sector.',
      affects: ['archivexl'],
      symptoms: 'ArchiveXL rejects node deletions and mutations that name the old node type (see ArchiveXL.log), so removed lamps or props come back.',
      remedy: 'Re-check every sector edit against the 2.5 sector: expectedNodes, the index, and the node type. Match moved nodes by position and mesh, not by index (see the ReLUX fix).',
      keywords: ['streaming:', 'nodedeletions', 'nodemutations', 'expectednodes', 'streamingsector']
    }),
    change({
      id: 'cp2077-2.5-instancedmesh-mesh',
      patch: '2.5',
      summary: 'worldInstancedMeshNode no longer exposes "mesh" to scripts.',
      affects: ['redscript', 'cet'],
      symptoms: 'Script compile errors, or nil values, where a script reads the mesh of an instanced mesh node.',
      remedy: 'Find the mesh another way, or drop that one feature and say so in the notes, instead of breaking the whole mod.',
      keywords: ['worldinstancedmeshnode', 'instancedmesh']
    }),
    change({
      id: 'cp2077-2.5-lod-tables',
      patch: '2.5',
      summary: 'Meshes keep their LOD distances in two tables. A mod that scales only one of them compiles and loads, but changes nothing visible.',
      affects: [],
      symptoms: 'The mod loads without errors but has no visible effect.',
      remedy: 'Scale both tables, guard every access against missing data, and log what was changed so the in-game test proves it ran (see the Improved Environment LODs fix).',
      keywords: ['lod']
    }),
    change({
      id: 'cp2077-2.5-wolvenkit-10',
      patch: '2.5',
      summary: "WolvenKit 9.x can't read 2.5 map sectors. WolvenKit 10.0.0-beta.1 or newer is needed.",
      affects: ['archive', 'archivexl'],
      symptoms: 'Unpacking or converting .streamingsector files fails with confusing errors.',
      remedy: 'Set WolvenKit 10.0.0-beta.1 or newer in Settings before fixing mods that touch the map.',
      keywords: ['streamingsector', 'streaming:']
    }),
    change({
      id: 'cp2077-2.5-framework-versions',
      patch: '2.5',
      summary: 'ArchiveXL 1.28.1 and Codeware 1.21.1 are the first versions that support 2.5.',
      affects: ['archivexl', 'redscript', 'cet'],
      remedy: 'Update these frameworks before deciding that a mod that needs them is broken.',
      keywords: ['archivexl', 'codeware']
    })
  ],
  fixes: [
    fix({
      id: 'cp2077-2.5-sp0-body-mod',
      patch: '2.5',
      modName: 'SP0 Body Mod 2.0',
      nexusModId: 1424,
      kinds: ['archive'],
      frameworks: [],
      problem:
        "Female V's reload animation broke on 2.5. The mod ships 160 pre-2.5 copies of V's entity files (fpp, tpp, cutscene, reflexion and photomode, for each of 32 body sizes). They still point at player_ranged.animgraph and miss the new dual-wield animation sets.",
      approach:
        "Diffing the mod's copies against vanilla showed its only real edit: the deformations component, which points at a rig folder for each body size. The fix takes the 5 vanilla 2.5 entities, writes 32 copies of each with only the rig folder swapped in (one recipe entry per copy), and packs them as !!SP0_V_25fix.archive so it loads before SP0. SP0 stays installed; the fix can be removed once SP0 is updated.",
      lessons: [
        'When a mod ships full copies of vanilla files, find its one real edit and re-apply it to the new vanilla file, instead of patching the old copy.',
        'Start the fix archive name with "!!" so it loads before the original.',
        'Use recipe.json for many near-identical files.'
      ],
      keywords: ['deformations_rigs', 'player_ranged', 'entities/player/'],
      outcome: 'works',
      outcomeNote: 'Tested in game: reloads work again.'
    }),
    fix({
      id: 'cp2077-2.5-improved-environment-lods',
      patch: '2.5',
      modName: 'Improved Environment LODs',
      nexusModId: 4923,
      kinds: ['redscript'],
      frameworks: ['redscript'],
      problem: 'On 2.5 the mod compiled and loaded but did nothing visible: meshes keep LOD distances in two tables, and the mod only scaled one.',
      approach:
        "Compared what the mod changes with vanilla 2.5 data, then wrote a replacement that scales both LOD tables, checks every access for missing data, and logs what it touched. The fix replaces the original's scripts, so the original has to be disabled. Its settings category was renamed so both are easy to tell apart.",
      lessons: [
        "A clean compile doesn't prove a script mod works: compare what it changes with the new vanilla data.",
        'Log what the fix changes, so the in-game test gives evidence.',
        'When a fix replaces a script mod, the original must be disabled, or both apply (double scaling, duplicate settings).'
      ],
      keywords: ['lod'],
      outcome: 'untested'
    }),
    fix({
      id: 'cp2077-2.5-reimagined',
      patch: '2.5',
      modName: 'ReImagined',
      nexusModId: 25845,
      kinds: ['archive', 'archivexl', 'redscript'],
      frameworks: ['archivexl', 'redscript'],
      problem: 'Its scripts failed to compile on 2.5, and only 10 of its 47 prop hides still match the 2.5 sectors.',
      approach:
        'Read each compiler error, looked up what replaced the removed field or class in the 2.5 scripts, and changed only that code. Where a feature could no longer work from scripts, that one case was removed and noted. The 10 prop hides that still match were kept. Every ReLUX archive name was kept, because ReImagined enables areas by detecting ReLUX-<Area>.archive.',
      lessons: [
        'Fix compile errors one at a time. Drop one feature rather than break the whole mod.',
        'ReImagined detects ReLUX by its exact archive names: never rename or merge them.'
      ],
      keywords: ['relux', 'worldinstancedmeshnode', 'nodedeletions', 'streaming:'],
      outcome: 'untested'
    }),
    fix({
      id: 'cp2077-2.5-relux',
      patch: '2.5',
      modName: 'ReLUX',
      nexusModId: 20808,
      kinds: ['archive', 'archivexl'],
      frameworks: ['archivexl'],
      problem:
        'Light removals stopped working on 2.5. Most vanilla lamps became a new cooked node type at the same index, and some nodes moved, so ArchiveXL rejected the old node deletions.',
      approach:
        "Checked each removal against the 2.5 sector (expectedNodes, index and node type), matched moved nodes by position and mesh, and shipped a corrected removals .xl as a separate mod. The original's lights and archive names stay untouched.",
      lessons: [
        'Sector edits are pinned to node counts, indexes and types: re-check all three after every patch.',
        'Match moved nodes by position and mesh, not by index.',
        'Keep archive names: other mods (ReImagined) detect ReLUX by them.',
        "ReLUX's permissions don't allow sharing a fix publicly."
      ],
      keywords: ['streaming:', 'nodedeletions', 'expectednodes'],
      outcome: 'works',
      outcomeNote: 'The user confirmed the removals work.'
    })
  ]
}
