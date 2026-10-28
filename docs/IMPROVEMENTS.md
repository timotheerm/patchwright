# Improvement ideas

These come from updating mods for Cyberpunk 2077 2.5 by hand, before Patchwright existed. Each one is something that cost time or caused a scare.

## Most useful next

1. **Save health check.** A save once looked broken after a mod was removed, and the likely cause was that the save was already damaged (it was missing a game system). Before and after a test, read each save's metadata and flag saves that are missing systems or that reference mods no longer installed, so a broken save isn't blamed on a fix.
2. **Cost and time estimate before a fix.** Count the files, the report size and the mod type, and show "about $1–3 and 5 minutes with Opus" before starting. Offer a cheaper model for small script mods.
3. **Patch watcher.** Check Steam news once a day. When a new patch appears, check all installed mods in the background and show a summary the next time the app opens.
4. **Tool versions per patch.** WolvenKit 9.1 couldn't read 2.5 world sectors, and that only showed up as confusing errors. Keep a small table of the minimum WolvenKit, redscript, ArchiveXL and Codeware versions per patch, warn before a job starts, and offer to download the right version (with the user's consent, from the official release pages).
5. **Dependency graph.** ReImagined depends on ReLUX's archive names, so a ReLUX fix that renamed them would have broken ReImagined. Build a graph of which mods reference which (archive names, script classes, TweakDB records) and show it before a fix replaces anything.

## Better fixes

6. **Shared knowledge.** The knowledge base can already be exported and imported as a file. Next step: an opt-in shared list, so a fix that worked for one user ("ReLUX on 2.5: sector edits re-matched by node type, works") helps everyone else's next fix. Only the knowledge entries would be shared, never fix files, because many authors don't allow it.
7. **Permissions reader.** Read the mod page's permissions section and show plainly whether a fix may be shared, so nobody uploads a patch the author doesn't allow (the ReLUX fix, for example, can't be uploaded).
8. **In-game checks with CET.** Generate a small Cyber Engine Tweaks script per fix that checks the thing the fix is about (an entity's animation graph, a light that should be gone) and writes the result to a log Patchwright reads afterwards.
9. **Visual diff for asset mods.** Show vanilla and modded entities side by side in the Fixes page (components, appearances, rig paths) instead of only the text report.
10. **Knowledge from players' posts.** When posts on a mod page describe a workaround that worked ("rename X", "update Codeware first"), offer to save it as a patch change, so the next fix starts from it. (Learning from finished fixes is already built in.)

## Reach

11. **Vortex extension.** A small Vortex extension could add a "Check with Patchwright" button to the mods list, and register fixes through Vortex's own API instead of its command line.
12. **Mod Organizer 2 support.** MO2 keeps each mod in its own folder too, so the same "fix as a separate mod" model fits.
13. **More games.** Skyrim, Fallout 4 and Baldur's Gate 3 have large mod scenes and regular breaking patches. Each needs a game adapter: classification, checks, and the tools to unpack and pack its files.
14. **Languages.** The UI text is in one place per page, so a French translation is a small step.
