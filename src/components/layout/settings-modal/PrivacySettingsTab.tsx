import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Trash2 } from 'lucide-react'
import {
  USER_AGREEMENT_SECTIONS,
  USER_AGREEMENT_TITLE,
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
      toast.warn('Accept the current user agreement before enabling audit logs.')
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
          {USER_AGREEMENT_TITLE}. Current version: {USER_AGREEMENT_VERSION}.
        </div>
        <div className="settings-privacy-agreement">
          {USER_AGREEMENT_SECTIONS.map((section) => (
            <details key={section.title} className="settings-privacy-agreement-item">
              <summary>{section.title}</summary>
              <p>{section.body}</p>
            </details>
          ))}
        </div>
        <div className="settings-modal-test-row">
          <button
            type="button"
            className="settings-modal-btn-primary"
            onClick={() => {
              acceptUserAgreement({
                auditLoggingEnabled: privacy.auditLoggingEnabled,
              })
              toast.success('User agreement accepted')
            }}
          >
            <FileText size={15} strokeWidth={1.75} aria-hidden />
            Accept current version
          </button>
        </div>
      </Section>

      <Section title="Local Audit Logs">
        <div className="settings-modal-compute-intro">
          Detailed call records stay on this computer and are written only
          after the current agreement is accepted and logging is enabled.
        </div>

        <Field label="Status">
          <span className={`settings-modal-test-status${privacy.auditLoggingEnabled && accepted ? ' is-ok' : ''}`}>
            <span className="settings-modal-test-tag">
              {privacy.auditLoggingEnabled && accepted ? 'Enabled' : 'Disabled'}
            </span>
            {accepted
              ? `Accepted ${privacy.acceptedAt ? new Date(privacy.acceptedAt).toLocaleString() : ''}`
              : 'Current agreement not accepted'}
          </span>
        </Field>

        <Field label="Audit logging">
          <label className="settings-modal-switch">
            <input
              type="checkbox"
              checked={accepted && privacy.auditLoggingEnabled}
              disabled={!accepted}
              onChange={(event) => updateAuditEnabled(event.target.checked)}
            />
            <span>Record detailed local call metadata</span>
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

        <Field label="Log folder">
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
                if (!res?.ok) throw new Error(res?.error ?? 'Audit IPC unavailable')
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
                if (!res?.ok) throw new Error(res?.error ?? 'Audit IPC unavailable')
                toast.success(`Exported ${res.fileCount} audit files`)
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
                if (!res?.ok) throw new Error(res?.error ?? 'Audit IPC unavailable')
                toast.success('Audit logs cleared')
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
