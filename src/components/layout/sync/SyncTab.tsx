import { useCallback, useEffect, useId, useState } from 'react'
import { toast } from '../../../stores/toast-store'
import type {
  SyncBackendKind,
  SyncConfigResult,
  SyncFolderStats,
  SyncStatusResult,
} from '../../../types/electron'

interface FormState {
  backend: SyncBackendKind
  remoteUrl: string
  username: string
  password: string
}

const EMPTY_FORM: FormState = {
  backend: 'webdav',
  remoteUrl: '',
  username: '',
  password: '',
}

const NUTSTORE_HINT = 'https://dav.jianguoyun.com/dav/<folder>/'
const RCLONE_HINT = '<remote>:<path>  (e.g. gdrive:lattice)'

const SYNC_ROOTS = [
  { id: 'library', label: 'library/', desc: 'Papers & PDFs' },
  { id: 'research', label: 'research/', desc: 'Research reports & drafts' },
  { id: 'artifacts', label: 'artifacts/', desc: 'Lattice-produced analysis results' },
  { id: 'compute-scripts', label: 'compute-scripts/', desc: 'Saved analysis scripts' },
  { id: 'raw', label: 'raw/', desc: 'Raw experimental data (opt-in, can be large)' },
] as const

const SYNC_PRESETS: Array<{ id: string; label: string; excluded: string[] }> = [
  { id: 'results-only', label: 'Results only', excluded: ['raw'] },
  { id: 'everything', label: 'Everything (incl. raw data)', excluded: [] },
  { id: 'minimal', label: 'Library + research only', excluded: ['artifacts', 'compute-scripts', 'raw'] },
]

type StatusOk = Extract<SyncStatusResult, { ok: true }>

