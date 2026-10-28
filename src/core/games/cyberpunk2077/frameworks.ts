import type { FrameworkDef } from '../types'

/**
 * Cyberpunk 2077 modding frameworks. Native ones (RED4ext plugins, CET) need a new build from their
 * authors for every game patch; mods built on them can't work until that build exists.
 */
export const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'red4ext',
    name: 'RED4ext',
    nexusModId: 2380,
    files: ['red4ext/RED4ext.dll'],
    versionFrom: { pe: 'red4ext/RED4ext.dll', log: 'red4ext/logs/red4ext.log', regex: /RED4ext \(?v?(\d+\.\d+\.\d+[\w.-]*)/i },
    native: true
  },
  {
    id: 'cet',
    name: 'Cyber Engine Tweaks',
    nexusModId: 107,
    files: ['bin/x64/plugins/cyber_engine_tweaks.asi'],
    versionFrom: {
      log: 'bin/x64/plugins/cyber_engine_tweaks/cyber_engine_tweaks.log',
      regex: /CET version v?(\d+\.\d+\.\d+[\w.-]*)/i
    },
    native: true,
    usedBy: [/registerForEvent\s*\(/, /GetMod\s*\(/]
  },
  {
    id: 'redscript',
    name: 'redscript',
    nexusModId: 1511,
    files: ['engine/tools/scc.exe'],
    versionFrom: { pe: 'engine/tools/scc.exe', log: 'r6/logs/redscript_rCURRENT.log', regex: /redscript.*?v?(\d+\.\d+\.\d+[\w.-]*)/i },
    native: true
  },
  {
    id: 'archivexl',
    name: 'ArchiveXL',
    nexusModId: 4198,
    files: ['red4ext/plugins/ArchiveXL/ArchiveXL.dll'],
    versionFrom: { pe: 'red4ext/plugins/ArchiveXL/ArchiveXL.dll', log: 'red4ext/plugins/ArchiveXL/ArchiveXL.log', regex: /ArchiveXL v?(\d+\.\d+\.\d+[\w.-]*)/i },
    native: true,
    minVersionFor: { '2.5': '1.28.1' }
  },
  {
    id: 'tweakxl',
    name: 'TweakXL',
    nexusModId: 4197,
    files: ['red4ext/plugins/TweakXL/TweakXL.dll'],
    versionFrom: { pe: 'red4ext/plugins/TweakXL/TweakXL.dll', log: 'red4ext/plugins/TweakXL/TweakXL.log', regex: /TweakXL v?(\d+\.\d+\.\d+[\w.-]*)/i },
    native: true
  },
  {
    id: 'codeware',
    name: 'Codeware',
    nexusModId: 7780,
    files: ['red4ext/plugins/Codeware/Codeware.dll'],
    versionFrom: { pe: 'red4ext/plugins/Codeware/Codeware.dll', log: 'red4ext/plugins/Codeware/Codeware.log', regex: /Codeware v?(\d+\.\d+\.\d+[\w.-]*)/i },
    native: true,
    minVersionFor: { '2.5': '1.21.1' },
    usedBy: [/\bCodeware\b/, /ModuleExists\("Codeware"\)/, /\bScriptableService\b/, /\bGameSessionEvent\b/]
  },
  {
    id: 'modsettings',
    name: 'Mod Settings',
    nexusModId: 4885,
    files: ['red4ext/plugins/mod_settings/mod_settings.dll'],
    versionFrom: { pe: 'red4ext/plugins/mod_settings/mod_settings.dll' },
    native: true,
    usedBy: [/ModSettings\./]
  },
  {
    id: 'inputloader',
    name: 'Input Loader',
    nexusModId: 4575,
    files: ['red4ext/plugins/input_loader/input_loader.dll'],
    versionFrom: { pe: 'red4ext/plugins/input_loader/input_loader.dll' },
    native: true
  },
  {
    id: 'nativesettings',
    name: 'Native Settings UI',
    nexusModId: 3518,
    files: ['bin/x64/plugins/cyber_engine_tweaks/mods/nativeSettings/init.lua'],
    native: false,
    usedBy: [/GetMod\(\s*["']nativeSettings["']\s*\)/]
  }
]

export function frameworkById(id: string): FrameworkDef | undefined {
  return FRAMEWORKS.find((f) => f.id === id)
}
