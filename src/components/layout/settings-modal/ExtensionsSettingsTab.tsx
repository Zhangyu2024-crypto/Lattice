// Extensions tab — manages plugins (on-disk) and MCP servers (purely
// configured). Both land in the slash-command registry through their own
// loaders; this tab is just UI over `extensions-config-store`.

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Field, Section } from './primitives'
import {
  useExtensionsConfigStore,
  type McpServerConfig,
  type PluginConfig,
} from '../../../stores/extensions-config-store'
import { toast } from '../../../stores/toast-store'

interface DiscoveredPlugin {
  name: string
  manifest?: {
    name?: string
    description?: string
    version?: string
  }
  skills?: Array<{ fileName: string; source: string }>
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
  error?: string
}

export default function ExtensionsSettingsTab() {
  const plugins = useExtensionsConfigStore((s) => s.plugins)
  const mcpServers = useExtensionsConfigStore((s) => s.mcpServers)
  const setPluginEnabled = useExtensionsConfigStore((s) => s.setPluginEnabled)
  const upsertPluginConfig = useExtensionsConfigStore(
    (s) => s.upsertPluginConfig,
  )
  const removePluginConfig = useExtensionsConfigStore(
    (s) => s.removePluginConfig,
  )
  const addMcpServer = useExtensionsConfigStore((s) => s.addMcpServer)
  const updateMcpServer = useExtensionsConfigStore((s) => s.updateMcpServer)
  const removeMcpServer = useExtensionsConfigStore((s) => s.removeMcpServer)
  const setMcpServerEnabled = useExtensionsConfigStore(
    (s) => s.setMcpServerEnabled,
  )

  const [discovered, setDiscovered] = useState<DiscoveredPlugin[]>([])
  const [scanning, setScanning] = useState(false)

  const scan = async () => {
    const api = window.electronAPI
    if (!api?.listPlugins) {
      setDiscovered([])
      return
    }
    setScanning(true)
    try {
      const result = await api.listPlugins()
      setDiscovered(result.plugins ?? [])
      // Track newly-seen plugins in the store so users can enable them.
      for (const p of result.plugins ?? []) upsertPluginConfig(p.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to scan plugins: ${msg}`)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <Section title="Plugins">
        <p className="settings-modal-section-description">
          Drop a plugin folder in{' '}
          <code>&lt;userData&gt;/plugins/&lt;name&gt;/</code> with a{' '}
          <code>plugin.json</code> manifest. Markdown skills register as{' '}
          <code>/commands</code>; manifest tools run as reviewed Agent tools.
        </p>
        <div className="settings-modal-button-row">
          <button
            type="button"
            className="session-mini-btn"
            onClick={() => void scan()}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Rescan plugins folder'}
          </button>
        </div>
        {discovered.length === 0 ? (
          <p className="settings-modal-hint">No plugins found.</p>
        ) : (
          <ul className="settings-modal-list">
            {discovered.map((p) => (
              <PluginRow
                key={p.name}
                discovered={p}
                config={plugins.find((c) => c.name === p.name)}
                onToggle={(enabled) => setPluginEnabled(p.name, enabled)}
                onRemove={() => removePluginConfig(p.name)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="MCP servers">
        <p className="settings-modal-section-description">
          Each enabled server's <code>prompts</code> are exposed as{' '}
          <code>/server.prompt</code> commands. stdio transport only for now;
          sse / http can be added later.
        </p>
        <div className="settings-modal-button-row">
          <button
            type="button"
            className="session-mini-btn"
            onClick={() => addMcpServer()}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden /> Add server
          </button>
        </div>
        {mcpServers.length === 0 ? (
          <p className="settings-modal-hint">No MCP servers configured.</p>
        ) : (
          <ul className="settings-modal-list">
            {mcpServers.map((srv) => (
              <McpServerRow
                key={srv.id}
                server={srv}
                onToggle={(enabled) => setMcpServerEnabled(srv.id, enabled)}
                onPatch={(patch) => updateMcpServer(srv.id, patch)}
                onRemove={() => removeMcpServer(srv.id)}
              />
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

function PluginRow({
  discovered,
  config,
  onToggle,
  onRemove,
}: {
  discovered: DiscoveredPlugin
  config: PluginConfig | undefined
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}) {
  const enabled = config?.enabled ?? false
  const title = discovered.manifest?.name ?? discovered.name
  const description = discovered.manifest?.description
  const version = discovered.manifest?.version
  const skills = discovered.skills ?? []
  const tools = discovered.tools ?? []
  return (
    <li className="settings-modal-list-row">
      <div className="settings-modal-list-row-main">
        <div className="settings-modal-list-row-title">
          {title}
          {title !== discovered.name ? (
            <span className="settings-modal-list-row-badge">
              {discovered.name}
            </span>
          ) : null}
          {version ? (
            <span className="settings-modal-list-row-badge">
              v{version}
            </span>
          ) : null}
        </div>
        {description ? (
          <div className="settings-modal-list-row-sub">
            {description}
          </div>
        ) : null}
        <div className="settings-modal-list-row-sub">
          {skills.length} skill{skills.length === 1 ? '' : 's'} · {tools.length}{' '}
          executable tool{tools.length === 1 ? '' : 's'}
        </div>
        {tools.length > 0 ? (
          <div className="settings-modal-list-row-sub">
            Agent tools:{' '}
            {tools.map((tool) => (
              <code key={tool.name}>{tool.name}</code>
            ))}
          </div>
        ) : null}
        {discovered.error ? (
          <div className="settings-modal-list-row-error">
            Load error: {discovered.error}
          </div>
        ) : null}
      </div>
      <div className="settings-modal-list-row-actions">
        <label className="settings-modal-switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {enabled ? 'Enabled' : 'Disabled'}
        </label>
        <button
          type="button"
          className="session-mini-btn is-icon"
          onClick={onRemove}
          title="Forget this plugin (folder is not deleted)"
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </li>
  )
}

function McpServerRow({
  server,
  onToggle,
  onPatch,
  onRemove,
}: {
  server: McpServerConfig
  onToggle: (enabled: boolean) => void
  onPatch: (patch: Partial<McpServerConfig>) => void
  onRemove: () => void
}) {
  return (
    <li className="settings-modal-list-row settings-modal-list-row-form">
      <Field label="Name">
        <input
          type="text"
          className="settings-modal-input"
          value={server.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
      </Field>
      <Field label="Command">
        <input
          type="text"
          className="settings-modal-input"
          value={server.command}
          placeholder="e.g. npx"
          onChange={(e) => onPatch({ command: e.target.value })}
        />
      </Field>
      <Field label="Args (space-separated)">
        <input
          type="text"
          className="settings-modal-input"
          value={server.args.join(' ')}
          placeholder="e.g. -y @modelcontextprotocol/server-filesystem /Users/me"
          onChange={(e) =>
            onPatch({
              args: e.target.value.split(/\s+/).filter((s) => s.length > 0),
            })
          }
        />
      </Field>
      <div className="settings-modal-list-row-actions">
        <label className="settings-modal-switch">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {server.enabled ? 'Enabled' : 'Disabled'}
        </label>
        <button
          type="button"
          className="session-mini-btn is-icon"
          onClick={onRemove}
          title="Remove server"
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </li>
  )
}
