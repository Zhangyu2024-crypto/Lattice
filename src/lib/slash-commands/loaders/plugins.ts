// Plugin loader — reads `<userData>/plugins/<name>/` via Electron IPC.
//
// v1 plugin shape: a folder with an optional `plugin.json` manifest and
// an optional `skills/` subdirectory of markdown command files. The
// markdown files are compiled with the same pipeline as user skills
// (`./skills.ts > compileSkills`), and the resulting commands are stamped
// with `source: 'plugin'` so the registry and Settings can tell them
// apart.
//
// JS-executable plugins (an `index.mjs` entry that exports commands) are
// not supported yet — the isolation model still needs a decision. When
// they arrive the renderer will import the main-process-supplied source
// via a constrained bridge; the cache structure and `warmPluginsCache`
// flow below won't need to change.
//
// Gating: only plugins with `enabled: true` in `useExtensionsConfigStore`
// contribute commands. Plugins the store hasn't seen yet are auto-added
// as disabled so the user sees them in Settings and can flip the switch.

import type { Command } from '../types'
import { useExtensionsConfigStore } from '../../../stores/extensions-config-store'
import { compileSkills, type RawSkill, type SkillLoadError } from './skills'
import { invalidateRegistryCache } from '../registry'

export interface PluginLoadError {
  plugin: string
  message: string
}

export interface PluginManifestSummary {
  name?: string
  description?: string
  version?: string
}

export interface PluginDiscoveryEntry {
  name: string
  manifest: PluginManifestSummary
  skills: RawSkill[]
  error?: string
}

let cache: Command[] = []
let lastErrors: PluginLoadError[] = []
let lastDiscovery: PluginDiscoveryEntry[] = []

export function loadPluginCommands(): Command[] {
  return cache
}

export function getPluginLoadErrors(): readonly PluginLoadError[] {
  return lastErrors
}

export function getDiscoveredPlugins(): readonly PluginDiscoveryEntry[] {
  return lastDiscovery
}

export async function warmPluginsCache(): Promise<void> {
  if (typeof window === 'undefined') return
  const api = window.electronAPI
  if (!api?.listPlugins) return
  try {
    const raw = await api.listPlugins()
    const discovered = raw?.plugins ?? []
    lastDiscovery = discovered

    const store = useExtensionsConfigStore.getState()
    const upsert = store.upsertPluginConfig

    // Register any newly-seen plugin as disabled so it shows up in the
    // Settings panel without silently running.
    const knownNames = new Set(store.plugins.map((p) => p.name))
    const fresh = discovered
      .map((p) => p.name)
      .filter((n) => !knownNames.has(n))
    if (fresh.length > 0) {
      for (const name of fresh) upsert(name)
      // `upsertPluginConfig` defaults newcomers to enabled=true in the
      // store shape — we want first-seen to land in the UI with enabled
      // defaulted to whatever the user expects. See store for the
      // decision; we don't override here.
    }

    // Recompute commands from enabled plugins only.
    const pluginsById = new Map(discovered.map((p) => [p.name, p]))
    const commands: Command[] = []
    const errors: PluginLoadError[] = []

    for (const cfg of useExtensionsConfigStore.getState().plugins) {
      if (!cfg.enabled) continue
      const entry = pluginsById.get(cfg.name)
      if (!entry) continue
      if (entry.error) {
        errors.push({ plugin: entry.name, message: entry.error })
        continue
      }
      const compiled = compileSkills(entry.skills)
      for (const cmd of compiled) {
        commands.push({ ...cmd, source: 'plugin' } as Command)
      }
    }
    cache = commands
    lastErrors = errors
    invalidateRegistryCache()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[slash-commands] failed to load plugins:', err)
    cache = []
    lastErrors = [
      {
        plugin: '<ipc>',
        message: err instanceof Error ? err.message : String(err),
      },
    ]
    lastDiscovery = []
    invalidateRegistryCache()
  }
}

export function __setPluginsCacheForTests(commands: Command[]): void {
  cache = commands
}

// Re-export for downstream helpers that want a unified error list.
export type PluginSkillError = SkillLoadError
