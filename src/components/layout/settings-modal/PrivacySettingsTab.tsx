import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Trash2 } from 'lucide-react'
import {
  USER_AGREEMENT_VERSION,
} from '../../../lib/user-agreement'
import {
  isCurrentAgreementAccepted,
  syncAuditConfigToMain,
} from '../../../lib/audit-config-sync'
import {
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  usePrefsStore,
} from '../../../stores/prefs-store'
import { toast } from '../../../stores/toast-store'
import { Field, Section } from './primitives'

export default function PrivacySettingsTab() {
  const privacy = usePrefsStore((s) => s.privacy)
  const acceptUserAgreement = usePrefsStore((s) => s.acceptUserAgreement)
  const setPrivacyAudit = usePrefsStore((s) => s.setPrivacyAudit)
  const [logDir, setLogDir] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const accepted = isCurrentAgreementAccepted(privacy)

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.auditGetStatus?.()
      .then((status) => {
        if (!cancelled) setLogDir(status.logDir)
      })
      .catch(() => {
        if (!cancelled) setLogDir('')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateAuditEnabled = (enabled: boolean) => {
    if (enabled && !accepted) {
      acceptUserAgreement({ auditLoggingEnabled: false })
      setPrivacyAudit({ auditLoggingEnabled: true })
      return
    }
    setPrivacyAudit({ auditLoggingEnabled: enabled })
  }

  const handleRetentionChange = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return
    setPrivacyAudit({ auditRetentionDays: parsed })
  }

  const runAction = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Section title="User Agreement">
        <div className="settings-modal-compute-intro">
          Lattice uses the account and privacy terms provided on chaxiejun.xyz.
          Current acknowledged version: {accepted ? USER_AGREEMENT_VERSION : 'not acknowledged'}.
        </div>
        <div className="settings-modal-test-row">
          <a
            className="settings-modal-btn-secondary"
            href="https://chaxiejun.xyz"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
            Open chaxiejun.xyz
          </a>
          <button
            type="button"
            className="settings-modal-btn-primary"
            onClick={() => {
              acceptUserAgreement({
                auditLoggingEnabled: false,
              })
              toast.success('Account notice acknowledged')
            }}
          >
            <FileText size={15} strokeWidth={1.75} aria-hidden />
            Acknowledge
          </button>
        </div>
      </Section>

      <Section title="Local Records">
        <div className="settings-modal-compute-intro">
          Optional detailed records stay on this computer and remain disabled
          unless you turn them on.
        </div>

        <Field label="Status">
          <span className={`settings-modal-test-status${privacy.auditLoggingEnabled && accepted ? ' is-ok' : ''}`}>
            <span className="settings-modal-test-tag">
              {privacy.auditLoggingEnabled && accepted ? 'Enabled' : 'Disabled'}
            </span>
            {accepted
              ? `Accepted ${privacy.acceptedAt ? new Date(privacy.acceptedAt).toLocaleString() : ''}`
              : 'Not acknowledged'}
          </span>
        </Field>

        <Field label="Local records">
          <label className="settings-modal-switch">
            <input
              type="checkbox"
              checked={accepted && privacy.auditLoggingEnabled}
              onChange={(event) => updateAuditEnabled(event.target.checked)}
            />
            <span>Record detailed local activity metadata</span>
          </label>
        </Field>

        <Field label="Retention">
          <input
            className="settings-modal-input settings-privacy-retention"
            type="number"
            min={AUDIT_RETENTION_MIN_DAYS}
            max={AUDIT_RETENTION_MAX_DAYS}
            value={privacy.auditRetentionDays}
            onChange={(event) => handleRetentionChange(event.target.value)}
          />
          <span className="settings-privacy-field-note">days</span>
        </Field>

        <Field label="Record folder">
          <code className="settings-privacy-path">
            {logDir || 'Electron userData/logs/api-calls'}
          </code>
        </Field>

        <div className="settings-modal-test-row settings-privacy-actions">
          <button
            type="button"
            className="settings-modal-btn-primary"
            disabled={busy !== null}
            onClick={() =>
              void runAction('open', async () => {
                const res = await window.electronAPI?.auditOpenLogDir?.()
                if (!res?.ok) throw new Error(res?.error ?? 'Local record IPC unavailable')
              }).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
            }
          >
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
            Open folder
          </button>
          <button
            type="button"
            className="settings-modal-btn-primary"
            disabled={busy !== null}
            onClick={() =>
              void runAction('export', async () => {
                await syncAuditConfigToMain(usePrefsStore.getState().privacy)
                const res = await window.electronAPI?.auditExportLogs?.()
                if (!res?.ok) throw new Error(res?.error ?? 'Local record IPC unavailable')
                toast.success(`Exported ${res.fileCount} local record files`)
              }).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
            }
          >
            <Download size={15} strokeWidth={1.75} aria-hidden />
            Export
          </button>
          <button
            type="button"
            className="settings-modal-btn-primary settings-privacy-danger"
            disabled={busy !== null}
            onClick={() =>
              void runAction('clear', async () => {
                const res = await window.electronAPI?.auditClearLogs?.()
                if (!res?.ok) throw new Error(res?.error ?? 'Local record IPC unavailable')
                toast.success('Local records cleared')
              }).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
            }
          >
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
            Clear logs
          </button>
        </div>
      </Section>
    </>
  )
}
