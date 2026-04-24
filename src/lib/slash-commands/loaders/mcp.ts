// MCP source — exposes each enabled server's `prompts` as a slash command.
//
// The renderer's `extensions-config-store` holds the user-authored server
// list (command + args + enabled bit). We push that list to the main
// process via `mcpReconcile` whenever it changes; main spawns / shuts down
// stdio clients accordingly. This loader then pulls the merged prompt
// catalog and turns each entry into a `PromptCommand` with
// `source: 'plugin'` (closest existing source tag — MCP prompts aren't
// really "skills" or "plugins", but we reuse the provenance slot until a
// dedicated `'mcp'` source lands).
//
// Command name shape: `<server-name>.<prompt-name>` unless the server
// name collides with another source, in which case users can rename the
// server in Settings. Aliases aren't populated — MCP prompts don't carry
// them.

import type { Command, PromptCommand } from '../types'
import { useExtensionsConfigStore } from '../../../stores/extensions-config-store'
import { invalidateRegistryCache } from '../registry'

export interface McpLoadError {
  serverId: string
  serverName: string
  message: string
}

let cache: Command[] = []
let lastErrors: McpLoadError[] = []

export function loadMcpCommands(): Command[] {
  return cache
}

export function getMcpLoadErrors(): readonly McpLoadError[] {
  return lastErrors
}

/**
 * Sync the user's configured server list to the main process, then pull
 * the aggregated `prompts/list` back and turn it into slash commands.
 * Call once at startup and again whenever the server list changes.
 */
export async function warmMcpCache(): Promise<void> {
  if (typeof window === 'undefined') return
  const api = window.electronAPI
  if (!api?.mcpReconcile || !api?.mcpListPrompts) return

  const servers = useExtensionsConfigStore
    .getState()
    .mcpServers.filter((s) => s.enabled && s.command.trim().length > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      args: s.args,
      env: s.env,
    }))

  try {
    const reconciled = await api.mcpReconcile(servers)
    const startupErrors: McpLoadError[] = (reconciled.errors ?? []).map(
      (e) => ({ serverId: e.serverId, serverName: e.name, message: e.message }),
    )

    const listed = await api.mcpListPrompts()
    const promptsErrors: McpLoadError[] = (listed.errors ?? []).map((e) => ({
      serverId: e.serverId,
      serverName: e.name,
      message: e.message,
    }))

    cache = (listed.prompts ?? []).map((entry) => buildPromptCommand(entry))
    // `Map` dedupe for the error list: if the same server failed twice
    // (reconcile + list) we only need to show it once.
    const mergedErrors = new Map<string, McpLoadError>()
    for (const e of [...startupErrors, ...promptsErrors]) {
      mergedErrors.set(e.serverId, e)
    }
    lastErrors = [...mergedErrors.values()]
    invalidateRegistryCache()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[slash-commands] MCP load failed:', err)
    cache = []
    lastErrors = [
      {
        serverId: '<ipc>',
        serverName: '<ipc>',
        message: err instanceof Error ? err.message : String(err),
      },
    ]
    invalidateRegistryCache()
  }
}

function buildPromptCommand(entry: {
  serverId: string
  serverName: string
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}): PromptCommand {
  const slug = sanitizeSegment(entry.serverName || entry.serverId)
  const fullName = `${slug}.${sanitizeSegment(entry.name)}`.toLowerCase()
  const argHint =
    entry.arguments && entry.arguments.length > 0
      ? entry.arguments
          .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
          .join(' ')
      : undefined

  const cmd: PromptCommand = {
    type: 'prompt',
    name: fullName,
    description: entry.description ?? `MCP prompt from ${entry.serverName}`,
    source: 'plugin',
    ...(argHint ? { argumentHint: argHint } : {}),
    getPrompt: async (rawArgs) => {
      const api = window.electronAPI
      if (!api?.mcpGetPrompt) {
        throw new Error('MCP bridge unavailable in this build.')
      }
      const args = coerceArgs(rawArgs, entry.arguments)
      const result = await api.mcpGetPrompt({
        serverId: entry.serverId,
        name: entry.name,
        args,
      })
      return result.text
    },
  }
  return cmd
}

// MCP prompts are typed as `{name: value}` pairs. For the slash layer we
// only have a single free-form args string — map it onto the first
// declared argument. Richer parsing (shell-style flags) can come later.
function coerceArgs(
  raw: string,
  declared: McpPromptDeclaredArgs,
): Record<string, string> | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (!declared || declared.length === 0) return undefined
  const first = declared[0]
  return { [first.name]: trimmed }
}

type McpPromptDeclaredArgs =
  | Array<{ name: string; description?: string; required?: boolean }>
  | undefined

function sanitizeSegment(value: string): string {
  // Slash names must be whitespace-free; squash runs of non-[a-z0-9-_.]
  // into a single dash. Keeps `server.name` readable for common cases.
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
