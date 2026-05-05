// Extensions tab — manages plugins (on-disk) and MCP servers (purely
// configured). Both land in the slash-command registry through their own
// loaders; this tab is just UI over `extensions-config-store`.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Command,
  FolderOpen,
  Plus,
  Power,
  Puzzle,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Section } from './primitives'
import {
  useExtensionsConfigStore,
  type McpServerConfig,
  type PluginConfig,
} from '../../../stores/extensions-config-store'
import { toast } from '../../../stores/toast-store'
import { parseFrontmatter } from '../../../lib/slash-commands/loaders/frontmatter'

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
  const addMcpServer = useExtensionsConfigStore((s) => s.addMcpServer)
  const updateMcpServer = useExtensionsConfigStore((s) => s.updateMcpServer)
  const removeMcpServer = useExtensionsConfigStore((s) => s.removeMcpServer)
  const setMcpServerEnabled = useExtensionsConfigStore(
    (s) => s.setMcpServerEnabled,
  )

  const [discovered, setDiscovered] = useState<DiscoveredPlugin[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const desktopPluginsAvailable =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.listPlugins)
  const desktopMcpAvailable =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.mcpReconcile)
  const enabledPluginCount = useMemo(
    () =>
      discovered.filter((p) => plugins.find((c) => c.name === p.name)?.enabled)
        .length,
    [discovered, plugins],
  )
  const pluginCapabilityCount = useMemo(
    () =>
      discovered.reduce(
        (sum, p) => sum + (p.skills?.length ?? 0) + (p.tools?.length ?? 0),
        0,
      ),
    [discovered],
  )
  const enabledMcpCount = mcpServers.filter((srv) => srv.enabled).length
  const pluginCapabilityDetail =
    pluginCapabilityCount === 1
      ? '1 command or tool capability found'
      : `${pluginCapabilityCount} command or tool capabilities found`

  const scan = async () => {
    const api = window.electronAPI
    if (!api?.listPlugins) {
      setDiscovered([])
      setScanError(null)
      return
    }
    setScanning(true)
    setScanError(null)
    try {
      const result = await api.listPlugins()
      setDiscovered(result.plugins ?? [])
      setScanError(result.error ?? null)
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

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onPluginsChanged?.(() => void scan())
    return () => unsubscribe?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="settings-extensions-root">
      <Section title="Overview">
        <div className="settings-extensions-overview">
          <OverviewCard
            icon={<Puzzle size={15} />}
            label="Plugins"
            value={
              desktopPluginsAvailable
                ? `${enabledPluginCount} / ${discovered.length} enabled`
                : 'Desktop only'
            }
            detail={
              desktopPluginsAvailable
                ? pluginCapabilityDetail
                : 'Desktop shell required for plugin discovery'
            }
            tone={desktopPluginsAvailable ? 'ok' : 'warn'}
          />
          <OverviewCard
            icon={<Server size={15} />}
            label="Tool servers"
            value={`${enabledMcpCount} / ${mcpServers.length} enabled`}
            detail={
              desktopMcpAvailable
                ? 'MCP runtime bridge available'
                : 'Server processes run in the desktop shell'
            }
            tone={desktopMcpAvailable ? 'ok' : 'warn'}
          />
        </div>
      </Section>

      <Section title="Installed plugins">
        <div className="settings-extensions-section-top">
          <p className="settings-modal-section-description">
            Plugins add slash commands and reviewed Agent tools. Enable only
            local plugins you trust, then rescan after installing updates.
          </p>
          <button
            type="button"
            className="settings-extensions-action-btn"
            onClick={() => void scan()}
            disabled={scanning || !desktopPluginsAvailable}
          >
            <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
            {scanning ? 'Scanning...' : 'Rescan plugins'}
          </button>
        </div>
        {scanError ? (
          <div className="settings-extensions-notice is-warn">
            <AlertTriangle size={14} aria-hidden />
            <span>{scanError}</span>
          </div>
        ) : null}
        {!desktopPluginsAvailable ? (
          <div className="settings-extensions-notice is-warn">
            <AlertTriangle size={14} aria-hidden />
            <span>
              Plugin discovery is only available in the Electron desktop app.
              Browser preview cannot read the local plugins folder.
            </span>
          </div>
        ) : discovered.length === 0 ? (
          <div className="settings-extensions-empty">
            <Puzzle size={18} aria-hidden />
            <div>
              <strong>No installed plugins</strong>
              <span>Install a plugin in the desktop plugins folder, then rescan.</span>
            </div>
          </div>
        ) : (
          <ul className="settings-extensions-list">
            {discovered.map((p) => (
              <PluginRow
                key={p.name}
                discovered={p}
                config={plugins.find((c) => c.name === p.name)}
                onToggle={(enabled) => setPluginEnabled(p.name, enabled)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tool servers">
        <div className="settings-extensions-section-top">
          <p className="settings-modal-section-description">
            MCP servers connect Lattice to local tools. Enabled servers can
            provide slash-command prompts and reviewed Agent tool calls.
          </p>
          <button
            type="button"
            className="settings-extensions-action-btn"
            onClick={() => addMcpServer()}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden /> Add server
          </button>
        </div>
        {!desktopMcpAvailable ? (
          <div className="settings-extensions-notice is-warn">
            <AlertTriangle size={14} aria-hidden />
            <span>
              MCP processes run in the desktop app. You can edit configuration
              here, but servers will not start from browser preview.
            </span>
          </div>
        ) : null}
        {mcpServers.length === 0 ? (
          <div className="settings-extensions-empty">
            <Server size={18} aria-hidden />
            <div>
              <strong>No tool servers</strong>
              <span>Add an MCP server command to connect local tools.</span>
            </div>
          </div>
        ) : (
          <ul className="settings-extensions-list">
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
    </div>
  )
}

function OverviewCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  tone: 'ok' | 'warn'
}) {
  return (
    <div className="settings-extensions-overview-card">
      <div className={`settings-extensions-overview-icon is-${tone}`} aria-hidden>
        {icon}
      </div>
      <div className="settings-extensions-overview-main">
        <div className="settings-extensions-overview-label">{label}</div>
        <div className="settings-extensions-overview-value">{value}</div>
        <div className="settings-extensions-overview-detail">{detail}</div>
      </div>
    </div>
  )
}

function PluginRow({
  discovered,
  config,
  onToggle,
}: {
  discovered: DiscoveredPlugin
  config: PluginConfig | undefined
  onToggle: (enabled: boolean) => void
}) {
  const enabled = config?.enabled ?? false
  const title = discovered.manifest?.name ?? discovered.name
  const description = discovered.manifest?.description
  const version = discovered.manifest?.version
  const skills = discovered.skills ?? []
  const tools = discovered.tools ?? []
  const commands = useMemo(
    () =>
      skills
        .map((skill) => getSkillCommandName(skill.fileName, skill.source))
        .filter((name): name is string => Boolean(name)),
    [skills],
  )
  const hasError = Boolean(discovered.error)
  const statusClass = hasError ? 'is-warn' : enabled ? 'is-ok' : 'is-muted'
  const statusLabel = hasError ? 'Load error' : enabled ? 'Enabled' : 'Disabled'

  return (
    <li
      className={`settings-extensions-item${enabled ? ' is-active' : ''}${
        hasError ? ' is-error' : ''
      }`}
    >
      <div className="settings-extensions-item-icon" aria-hidden>
        <Puzzle size={17} />
      </div>
      <div className="settings-extensions-item-main">
        <div className="settings-extensions-item-head">
          <div className="settings-extensions-title-block">
            <div className="settings-extensions-title-row">
              <strong>{title}</strong>
              <span className={`settings-extensions-pill ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <div className="settings-extensions-meta-row">
              <span>{discovered.name}</span>
              {version ? <span>v{version}</span> : null}
            </div>
          </div>
        </div>

        <div className="settings-extensions-description">
          {description || 'No plugin description provided.'}
        </div>

        <div className="settings-extensions-stat-row">
          <ExtensionStat
            icon={<Command size={13} />}
            value={`${commands.length} command${
              commands.length === 1 ? '' : 's'
            }`}
          />
          <ExtensionStat
            icon={<Wrench size={13} />}
            value={`${tools.length} Agent tool${tools.length === 1 ? '' : 's'}`}
          />
          <ExtensionStat icon={<FolderOpen size={13} />} value="Local plugin" />
        </div>

        {tools.length > 0 ? (
          <div className="settings-extensions-tool-list" aria-label="Agent tools">
            {tools.map((tool) => (
              <div className="settings-extensions-tool-row" key={tool.name}>
                <Wrench size={13} aria-hidden />
                <div className="settings-extensions-tool-main">
                  <code>{tool.name}</code>
                  <span>{tool.description || 'Reviewed Agent tool'}</span>
                </div>
                <span className="settings-extensions-tool-tag">Reviewed</span>
              </div>
            ))}
          </div>
        ) : null}
        {commands.length > 0 ? (
          <div className="settings-extensions-chip-row" aria-label="Slash commands">
            {commands.slice(0, 6).map((command) => (
              <code key={command}>/{command}</code>
            ))}
            {commands.length > 6 ? (
              <span className="settings-extensions-chip-more">
                +{commands.length - 6}
              </span>
            ) : null}
          </div>
        ) : null}
        {discovered.error ? (
          <div className="settings-extensions-error">
            Load error: {discovered.error}
          </div>
        ) : null}
      </div>
      <div className="settings-extensions-item-actions">
        <label className="settings-modal-switch settings-extensions-switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={hasError}
            aria-label={`Enable ${title}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <Power size={13} aria-hidden />
          Active
        </label>
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
  const ready = server.command.trim().length > 0

  return (
    <li
      className={`settings-extensions-item settings-extensions-item--form${
        server.enabled ? ' is-active' : ''
      }${ready ? '' : ' is-error'}`}
    >
      <div className="settings-extensions-item-icon" aria-hidden>
        <Server size={17} />
      </div>
      <div className="settings-extensions-item-main">
        <div className="settings-extensions-server-head">
          <div className="settings-extensions-title-block">
            <div className="settings-extensions-title-row">
              <strong>{server.name}</strong>
            </div>
            <div className="settings-extensions-meta-row">
              <span>{ready ? server.command : 'Launch command required'}</span>
            </div>
          </div>
          <span
            className={`settings-extensions-pill ${
              server.enabled && ready ? 'is-ok' : ready ? 'is-muted' : 'is-warn'
            }`}
          >
            {server.enabled && ready
              ? 'Enabled'
              : ready
                ? 'Disabled'
                : 'Needs setup'}
          </span>
        </div>

        <div className="settings-extensions-server-fields">
          <ServerField label="Display name">
            <input
              type="text"
              className="settings-modal-input"
              value={server.name}
              onChange={(e) => onPatch({ name: e.target.value })}
            />
          </ServerField>
          <ServerField label="Launch command">
            <input
              type="text"
              className="settings-modal-input"
              value={server.command}
              placeholder="e.g. npx"
              spellCheck={false}
              onChange={(e) => onPatch({ command: e.target.value })}
            />
          </ServerField>
          <ServerField label="Arguments">
            <input
              type="text"
              className="settings-modal-input"
              value={server.args.join(' ')}
              placeholder="e.g. -y @modelcontextprotocol/server-filesystem /Users/me"
              spellCheck={false}
              onChange={(e) =>
                onPatch({
                  args: e.target.value.split(/\s+/).filter((s) => s.length > 0),
                })
              }
            />
          </ServerField>
        </div>
      </div>
      <div className="settings-extensions-item-actions">
        <label className="settings-modal-switch settings-extensions-switch">
          <input
            type="checkbox"
            checked={server.enabled}
            aria-label={`Enable ${server.name}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <Power size={13} aria-hidden />
          Active
        </label>
        <button
          type="button"
          className="settings-extensions-icon-btn"
          onClick={onRemove}
          title="Remove server"
          aria-label={`Remove ${server.name}`}
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </li>
  )
}

function getSkillCommandName(fileName: string, source: string) {
  const parsed = parseFrontmatter(source)
  const rawName = parsed.data.name
  const name =
    typeof rawName === 'string' ? rawName.trim() : fileName.replace(/\.md$/i, '')
  if (!name || /\s/.test(name)) return null
  return name.toLowerCase()
}

function ExtensionStat({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="settings-extensions-stat">
      {icon}
      {value}
    </span>
  )
}

function ServerField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="settings-extensions-server-field">
      <span>{label}</span>
      {children}
    </label>
  )
}
