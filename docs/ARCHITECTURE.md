# Architecture

## Why this stack

- **Electron, React and TypeScript.** Vortex is itself an Electron app, the tools Patchwright drives (Vortex, WolvenKit, redscript, Claude Code) are command-line programs on Windows, and the engine needs full file system access. Electron gives a real desktop app with that access and one language end to end. The UI is plain React with one CSS file; there is no UI framework to learn.
- **The engine is plain Node** (`src/core`). It doesn't import Electron, so it runs in tests and could later run from a command line or a Vortex extension.
- **electron-vite** builds the main, preload and UI bundles; **electron-builder** makes the Windows installer and portable .exe; **vitest** runs the tests.
- **zod** validates every tool call the AI makes, and **@anthropic-ai/sdk** is used for the API-key backend.

## Processes

```
React UI (renderer)  --window.patchwright.*-->  preload  --IPC pw:<method>-->  main  -->  Engine (src/core)
                     <--------------- pw:event (job updates, log lines, check progress) -------------
```

`src/shared/api.ts` lists every method the UI can call. The preload script exposes exactly those methods; the UI never gets Node or Electron access (context isolation is on). In a browser, `src/renderer/src/api.ts` swaps in the demo API from `mock.ts`.

## Engine

`Engine` (src/core/engine.ts) holds the settings and wires the parts together:

| Part | File | Job |
|---|---|---|
| Game adapter | `games/cyberpunk2077/` | install detection, mod classification, static checks, unpack/pack/compile, the playbook, test hints |
| Patches | `sources/steam.ts` | Steam news → patch versions and dates, merged with a built-in list |
| Nexus | `sources/nexus.ts` | v1 REST for mods and files, v2 GraphQL for collections, cached on disk for 6 hours |
| Posts | `sources/community.ts` | keyword scan of the posts page, or an AI read of it |
| Vortex | `vortex/vortex.ts` | staging folder scan; state through `Vortex.exe --get/--set/--del` while Vortex is closed |
| Triage | `workflow/triage.ts` | evidence → verdict and next step |
| Jobs | `workflow/jobs.ts` | the fix loop |
| Prompts | `workflow/prompts.ts` | TASK.md and KNOWLEDGE.md, written from the triage, the checks and the knowledge base |
| Knowledge | `knowledge/` | picking patch changes and earlier fixes for a mod; storing what finished fixes taught |
| Recipes | `workflow/recipe.ts` | path-based edits on WolvenKit JSON |
| Changelog | `workflow/changelog.ts` | change log with undo, as JSON and CHANGELOG.md |
| Testing | `workflow/testing.ts` | save backups, log reading |
| AI | `ai/` | three backends behind one interface |

### Adding a game

Implement `GameAdapter` (src/core/games/types.ts) and register it in `games/index.ts`. The adapter decides how mods are classified, which checks run, how a workspace is prepared, and how a fix is built and verified. Everything else (Nexus, Vortex, triage, jobs, AI, UI) is shared.

## Triage

`decideVerdict` weighs evidence in this order:

1. The mod is a framework: never patched, only version-checked.
2. Frameworks it needs have no build for the patch (wait) or are outdated (update them first).
3. The author released a file after the patch: update it in Vortex, or nothing to do if you already have it.
4. Native plugins only: wait for the author.
5. Players report it broken: make a fix.
6. A check failed (compile error, stale sector edit): make a fix.
7. Players report it works, or it is a low-risk type: test it in game.
8. Otherwise: not updated and of a type that often breaks, so test it or make a fix.

## Fix jobs

```
prepare ─▶ checks ─▶ AI round ─▶ build + verify ─▶ ready
                       ▲   │            │
                       │   └ requests ──┘ (app extracts more game files, up to 3 times)
                       └──── FEEDBACK.md ◀ failed checks (up to maxRounds)
```

- The AI's standing instructions (system prompt plus the game playbook) are identical across rounds so they can be cached.
- Claude Code keeps its session between rounds (`--resume`). The API backend keeps the message history in the job folder. The local backend trims old tool output to fit small context windows.

### The AI's task

The user never writes a prompt. `JobManager` builds the task after the workspace is prepared:

