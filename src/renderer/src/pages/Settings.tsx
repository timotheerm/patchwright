import { useEffect, useState } from 'react'
import type { AiBackendKind, AiSettings, Settings, ToolCommands } from '../../../shared/types'
import { ActionButton, PathField, TextField, Toggle } from '../components'
import { useStore } from '../store'

const BACKENDS: { id: AiBackendKind; title: string; text: string }[] = [
  { id: 'claude-cli', title: 'Claude Code', text: 'Uses Claude Code installed on this PC, with your own sign-in. Best results.' },
  { id: 'claude-api', title: 'Claude API key', text: 'Pay per use with a key from the Claude Console.' },
  { id: 'openai-compatible', title: 'Local model', text: 'LM Studio, Ollama or any OpenAI-compatible server. Free, but weaker at fixes.' }
]

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

export function SettingsPage() {
  const { api, settings, setSettings, toast, refreshGame } = useStore()
  const [draft, setDraft] = useState<Settings | null>(settings)
  const [aiTest, setAiTest] = useState<{ ok: boolean; detail: string } | null>(null)
  const [nexusTest, setNexusTest] = useState<{ ok: boolean; detail: string } | null>(null)

  useEffect(() => {
    if (settings && !draft) setDraft(settings)
  }, [settings, draft])

  if (!draft) return <div className="page muted">Loading…</div>

  const set = (p: Partial<Settings>): void => setDraft({ ...draft, ...p })
  const setAi = (p: Partial<AiSettings>): void => setDraft({ ...draft, ai: { ...draft.ai, ...p } })
  const setTool = (p: Partial<ToolCommands>): void => setDraft({ ...draft, toolCommands: { ...draft.toolCommands, ...p } })
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  const save = async (extra: Partial<Settings> = {}): Promise<Settings> => {
    const s = await api.saveSettings({ ...draft, ...extra })
    setSettings(s)
    setDraft(s)
    return s
  }

  const num = (v: string): number | undefined => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v))

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Where things are on this PC, and which AI writes the fixes.</p>
        </div>
        <span className="spacer" />
        <ActionButton
          onClick={async () => {
            const found = await api.detectPaths()
            setDraft({ ...draft, ...found, ai: { ...draft.ai, ...(found.ai ?? {}) } })
            toast(`Found ${Object.keys(found).length} paths. Check them, then save.`, 'ok')
          }}
        >
          Find paths automatically
        </ActionButton>
        <ActionButton
          className="primary"
          disabled={!dirty && draft.onboarded}
          onClick={async () => {
            await save({ onboarded: true })
            toast('Settings saved.', 'ok')
            await refreshGame(true)
          }}
        >
          Save
        </ActionButton>
      </div>

      {!draft.onboarded && (
        <div className="notice">
          Welcome. Press <b>Find paths automatically</b>, check what it found, pick an AI, and save. Patchwright never changes your original mods or game files: every fix
          is a separate mod you can turn off in Vortex.
        </div>
      )}

      <div className="grid" style={{ gap: 16 }}>
        <div className="card">
          <h2>AI that writes the fixes</h2>
          <div className="backend-cards">
            {BACKENDS.map((b) => (
              <div key={b.id} className={`backend-card${draft.ai.backend === b.id ? ' on' : ''}`} onClick={() => setAi({ backend: b.id })}>
                <b>{b.title}</b>
                <span>{b.text}</span>
              </div>
            ))}
          </div>

          {draft.ai.backend === 'claude-cli' && (
            <div className="grid cols-2">
              <PathField
                label="Claude Code program"
                kind="file"
                value={draft.ai.claudeCliPath}
                onChange={(v) => setAi({ claudeCliPath: v })}
                placeholder="Found automatically if empty"
                hint="Sign in once by running claude in a terminal. Patchwright never sees your sign-in; Claude Code handles it."
              />
              <ModelField value={draft.ai.claudeModel} onChange={(v) => setAi({ claudeModel: v })} allowDefault />
            </div>
          )}
          {draft.ai.backend === 'claude-api' && (
            <div className="grid cols-2">
              <TextField
                label="API key"
                type="password"
                mono
                value={draft.ai.anthropicApiKey}
                onChange={(v) => setAi({ anthropicApiKey: v })}
                hint="From platform.claude.com. Stored encrypted on this PC."
              />
              <ModelField value={draft.ai.claudeModel} onChange={(v) => setAi({ claudeModel: v })} />
            </div>
          )}
          {draft.ai.backend === 'openai-compatible' && (
            <div className="grid cols-2">
              <TextField label="Server address" mono value={draft.ai.baseUrl} onChange={(v) => setAi({ baseUrl: v })} hint="LM Studio: http://localhost:1234/v1 · Ollama: http://localhost:11434/v1" />
              <TextField
                label="Model"
                mono
                value={draft.ai.localModel}
                onChange={(v) => setAi({ localModel: v })}
                placeholder="the model id the server shows"
                hint="Pick a model that supports tool calls and a long context (32k or more)."
              />
              <TextField label="API key (if the server needs one)" type="password" value={draft.ai.localApiKey} onChange={(v) => setAi({ localApiKey: v })} />
            </div>
          )}

          <div className="grid cols-3" style={{ marginTop: 4 }}>
            <TextField label="Fix rounds per mod" type="number" value={draft.ai.maxRounds} onChange={(v) => setAi({ maxRounds: num(v) ?? 4 })} hint="Each round: the AI edits, the app builds and checks." />
            <TextField label="AI steps per round" type="number" value={draft.ai.maxTurns} onChange={(v) => setAi({ maxTurns: num(v) ?? 60 })} />
            <TextField
              label="Spending limit per fix (USD)"
              type="number"
              value={draft.ai.maxBudgetUsd}
              onChange={(v) => setAi({ maxBudgetUsd: num(v) })}
              hint={draft.ai.backend === 'openai-compatible' ? 'Not used for local models.' : 'The fix stops when it reaches this.'}
            />
          </div>
          <div className="row">
            <ActionButton
              onClick={async () => {
                setAiTest(null)
                await save()
                setAiTest(await api.testAi())
              }}
            >
              Save and test
            </ActionButton>
            {aiTest && <span style={{ color: aiTest.ok ? 'var(--green)' : 'var(--red)' }}>{aiTest.detail}</span>}
          </div>
        </div>

        <div className="grid cols-2">
          <div className="card">
            <h2>Game and Vortex</h2>
            <PathField label="Cyberpunk 2077 folder" kind="folder" value={draft.gamePath} onChange={(v) => set({ gamePath: v })} />
            <PathField label="Saves folder" kind="folder" value={draft.savesPath} onChange={(v) => set({ savesPath: v })} />
            <PathField label="Vortex program" kind="file" value={draft.vortexExe} onChange={(v) => set({ vortexExe: v })} />
            <PathField
              label="Vortex staging folder"
              kind="folder"
              value={draft.vortexStagingPath}
              onChange={(v) => set({ vortexStagingPath: v })}
              hint="Where Vortex keeps installed mods. Fixes are added here as new mods."
            />
            <TextField label="Test profile name" value={draft.testProfileName} onChange={(v) => set({ testProfileName: v })} hint="{patch} becomes the patch version." />
            <Toggle
              checked={draft.vortexAutomation}
              onChange={(v) => set({ vortexAutomation: v })}
              label="Register fixes in Vortex for me (experimental)"
              hint="Edits Vortex's state through its command line while Vortex is closed. Every change is logged and can be undone."
            />
          </div>

          <div className="card">
            <h2>Nexus Mods</h2>
            <TextField
              label="Personal API key"
              type="password"
              mono
              value={draft.nexusApiKey}
              onChange={(v) => set({ nexusApiKey: v })}
              hint="From nexusmods.com > Site preferences > API keys. Needed for release dates and collections."
            />
            <div className="row" style={{ marginBottom: 14 }}>
              <ActionButton
                onClick={async () => {
                  setNexusTest(null)
                  await save()
                  setNexusTest(await api.testNexus())
                }}
              >
                Save and test
              </ActionButton>
              {nexusTest && <span style={{ color: nexusTest.ok ? 'var(--green)' : 'var(--red)' }}>{nexusTest.detail}</span>}
            </div>
            <Toggle checked={draft.communityChecks} onChange={(v) => set({ communityChecks: v })} label="Read Nexus posts for reports" hint="Looks for posts saying a mod works or is broken on the new patch." />
            <Toggle
              checked={draft.communityViaAi}
              onChange={(v) => set({ communityViaAi: v })}
              label="Let the AI read the posts"
              hint="Claude Code reads the mod's posts page itself (nexusmods.com only). Better than keyword search, costs a little."
            />
            <hr className="sep" />
            <h2>Patch</h2>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <TextField
                label="Compare against version"
                value={draft.patchOverride?.version}
                placeholder="latest"
                onChange={(v) => set({ patchOverride: v ? { version: v, releaseDate: draft.patchOverride?.releaseDate ?? '' } : undefined })}
              />
              <TextField
                label="Released on"
                value={draft.patchOverride?.releaseDate}
                placeholder="yyyy-mm-dd"
                onChange={(v) => draft.patchOverride && set({ patchOverride: { ...draft.patchOverride, releaseDate: v } })}
              />
            </div>
            <div className="faint small">Leave empty to use the latest patch from Steam news.</div>
          </div>
        </div>

        <div className="grid cols-2">
          <div className="card">
            <h2>Modding tools</h2>
            <PathField
              label="WolvenKit command line (WolvenKit.CLI.exe)"
              kind="file"
              value={draft.wolvenkitCli}
              onChange={(v) => set({ wolvenkitCli: v })}
              hint="Needed for .archive mods. Use a version that supports the current patch; for 2.5 that is 10.0 beta or newer."
            />
            <PathField
              label="redscript compiler (scc.exe or redscript-cli.exe)"
              kind="file"
              value={draft.redscriptCli}
              onChange={(v) => set({ redscriptCli: v })}
              hint="Optional. Test-compiles script mods against the game's scripts."
            />
            <details>
              <summary className="muted small" style={{ cursor: 'pointer', marginBottom: 10 }}>
                Command templates
              </summary>
              {(Object.keys(draft.toolCommands) as (keyof ToolCommands)[]).map((k) => (
                <TextField key={k} label={k} mono value={draft.toolCommands[k]} onChange={(v) => setTool({ [k]: v })} />
              ))}
              <div className="faint small">{'{in}'}, {'{out}'}, {'{regex}'} and {'{bundle}'} are filled in. Change these if a tool version uses different arguments.</div>
            </details>
          </div>

          <div className="card">
            <h2>Backups and fixes</h2>
            <PathField label="Backups folder" kind="folder" value={draft.backupsPath} onChange={(v) => set({ backupsPath: v })} hint="Saves, replaced files and CHANGELOG.md go here." />
            <PathField label="Work folder" kind="folder" value={draft.workspacePath} onChange={(v) => set({ workspacePath: v })} hint="Each fix gets a folder here with the AI's notes and reports." />
            <TextField label="Fix mod name" value={draft.fixNameTemplate} onChange={(v) => set({ fixNameTemplate: v })} hint="{name} and {patch} are filled in." />
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelField({ value, onChange, allowDefault }: { value: string; onChange: (v: string) => void; allowDefault?: boolean }) {
  return (
    <div className="field">
      <label>Model</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowDefault && <option value="">Claude Code's default</option>}
        {CLAUDE_MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {value && !CLAUDE_MODELS.includes(value) && <option value={value}>{value}</option>}
      </select>
      <div className="hint">Opus is the strongest at fixes. Sonnet is cheaper and usually good enough for script mods.</div>
    </div>
  )
}
