import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import {
  USER_AGREEMENT_SECTIONS,
  USER_AGREEMENT_TITLE,
  USER_AGREEMENT_VERSION,
} from '../../lib/user-agreement'
import {
  isCurrentAgreementAccepted,
  syncAuditConfigToMain,
} from '../../lib/audit-config-sync'
import { usePrefsStore } from '../../stores/prefs-store'
import { toast } from '../../stores/toast-store'

export default function UserAgreementGate() {
  const privacy = usePrefsStore((s) => s.privacy)
  const acceptUserAgreement = usePrefsStore((s) => s.acceptUserAgreement)
  const setPrivacyAudit = usePrefsStore((s) => s.setPrivacyAudit)
  const [auditEnabled, setAuditEnabled] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const needsAgreement = !isCurrentAgreementAccepted(privacy)
  const open = needsAgreement && !dismissed

  useEffect(() => {
    void syncAuditConfigToMain(privacy).catch((err) => {
      toast.warn(
        `Could not update audit logging settings: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
  }, [privacy])

  useEffect(() => {
    if (needsAgreement) {
      setPrivacyAudit({ auditLoggingEnabled: false })
      setAuditEnabled(false)
    }
  }, [needsAgreement, setPrivacyAudit])

  const title = useMemo(() => {
    if (!privacy.acceptedAgreementVersion) return USER_AGREEMENT_TITLE
    return 'Updated User Agreement'
  }, [privacy.acceptedAgreementVersion])

  if (!open) return null

  return (
    <div className="agreement-modal-backdrop" role="presentation">
      <div
        className="agreement-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agreement-modal-title"
      >
        <header className="agreement-modal-header">
          <div className="agreement-modal-icon" aria-hidden>
            <ShieldCheck size={22} strokeWidth={1.75} />
          </div>
          <div className="agreement-modal-title-block">
            <h1 id="agreement-modal-title" className="agreement-modal-title">
              {title}
            </h1>
            <p className="agreement-modal-subtitle">
              Version {USER_AGREEMENT_VERSION}
            </p>
          </div>
          <button
            type="button"
            className="agreement-modal-close"
            aria-label="Dismiss agreement"
            title="Keep audit logging disabled"
            onClick={() => setDismissed(true)}
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="agreement-modal-body">
          {USER_AGREEMENT_SECTIONS.map((section) => (
            <section key={section.title} className="agreement-modal-section">
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </section>
          ))}
        </div>

        <label className="agreement-modal-checkbox">
          <input
            type="checkbox"
            checked={auditEnabled}
            onChange={(event) => setAuditEnabled(event.target.checked)}
          />
          <span>Enable local detailed audit logging after I accept</span>
        </label>

        <footer className="agreement-modal-footer">
          <button
            type="button"
            className="settings-modal-btn-primary agreement-modal-secondary"
            onClick={() => {
              acceptUserAgreement({ auditLoggingEnabled: false })
              setDismissed(true)
            }}
          >
            Accept, keep logging off
          </button>
          <button
            type="button"
            className="settings-modal-btn-primary"
            onClick={() => {
              acceptUserAgreement({ auditLoggingEnabled: auditEnabled })
              setDismissed(true)
            }}
          >
            Accept
          </button>
        </footer>
      </div>
    </div>
  )
}