1. `queryFromTriage` turns the mod into a query: patch, mod kinds, frameworks, Nexus id, and a lowercase text of its file paths, check results, triage reasons and reports.
2. `selectKnowledge` (`knowledge/match.ts`) scores every entry against it and keeps the best (6 patch changes, 5 fixes):
   - A **patch change** is kept only if it came with this patch or an earlier one, affects one of the mod's kinds (or any kind), and, when it has keywords, at least one keyword appears in the mod's text.
   - A **fix** of the same mod (same Nexus id or name) always counts and scores highest. A fix of another mod needs the same kinds, or a shared kind plus a keyword hit. Fixes that worked in game score higher; fixes that failed score lower and are labelled "did NOT work in game: don't repeat it".
   - Each pick keeps the reasons it was chosen.
3. `knowledgeMarkdown` writes `KNOWLEDGE.md` with every picked entry and its reasons. `taskMarkdown` writes `TASK.md`: the mod, the triage, a short "What Patchwright already knows" section, a plan from `GameAdapter.planFor` (one step per mod kind), the checks, the mods that depend on this one, the folder rules, and the `fix.json` format.

### Knowledge base

`KnowledgeStore` (`knowledge/store.ts`) merges the game adapter's built-in entries (`GameAdapter.knowledge`, for Cyberpunk in `games/cyberpunk2077/knowledge.ts`) with the user's own file, `<data>/knowledge/<game>.json`:

- A stored entry with a built-in entry's id overrides it, for example to record a different outcome. Removing a built-in entry only adds its id to `hidden`.
- When a job is ready, `learnFromJob` reads the AI's `fix.json` (problem, approach, lessons, keywords, patch changes) and stores a fix with outcome `untested`. New patch changes are added unless a similar one exists for the same patch (word overlap of 0.5 or more).
- `Engine.recordOutcome` sets `works`, `partial` or `failed` on both the job and its knowledge entry, from the Test or Knowledge page.
- Export writes the user's own entries (not the built-in ones) to a JSON file; import adds entries whose ids are new.
- Writes go through a queue, so two quick edits can't overwrite each other.

### AI backends

All three implement `AiBackend` (`ai/types.ts`): `test`, `ask` (one question), and `runAgent` (a tool-using session in the job folder).

- **Claude Code** runs the user's own `claude` program with `-p`, `--output-format stream-json`, `--permission-mode dontAsk`, `--allowedTools Read,Glob,Grep,Edit(./output/**),…` and `--disallowedTools Bash,…`, so it can read the job folder and edit only the writable paths. Patchwright never handles the sign-in.
- **Claude API** runs its own tool loop with streaming, adaptive thinking and prompt caching. Tool inputs are validated with zod before they run, and refusals, `pause_turn` and `max_tokens` stops are handled.
- **Local model** uses the OpenAI-compatible chat API with function calling, and also accepts tool calls written as JSON text, which some local models do.

The API and local backends share `ai/workspaceTools.ts`: list, read, search, write, edit and copy files, all resolved inside the job folder, with writes limited to the writable paths.

## Delivery and undo

A ready fix is copied to `<staging>\<fix name>` (an existing copy is moved to `backups/replaced` first) or zipped to `backups/fixes`. With Vortex automation on, the mod is also registered in Vortex's state and enabled in the test profile. Every step writes a changelog entry with its undo action:

| Undo action | What undo does |
|---|---|
| `remove-path` | moves the path to `backups/undone/<time>/` |
| `restore-path` | moves the backup back into place |
| `vortex-del` | deletes the state path through `Vortex.exe --del` |

## Tests

`tests/engine.test.ts` runs the whole engine on a temporary fake PC: a game folder, a staging folder with two script mods, a fake `Vortex.exe` (a Node script that keeps its state in a JSON file), and a scripted AI. It checks a mod, builds a fix from the task the app wrote, learns from it, installs it, registers it in Vortex, and undoes both. It then records the in-game result and checks that a similar mod starts from the learned fix. `tests/knowledge.test.ts` covers matching, the store and `KNOWLEDGE.md`. The other test files cover the parsers and decision logic.