function relativeTime(iso: string): string {
  if (!iso) return 'Never synced'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'Just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} hr ago`
  return new Date(iso).toLocaleDateString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SyncTab() {
  const urlId = useId()
  const userId = useId()
  const passId = useId()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [configured, setConfigured] = useState(false)
  const [autoPush, setAutoPush] = useState(false)
  const [autoPull, setAutoPull] = useState(false)
  const [syncInterval, setSyncInterval] = useState(0)
  const [excludedRoots, setExcludedRoots] = useState<string[]>([])
  const [remoteRoot, setRemoteRoot] = useState('Lattice')
  const [status, setStatus] = useState<StatusOk | null>(null)
  const [folderStats, setFolderStats] = useState<SyncFolderStats[] | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'push' | 'pull' | 'status'>(null)

  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined

  const loadConfig = useCallback(async () => {
    if (!electron?.syncGetConfig) return
    const res: SyncConfigResult = await electron.syncGetConfig()
    if (!res.ok) return
    setConfigured(res.configured)
    setAutoPush(res.autoPush)
    setAutoPull(res.autoPull)
    setSyncInterval(res.syncInterval ?? 0)
    setExcludedRoots(res.excludedRoots ?? [])
    setRemoteRoot(res.remoteRoot || 'Lattice')
    setForm((prev) => ({
      backend: (res.backend || 'webdav') as SyncBackendKind,
      remoteUrl: res.remoteUrl || prev.remoteUrl,
      username: res.username || prev.username,
      password: '',
    }))
  }, [electron])

  const refreshStatus = useCallback(async () => {
    if (!electron?.syncStatus) return
    setBusy('status')
    try {
      const res = await electron.syncStatus()
      if (res.ok) setStatus(res)
      else toast.error(`Status: ${res.error}`, { source: 'sync', type: 'runtime', detail: { operation: 'status' } })
    } finally {
      setBusy(null)
    }
  }, [electron])

  const loadFolderStats = useCallback(async () => {
    if (!electron?.syncFolderStats) return
    try {
      const res = await electron.syncFolderStats()
      if (res.ok) setFolderStats(res.folders)
    } catch { /* ignore */ }
  }, [electron])

  useEffect(() => { void loadConfig() }, [loadConfig])
  useEffect(() => {
    if (configured) {
      void refreshStatus()
      void loadFolderStats()
    }
  }, [configured, refreshStatus, loadFolderStats])

  if (!electron) {
    return (
      <section className="settings-modal-section">
        <h2 className="settings-modal-section-heading">Cloud sync</h2>
        <p className="settings-modal-preset-empty">
          Sync is only available in the Electron app.
        </p>
      </section>
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!form.remoteUrl.trim()) {
      toast.warn('Remote URL / remote name is required')
      return
    }
    setBusy('save')
    try {
      const res = await electron.syncSetup({
        backend: form.backend,
        remoteUrl: form.remoteUrl.trim(),
        username: form.username,
        password: form.password,
      })
      if (!res.ok) { toast.error(`Setup failed: ${res.error}`, { source: 'sync', type: 'config', detail: { operation: 'setup' } }); return }
      toast.success('Sync configured')
      await loadConfig()
      await refreshStatus()
      await loadFolderStats()
    } finally { setBusy(null) }
  }

  const handleTest = async (): Promise<void> => {
    setBusy('test')
    try {
      const payload = form.password
        ? { backend: form.backend, remoteUrl: form.remoteUrl.trim(), username: form.username, password: form.password }
        : undefined
      const res = await electron.syncTestConnection(payload)
      if (res.ok) toast.success(`Connected to ${res.backend}`)
      else toast.error(`Connection failed: ${res.error}`, { source: 'sync', type: 'network', detail: { operation: 'test' } })
    } finally { setBusy(null) }
  }

  const runPush = async (force = false): Promise<void> => {
    setBusy('push')
    try {
      const res = await electron.syncPush({ force })
      if (!res.ok) { toast.error(`Push failed: ${res.error}`, { source: 'sync', detail: { operation: 'push' } }); return }
      const msg = `↑${res.uploaded.length} uploaded · ${res.skipped.length} skipped · ${res.conflicts.length} conflicts`
      if (res.conflicts.length > 0 && !force) toast.warn(msg)
      else if (res.errors.length > 0) toast.error(`${msg} · ${res.errors.length} errors`, { source: 'sync', detail: { errors: res.errors } })
      else toast.success(msg)
      await refreshStatus()
      await loadFolderStats()
    } finally { setBusy(null) }
  }

  const runPull = async (force = false): Promise<void> => {
    setBusy('pull')
    try {
      const res = await electron.syncPull({ force })
      if (!res.ok) { toast.error(`Pull failed: ${res.error}`, { source: 'sync', detail: { operation: 'pull' } }); return }
      const msg = `↓${res.downloaded.length} downloaded · ${res.skipped.length} skipped`
      if (res.errors.length > 0) toast.error(`${msg} · ${res.errors.length} errors`)
      else toast.success(msg)
      await refreshStatus()
      await loadFolderStats()
    } finally { setBusy(null) }
  }

  const toggleAutoPush = async (enabled: boolean): Promise<void> => {
    setAutoPush(enabled)
    const res = await electron.syncSetAutoPush(enabled)
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'set-auto-push' } }); setAutoPush(!enabled) }
  }

  const toggleAutoPull = async (enabled: boolean): Promise<void> => {
    setAutoPull(enabled)
    const res = await electron.syncSetAutoPull(enabled)
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'set-auto-pull' } }); setAutoPull(!enabled) }
  }

  const handleIntervalChange = async (minutes: number): Promise<void> => {
    const prev = syncInterval
    setSyncInterval(minutes)
    const res = await electron.syncSetInterval(minutes)
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'set-interval' } }); setSyncInterval(prev) }
  }

  const handleToggleRoot = async (root: string, include: boolean): Promise<void> => {
    const prev = excludedRoots
    const next = include
      ? prev.filter((r) => r !== root)
      : [...prev, root]
    setExcludedRoots(next)
    const res = await electron.syncSetExcludedRoots(next)
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'toggle-root', root } }); setExcludedRoots(prev) }
    else { void loadFolderStats() }
  }

  const handleApplyPreset = async (excluded: string[]): Promise<void> => {
    const prev = excludedRoots
    setExcludedRoots(excluded)
    const res = await electron.syncSetExcludedRoots(excluded)
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'apply-preset' } }); setExcludedRoots(prev) }
    else { toast.success('Sync preset applied'); void loadFolderStats() }
  }

  const handleRemoteRootBlur = async (): Promise<void> => {
    const cleaned = remoteRoot.trim().replace(/^\/+|\/+$/g, '') || 'Lattice'
    if (cleaned === remoteRoot) return
    setRemoteRoot(cleaned)
    const res = await electron.syncSetRemoteRoot(cleaned)
    if (!res.ok) toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'set-remote-root' } })
  }

  const handleDisableAuto = async (): Promise<void> => {
    const res = await electron.syncDisableAuto()
    if (!res.ok) { toast.error(`Failed: ${res.error}`, { source: 'sync', detail: { operation: 'disable-auto' } }); return }
    setAutoPush(false)
    setAutoPull(false)
    setSyncInterval(0)
    toast.success('Auto-sync disabled')
  }

  return (
    <section className="settings-modal-section">
      <h2 className="settings-modal-section-heading">Cloud sync</h2>

      <div className="settings-modal-compute-intro">
        Sync your library and research reports via{' '}
        <strong>WebDAV</strong> or <strong>rclone</strong>.
        Sign-in details are stored locally (file mode 0600).
      </div>

      {/* ── Connection config ── */}
      <div className="settings-modal-field-grid">
        <span className="settings-modal-field-label">Backend</span>
        <div>
          <div className="settings-modal-mode-row">
            {(['webdav', 'rclone'] as const).map((b) => (
              <label key={b} className="settings-modal-mode-label">
                <input
                  type="radio"
                  checked={form.backend === b}
                  onChange={() => setForm((f) => ({ ...f, backend: b }))}
                  className="settings-modal-mode-radio"
                />
                {b === 'webdav' ? 'WebDAV' : 'rclone'}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-modal-field-grid">
        <span className="settings-modal-field-label">
          <label htmlFor={urlId}>{form.backend === 'webdav' ? 'URL' : 'Remote'}</label>
        </span>
        <input
          id={urlId}
          type="text"
          value={form.remoteUrl}
          onChange={(e) => setForm((f) => ({ ...f, remoteUrl: e.target.value }))}
          placeholder={form.backend === 'webdav' ? NUTSTORE_HINT : RCLONE_HINT}
          spellCheck={false}
          autoComplete="off"
          className="settings-modal-input"
        />
      </div>

      {form.backend === 'webdav' && (
        <>
          <div className="settings-modal-field-grid">
            <span className="settings-modal-field-label">
              <label htmlFor={userId}>Username</label>
            </span>
            <input
              id={userId}
              type="text"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="you@example.com"
              spellCheck={false}
              autoComplete="username"
              className="settings-modal-input"
            />
          </div>
          <div className="settings-modal-field-grid">
            <span className="settings-modal-field-label">
              <label htmlFor={passId}>Password</label>
            </span>
            <input
              id={passId}
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={configured ? '(unchanged)' : 'App-specific password'}
              autoComplete="new-password"
              className="settings-modal-input"
            />
          </div>
        </>
      )}

      <div className="settings-modal-test-row">
        <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={handleSave}>
          {busy === 'save' ? 'Saving…' : configured ? 'Update' : 'Save'}
        </button>
        <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={handleTest}>
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
      </div>

      {/* ── Configured: status + folders + auto-sync + actions ── */}
      {configured && (
        <>
          {/* Status card */}
          {status && (
            <div className="sync-status-card">
              <div className="sync-status-time">
                {relativeTime(status.lastSync)}
              </div>
              <div className="sync-status-detail">
                Root: <code>{remoteRoot}/</code> · {status.toPush.length} to push ·{' '}
                {status.toPull.length} to pull · {status.conflicts.length} conflicts ·{' '}
                {status.synced} synced
              </div>
            </div>
          )}

          {/* Remote folder */}
          <div className="sync-section-title">Remote folder</div>
          <div className="settings-modal-field-grid">
            <span className="settings-modal-field-label">Top-level name</span>
            <input
              type="text"
              value={remoteRoot}
              onChange={(e) => setRemoteRoot(e.target.value)}
              onBlur={() => void handleRemoteRootBlur()}
              placeholder="Lattice"
              className="settings-modal-input"
            />
          </div>
          <div className="settings-modal-compute-intro" style={{ marginTop: 4 }}>
            All files live under <code>{remoteRoot || 'Lattice'}/&lt;folder&gt;/</code>{' '}
            on the remote.
          </div>

          {/* Presets */}
          <div className="sync-section-title">What to sync</div>
          <div className="sync-preset-row">
            {SYNC_PRESETS.map((p) => {
              const active =
                p.excluded.length === excludedRoots.length &&
                p.excluded.every((r) => excludedRoots.includes(r))
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`compute-resources-chip${active ? ' is-active' : ''}`}
                  onClick={() => void handleApplyPreset(p.excluded)}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* Synced folders */}
          <div className="sync-folder-list" style={{ marginTop: 10 }}>
            {SYNC_ROOTS.map((r) => {
              const stats = folderStats?.find((f) => f.root === r.id)
              const excluded = excludedRoots.includes(r.id)
              return (
                <div key={r.id} className="sync-folder-row">
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={(e) => void handleToggleRoot(r.id, e.target.checked)}
                    className="sync-folder-toggle"
                  />
                  <div className="sync-folder-info">
                    <div className="sync-folder-name">{r.label}</div>
                    <div className="sync-folder-desc">{r.desc}</div>
                  </div>
                  {stats && (
                    <>
                      <span className="sync-folder-meta">
                        {stats.fileCount} files · {formatBytes(stats.totalBytes)}
                      </span>
                      <span className="sync-folder-status">
                        ↑{stats.toPush} ↓{stats.toPull}
                        {stats.conflicts > 0 && ` !${stats.conflicts}`}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          {excludedRoots.length === SYNC_ROOTS.length && (
            <div className="settings-modal-compute-intro" style={{ opacity: 0.7 }}>
              No folders selected — sync will have nothing to transfer.
            </div>
          )}

          {/* Auto-sync */}
          <div className="sync-section-title">Auto-sync</div>
          <div className="settings-modal-field-grid">
            <span className="settings-modal-field-label">Interval</span>
            <select
              className="sync-select"
              value={syncInterval}
              onChange={(e) => void handleIntervalChange(Number(e.target.value))}
            >
              <option value={0}>Disabled</option>
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
          </div>
          <div className="sync-auto-row">
            <label className="sync-auto-label">
              <input type="checkbox" checked={autoPull} onChange={(e) => void toggleAutoPull(e.target.checked)} />
              Pull on start
            </label>
            <label className="sync-auto-label">
              <input type="checkbox" checked={autoPush} onChange={(e) => void toggleAutoPush(e.target.checked)} />
              Push on quit
            </label>
            {(autoPush || autoPull || syncInterval > 0) && (
              <button
                type="button"
                className="sync-link-btn"
                onClick={() => void handleDisableAuto()}
              >
                Disable all
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="sync-section-title">Actions</div>
          <div className="settings-modal-test-row">
            <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={() => void runPush(false)}>
              {busy === 'push' ? 'Pushing…' : 'Push now'}
            </button>
            <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={() => void runPull(false)}>
              {busy === 'pull' ? 'Pulling…' : 'Pull now'}
            </button>
            <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={() => void refreshStatus()}>
              {busy === 'status' ? 'Checking…' : 'Refresh'}
            </button>
          </div>

          {/* Conflicts */}
          {status && status.conflicts.length > 0 && (
            <>
              <div className="sync-section-title">Conflicts ({status.conflicts.length})</div>
              <div className="settings-modal-compute-intro">
                Local copies are preserved as <code>*.conflict.*</code> sidecars
                when force-pulling.
              </div>
              <div className="settings-modal-test-row">
                <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={() => void runPush(true)}>
                  Force push (keep local)
                </button>
                <button type="button" className="settings-modal-btn-primary" disabled={busy !== null} onClick={() => void runPull(true)}>
                  Force pull (keep remote)
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
