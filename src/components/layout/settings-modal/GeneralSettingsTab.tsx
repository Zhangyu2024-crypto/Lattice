import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from 'lucide-react'
import { usePrefsStore } from '../../../stores/prefs-store'
import { toast } from '../../../stores/toast-store'
import {
  PERMISSION_MODES,
  PERMISSION_MODE_LABEL,
  PERMISSION_MODE_DESCRIPTION,
  type PermissionMode,
} from '../../../types/permission-mode'
import type { AppUpdateStatusPayload } from '../../../types/electron'
import { Section } from './primitives'

const MODE_ICON: Record<PermissionMode, LucideIcon> = {
  normal: Shield,
  'auto-accept': ShieldCheck,
  'read-only': ShieldX,
  yolo: ShieldAlert,
}

export default function GeneralSettingsTab() {
  const mode = usePrefsStore((s) => s.permissionMode)
  const setMode = usePrefsStore((s) => s.setPermissionMode)
  const [updateStatus, setUpdateStatus] =
    useState<AppUpdateStatusPayload | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const updateSummary = useMemo(
    () => summarizeUpdateStatus(updateStatus),
    [updateStatus],
  )

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.appUpdateGetStatus) return
    let cancelled = false
    api.appUpdateGetStatus()
      .then((status) => {
        if (cancelled) return
        setUpdateStatus(status)
        if (status.state === 'idle' || status.state === 'checking') {
          void checkForUpdates()
        }
      })
      .catch(() => {
        // Keep the settings page usable if the desktop bridge is unavailable.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkForUpdates = async () => {
    const api = window.electronAPI
    if (!api?.appUpdateCheck) {
      toast.error('Update check is only available in the desktop app')
      return
    }
    setCheckingUpdate(true)
    try {
      const status = await api.appUpdateCheck()
      setUpdateStatus(status)
      if (status.state === 'available') {
        toast.success(`Lattice ${formatVersion(status.latestVersion)} is available`)
      } else if (status.state === 'latest') {
        toast.success('Lattice is up to date')
      } else if (status.state === 'error') {
        toast.error(status.error ?? 'Update check failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update check failed')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const openRelease = async () => {
    const api = window.electronAPI
    if (!api?.appUpdateOpenRelease) {
      toast.error('Release page is only available in the desktop app')
      return
    }
    try {
      const result = await api.appUpdateOpenRelease()
      if (!result.ok) toast.error(result.error)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open release')
    }
  }

  return (
    <>
      <Section title="App Updates">
        <div className={`settings-update-panel is-${updateSummary.tone}`}>
          <div className="settings-update-head">
            <div className={`settings-update-icon is-${updateSummary.tone}`} aria-hidden>
              {updateSummary.tone === 'ok' ? (
                <CheckCircle2 size={16} strokeWidth={1.8} />
              ) : updateSummary.tone === 'warn' ? (
                <AlertTriangle size={16} strokeWidth={1.8} />
              ) : (
                <RefreshCw size={16} strokeWidth={1.8} />
              )}
            </div>
            <div className="settings-update-main">
              <div className="settings-update-title">{updateSummary.title}</div>
              <div className="settings-update-detail">{updateSummary.detail}</div>
            </div>
            <div className="settings-update-version">
              {formatVersion(updateStatus?.currentVersion)}
            </div>
          </div>

          <div className="settings-update-meta">
            <InfoChip label="Current" value={formatVersion(updateStatus?.currentVersion)} />
            <InfoChip label="Latest" value={formatVersion(updateStatus?.latestVersion)} />
            <InfoChip label="Checked" value={formatCheckedAt(updateStatus?.checkedAt)} />
          </div>

          <div className="settings-update-actions">
            <button
              type="button"
              className="settings-update-btn"
              onClick={() => void checkForUpdates()}
              disabled={checkingUpdate || updateStatus?.state === 'checking'}
            >
              <RefreshCw size={14} aria-hidden />
              <span>
                {checkingUpdate || updateStatus?.state === 'checking'
                  ? 'Checking'
                  : 'Check now'}
              </span>
            </button>
            <button
              type="button"
              className="settings-update-btn"
              onClick={() => void openRelease()}
            >
              <ExternalLink size={14} aria-hidden />
              <span>Open release</span>
            </button>
          </div>
        </div>
      </Section>

      <Section title="Agent Permissions">
        <div className="settings-modal-compute-intro">
          Controls how the agent handles tool calls that read or write files,
          run code, or execute shell commands. Applies to all future tool
          calls in any session.
        </div>

        <div className="settings-permission-grid">
          {PERMISSION_MODES.map((m) => {
            const Icon = MODE_ICON[m]
            const active = m === mode
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`settings-permission-card${active ? ' is-active' : ''}`}
              >
                <div className="settings-permission-card-header">
                  <Icon
                    size={15}
                    strokeWidth={1.75}
                    aria-hidden
                    className="settings-permission-card-icon"
                  />
                  <span className="settings-permission-card-label">
                    {PERMISSION_MODE_LABEL[m]}
                  </span>
                </div>
                <span className="settings-permission-card-desc">
                  {PERMISSION_MODE_DESCRIPTION[m]}
                </span>
              </button>
            )
          })}
        </div>
      </Section>
    </>
  )
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-update-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function summarizeUpdateStatus(status: AppUpdateStatusPayload | null): {
  title: string
  detail: string
  tone: 'ok' | 'warn' | 'muted'
} {
  if (!status || status.state === 'idle') {
    return {
      title: 'Checking GitHub Releases',
      detail: 'Lattice checks periodically in the background.',
      tone: 'muted',
    }
  }
  if (status.state === 'checking') {
    return {
      title: 'Checking GitHub Releases',
      detail: 'Looking for the latest published release.',
      tone: 'muted',
    }
  }
  if (status.state === 'available') {
    return {
      title: `${formatVersion(status.latestVersion)} is available`,
      detail: status.assetName
        ? `Release asset: ${status.assetName}`
        : 'Open GitHub Releases to get the newest build.',
      tone: 'warn',
    }
  }
  if (status.state === 'error') {
    return {
      title: 'Update check failed',
      detail: status.error ?? 'GitHub Releases could not be reached.',
      tone: 'warn',
    }
  }
  return {
    title: 'Lattice is up to date',
    detail: `Latest version: ${formatVersion(status.latestVersion)}`,
    tone: 'ok',
  }
}

function formatVersion(value?: string): string {
  if (!value) return '-'
  return value.startsWith('v') ? value : `v${value}`
}

function formatCheckedAt(value?: string): string {
  if (!value) return 'Not yet'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time)
}
