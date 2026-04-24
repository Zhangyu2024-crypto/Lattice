// Workbench-scoped command registry (W5). Each mounted Pro workbench
// registers its handlers on mount and de-registers on unmount; the
// palette fetches the registered command list for the currently-focused
// artifact. Keyed by `artifactId` so multiple workbench instances in
// the same session don't clobber each other.
//
// This intentionally lives separate from App-level `CommandPalette` so
// Pro commands (with arg parsing, schema, scope) can evolve without
// breaking the lightweight App-level one.

import type { Artifact, SpectrumTechnique } from '../../../../types/artifact'

// All Pro artifact kinds the registry routes for. `spectrum-pro` + all four
// legacy kinds are in scope so the unified workbench can register a single
// command set regardless of which kind it's rendering.
export type ProWorkbenchKind =
  | 'xrd-pro'
  | 'xps-pro'
  | 'raman-pro'
  | 'curve-pro'
  | 'spectrum-pro'

export type CommandArgType = 'string' | 'number' | 'boolean' | 'range'

export interface CommandArgSchema {
  name: string
  type: CommandArgType
  required?: boolean
  default?: unknown
  choices?: readonly string[]
  /** One-line description used in the palette arg hint. */
  description?: string
}

export interface CommandContext {
  kind: ProWorkbenchKind
  artifact: Artifact
  sessionId: string
  /** Resolved map of action functions the workbench registered. */
  handlers: Record<string, (...args: unknown[]) => unknown>
}

export interface CommandDef {
  /** Fully-qualified name shown in the palette, e.g. `"run refine"`. */
  name: string
  description: string
  /** Restrict a command to specific workbench kinds. When omitted the
   *  command is global across all Pro workbenches. */
  scope?: readonly ProWorkbenchKind[]
  /** Restrict a command to specific SpectrumTechnique lenses when running
   *  inside the unified workbench (e.g. `run refine` only makes sense when
   *  technique='xrd'). Legacy per-kind workbenches ignore this filter. */
  technique?: readonly SpectrumTechnique[]
  argsSchema?: readonly CommandArgSchema[]
  execute: (
    ctx: CommandContext,
    args: Record<string, unknown>,
  ) => Promise<void> | void
}

// ─── Module-level state ────────────────────────────────────────────

type ArtifactId = string

interface Registration {
  kind: ProWorkbenchKind
  artifact: Artifact
  sessionId: string
  handlers: Record<string, (...args: unknown[]) => unknown>
  commands: readonly CommandDef[]
}

const registrations = new Map<ArtifactId, Registration>()

export function registerWorkbench(
  artifactId: ArtifactId,
  registration: Registration,
): void {
  registrations.set(artifactId, registration)
}

export function unregisterWorkbench(artifactId: ArtifactId): void {
  registrations.delete(artifactId)
}

export function getRegistration(
  artifactId: ArtifactId,
): Registration | null {
  return registrations.get(artifactId) ?? null
}

export function getCommandsForArtifact(
  artifactId: ArtifactId,
  activeTechnique?: SpectrumTechnique,
): CommandDef[] {
  const reg = registrations.get(artifactId)
  if (!reg) return []
  return reg.commands.filter((c) => {
    if (c.scope && !c.scope.includes(reg.kind)) return false
    // When caller supplies the active lens (unified workbench) we honour
    // the per-technique filter; otherwise the command is considered global.
    if (c.technique && activeTechnique && !c.technique.includes(activeTechnique)) {
      return false
    }
    return true
  })
}

