/**
 * General rules for updating Cyberpunk 2077 mods, learned by hand on patch 2.5. Every AI job gets this
 * text, so keep it factual and short. Facts about one patch or one mod belong in knowledge.ts instead,
 * where jobs pick only the relevant entries.
 */
export const CYBERPUNK_PLAYBOOK = `# Cyberpunk 2077 mod update playbook

## Ground rules
- Never edit the original mod or the game folder. The fix is a separate mod that the user can enable
  or disable in Vortex. Write the fix only where the task says.
- Make the smallest change that restores the mod's behaviour on the new patch. Keep the author's
  intent, names and settings.
- Say what you are unsure of. A fix that compiles still needs an in-game test, so write down what the
  user should look at.
- Mod permissions: assume the fix is for personal use only. Never suggest uploading it unless the
  author's permissions allow modified versions.

## Find out what kind of mod it is
- .archive: packed game assets. Mods often ship full copies of vanilla files (.ent, .app, .mesh,
  .streamingsector). When a patch changes the vanilla file, the stale copy overrides the new one and
  removes whatever the patch added.
- .xl (ArchiveXL): resource patches, extra appearances, and map sector edits. Sector edits are pinned to
  exact node counts (expectedNodes) and node indexes, which patches often change.
- r6/tweaks/*.yaml (TweakXL): TweakDB record edits. Breaks when records are renamed or removed.
- r6/scripts/*.reds (redscript): breaks at compile time when classes, fields or functions change.
  A clean compile doesn't prove it works: the behaviour can still change at runtime.
- bin/x64/plugins/cyber_engine_tweaks/mods/* (CET Lua): breaks at runtime; check the mod's own log and
  CET's scripting log.
- red4ext/plugins/*.dll and .asi: native code. Only the author can rebuild it. Don't try to patch it.
- Frameworks (RED4ext, CET, redscript, ArchiveXL, TweakXL, Codeware, Mod Settings, Input Loader) must
  have a build for the new patch first. Many "broken" mods just wait on one of these.

## Approaches that worked
- Stale vanilla copies inside an archive (SP0 Body Mod): find the mod's only real edit by diffing its
  copy against the vanilla file, then take the vanilla file from the new patch and re-apply just that
  edit. For many size variants, use one recipe entry per variant (copy vanilla, set one field). Pack the
  result as a new archive whose name starts with "!!" so it loads before, and wins over, the original.
  The original stays installed.
- Script compile errors (ReImagined): read the compiler error, look up what replaced the removed field
  or class in the new scripts, and change only that code. If a feature can't work any more from
  scripts, remove that one case and say so, instead of breaking the whole mod.
- Compiles but "does nothing" (Improved Environment LODs): compare what the mod changes with vanilla
  data from the new patch. In that case, 2.5 meshes keep LOD distances in two tables and the mod only
  scaled one. Make the fix null-safe and log what it touched, so the user's test tells us something.
- ArchiveXL sector removals (ReLUX): for each removal, check expectedNodes, the index, and the node type
  against the new sector. In 2.5 most vanilla lamps became a new cooked node type at the same index;
  some nodes moved, so match them by position and mesh instead. Ship a corrected removals .xl as a
  separate mod; leave the original's lights alone.
- When a script mod is replaced by a fix, the user must disable the original, or both will apply
  (double scaling, duplicate settings). Rename the fix's settings category so both are recognisable.

## Cross-mod dependencies
- Other mods may detect a mod by its exact archive or folder name. ReImagined only enables an area
  when ReLUX-<Area>.archive is deployed. Never rename or merge another mod's archives.
- Check that the fix's files don't overwrite files from other installed mods.

## Patch-specific knowledge
- KNOWLEDGE.md in the job folder lists what recent patches changed and how similar mods were fixed,
  picked for this mod from Patchwright's knowledge base. Fixes marked as failed show what not to repeat.

## Saves
- Back up saves before testing. A save that fails to load after removing a mod may have been damaged
  when it was written, not by the removal. Test with a save made just before, with the same mods.

## Testing in game
- Give the user a short, concrete test: where to go, what to do, what should look different.
- After the test, read: r6/logs/redscript_rCURRENT.log, red4ext/logs/*.log,
  red4ext/plugins/ArchiveXL/ArchiveXL.log, red4ext/plugins/TweakXL/TweakXL.log,
  bin/x64/plugins/cyber_engine_tweaks/scripting.log and the mod's own log.
- CET console snippets help identify things in game, e.g. the record of the NPC the player looks at.
  Guard them with pcall and nil checks; the look-at target is nil when nothing is under the crosshair.
`
