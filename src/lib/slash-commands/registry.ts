// Slash-command registry.
//
// A single source of truth for every user-invocable `/cmd`. Sources:
// `./builtin` (builtin commands), `./loaders/skills` (user markdown skills),
// `./loaders/plugins-stub` (future plugin shape, currently empty). Name /
// alias lookup is case-insensitive and O(n) — fine for the ~10-60 command
// scale we expect; promote to a Map if the list grows past ~200.
//
// Collision rule (v1): builtin wins over everything else. When real skill
// and plugin loaders ship, precedence should be plugin > skill > builtin to
// match Claude Code, but v1 has no collisions.

import type { Command } from './types'
import { BUILTIN_COMMANDS } from './builtin'
import { loadSkillCommands } from './loaders/skills'
import { loadPluginCommands } from './loaders/plugins'
import { loadMcpCommands } from './loaders/mcp'

let cache: Command[] | null = null

function buildRegistry(): Command[] {
  // Order controls collision precedence: entries earlier in the merged
  // array win `findCommand`. MCP > plugins > skills > builtin. Rationale:
  // all three non-builtin sources default to "disabled / empty" until the
  // user explicitly enables them, so any collision was the user's choice;
  // letting the newer source override the builtin is the expected
  // behaviour.
  return [
    ...loadMcpCommands(),
    ...loadPluginCommands(),
    ...loadSkillCommands(),
    ...BUILTIN_COMMANDS,
  ]
}

/**
 * All registered commands, deduplicated by name (first-seen wins). Memoized
 * across calls — the builtins array is a module constant and the stub
 * loaders return empty arrays today, so there is nothing to invalidate yet.
 * When real loaders land, expose a `clearRegistryCache()` helper and call
 * it from the loader's refresh path.
 */
export function loadAllCommands(): Command[] {
  if (cache) return cache
  const seen = new Set<string>()
  const out: Command[] = []
  for (const cmd of buildRegistry()) {
    const key = cmd.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cmd)
  }
  cache = out
  return cache
}

/**
 * Drop the memoized command list so the next `loadAllCommands()` call
 * re-runs each source loader. Used by the skill loader after it finishes
 * warming its cache from IPC, so newly-read `*.md` files show up in the
 * `/` typeahead without a full app reload.
 */
export function invalidateRegistryCache(): void {
  cache = null
}

/** Test hook. Not exported from the module index. */
export function __resetRegistryCacheForTests(): void {
  cache = null
}

/**
 * Look up a command by name or alias. Case-insensitive. Returns `undefined`
 * when no match exists so the caller can surface an "Unknown command"
 * message without throwing.
 */
export function findCommand(name: string): Command | undefined {
  const target = name.toLowerCase()
  for (const cmd of loadAllCommands()) {
    if (cmd.name.toLowerCase() === target) return cmd
    if (cmd.aliases?.some((a) => a.toLowerCase() === target)) return cmd
  }
  return undefined
}

export interface ListCommandsFilter {
  /** When true, drop commands with `userInvocable: false`. */
  userInvocableOnly?: boolean
  /** When true, drop commands with `disableModelInvocation: true`. */
  modelInvocableOnly?: boolean
  /** When true, drop commands where `isEnabled()` returns false. */
  enabledOnly?: boolean
  /** When true, drop commands without a `paletteGroup`. */
  paletteOnly?: boolean
}

/**
 * Enumerate registered commands, optionally filtered. The default (no
 * filter) returns every loaded command — callers that need a specific
 * surface (typeahead, palette, SlashCommandTool) should pass the right
 * flags so intent is explicit at the call site.
 */
export function listCommands(filter: ListCommandsFilter = {}): Command[] {
  const all = loadAllCommands()
  return all.filter((cmd) => {
    if (filter.userInvocableOnly && cmd.userInvocable === false) return false
    if (filter.modelInvocableOnly && cmd.disableModelInvocation) return false
    if (filter.enabledOnly && cmd.isEnabled && cmd.isEnabled() === false)
      return false
    if (filter.paletteOnly && !cmd.paletteGroup) return false
    return true
  })
}