export async function executeCommand(
  artifactId: ArtifactId,
  commandName: string,
  args: Record<string, unknown>,
): Promise<{ success: true } | { success: false; error: string }> {
  const reg = registrations.get(artifactId)
  if (!reg) {
    return { success: false, error: 'No workbench is focused.' }
  }
  const cmd = reg.commands.find((c) => c.name === commandName)
  if (!cmd) {
    return { success: false, error: `Unknown command: ${commandName}` }
  }
  if (cmd.scope && !cmd.scope.includes(reg.kind)) {
    return {
      success: false,
      error: `${commandName} is not available in ${reg.kind} workbench.`,
    }
  }
  try {
    await cmd.execute(
      {
        kind: reg.kind,
        artifact: reg.artifact,
        sessionId: reg.sessionId,
        handlers: reg.handlers,
      },
      args,
    )
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Command-line parser ───────────────────────────────────────────

export interface ParsedCommand {
  name: string
  rawArgs: string
  args: Record<string, unknown>
  /** Errors accumulated while parsing individual args; parser still
   *  returns a best-effort parse so the palette can surface warnings
   *  but not refuse to dispatch. */
  argErrors: string[]
}

/**
 * Parse a raw command line into a ParsedCommand. Grammar (informal):
 *   cmd-name [more-words]* (--flag=value)* [positional]*
 * The command name greedily consumes as many `[a-z-]+` words as possible
 * before the first `--flag`. If the caller wants to validate the name
 * against a known set it should do so after parsing.
 */
export function parseCommandLine(line: string): ParsedCommand {
  const trimmed = line.trim()
  if (!trimmed) {
    return { name: '', rawArgs: '', args: {}, argErrors: [] }
  }
  // Split off flags. We scan until we find the first " --" or the
  // end of the string; everything before that is the command name.
  const flagIdx = findFlagStart(trimmed)
  const name =
    flagIdx === -1 ? trimmed : trimmed.slice(0, flagIdx).trim()
  const rest = flagIdx === -1 ? '' : trimmed.slice(flagIdx).trim()

  const args: Record<string, unknown> = {}
  const argErrors: string[] = []
  if (rest) {
    for (const token of splitTokens(rest)) {
      const m = /^--([a-zA-Z][\w-]*)=(.*)$/.exec(token)
      if (!m) {
        // Bare `--flag` with no value → boolean true.
        const b = /^--([a-zA-Z][\w-]*)$/.exec(token)
        if (b) {
          args[b[1]] = true
        } else {
          argErrors.push(`Ignoring unparsable token: ${token}`)
        }
        continue
      }
      const [, key, rawValue] = m
      args[key] = coerceValue(rawValue)
    }
  }

  return { name, rawArgs: rest, args, argErrors }
}

function findFlagStart(line: string): number {
  // Return the index of the first `--` preceded by a space or the
  // start of the line.
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '-' && line[i + 1] === '-') {
      if (i === 0 || /\s/.test(line[i - 1])) return i
    }
  }
  return -1
}

function splitTokens(s: string): string[] {
  // Respect double quotes so `--elements="Ti O"` keeps the space.
  const out: string[] = []
  let buf = ''
  let inQuote = false
  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (ch === ' ' && !inQuote) {
      if (buf) out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  if (buf) out.push(buf)
  return out
}

function coerceValue(raw: string): unknown {
  if (raw === 'true' || raw === 'yes') return true
  if (raw === 'false' || raw === 'no') return false
  // Range like `5-90`.
  const range = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(raw)
  if (range) {
    return [Number(range[1]), Number(range[2])] as [number, number]
  }
  // Numeric.
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  return raw
}

// ─── Fuzzy match helper ───────────────────────────────────────────

export interface MatchResult {
  command: CommandDef
  score: number
}

export function fuzzySearchCommands(
  commands: CommandDef[],
  query: string,
  limit = 8,
): MatchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return commands.slice(0, limit).map((c) => ({ command: c, score: 0 }))
  }
  const out: MatchResult[] = []
  for (const c of commands) {
    const hay = c.name.toLowerCase()
    let score = 0
    if (hay === q) score = 100
    else if (hay.startsWith(q)) score = 80 - Math.max(0, hay.length - q.length)
    else if (hay.includes(q)) score = 50 - Math.max(0, hay.length - q.length)
    else if (subsequence(hay, q)) score = 20
    if (score > 0) out.push({ command: c, score })
  }
  out.sort((a, b) => b.score - a.score || a.command.name.length - b.command.name.length)
  return out.slice(0, limit)
}

function subsequence(hay: string, needle: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i >= needle.length) return true
  }
  return false
}
