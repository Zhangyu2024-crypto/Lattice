// Config for user-installed extensions: plugins and MCP servers.
//
// Plugins live on disk at `<userData>/plugins/<name>/` and are discovered
// automatically by the plugin loader; this store only remembers the
// `enabled` bit per plugin name. MCP servers are purely configured here
// (command + args + env) since they have no on-disk manifest.
//
// Persisted to localStorage via zustand/middleware. Mirrors the pattern
// used by compute-config-store so the two feel the same in Settings.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { genShortId } from '../lib/id-gen'

export interface PluginConfig {
  /** Plugin directory name under `<userData>/plugins/`. */
  name: string
  enabled: boolean
}

export type McpTransport = 'stdio'

export interface McpServerConfig {
  id: string
  /** Display name — also used as the command-name prefix. */
  name: string
  enabled: boolean
  transport: McpTransport
  command: string
  args: string[]
  env?: Record<string, string>
}

interface ExtensionsConfigState {
  plugins: PluginConfig[]
  mcpServers: McpServerConfig[]

  setPluginEnabled: (name: string, enabled: boolean) => void
  upsertPluginConfig: (name: string) => void
  removePluginConfig: (name: string) => void

  addMcpServer: (init?: Partial<McpServerConfig>) => string
  updateMcpServer: (id: string, patch: Partial<McpServerConfig>) => void
  removeMcpServer: (id: string) => void
  setMcpServerEnabled: (id: string, enabled: boolean) => void
}

export const useExtensionsConfigStore = create<ExtensionsConfigState>()(
  persist(
    (set) => ({
      plugins: [],
      mcpServers: [],

      setPluginEnabled: (name, enabled) =>
        set((s) => ({
          plugins: s.plugins.some((p) => p.name === name)
            ? s.plugins.map((p) => (p.name === name ? { ...p, enabled } : p))
            : [...s.plugins, { name, enabled }],
        })),
      upsertPluginConfig: (name) =>
        set((s) =>
          s.plugins.some((p) => p.name === name)
            ? s
            : { plugins: [...s.plugins, { name, enabled: false }] },
        ),
      removePluginConfig: (name) =>
        set((s) => ({ plugins: s.plugins.filter((p) => p.name !== name) })),

      addMcpServer: (init = {}) => {
        const id = genShortId('mcp')
        set((s) => ({
          mcpServers: [
            ...s.mcpServers,
            {
              id,
              name: init.name ?? 'new-server',
              enabled: init.enabled ?? false,
              transport: 'stdio',
              command: init.command ?? '',
              args: init.args ?? [],
              env: init.env,
            },
          ],
        }))
        return id
      },
      updateMcpServer: (id, patch) =>
        set((s) => ({
          mcpServers: s.mcpServers.map((srv) =>
            srv.id === id ? { ...srv, ...patch } : srv,
          ),
        })),
      removeMcpServer: (id) =>
        set((s) => ({
          mcpServers: s.mcpServers.filter((srv) => srv.id !== id),
        })),
      setMcpServerEnabled: (id, enabled) =>
        set((s) => ({
          mcpServers: s.mcpServers.map((srv) =>
            srv.id === id ? { ...srv, enabled } : srv,
          ),
        })),
    }),
    {
      name: 'lattice-extensions-config',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
