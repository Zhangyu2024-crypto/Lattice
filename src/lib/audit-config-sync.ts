import { USER_AGREEMENT_VERSION } from './user-agreement'
import type { PrivacyAuditPrefs } from '../stores/prefs-store'

export function isCurrentAgreementAccepted(privacy: PrivacyAuditPrefs): boolean {
  return privacy.acceptedAgreementVersion === USER_AGREEMENT_VERSION
}

export async function syncAuditConfigToMain(
  privacy: PrivacyAuditPrefs,
): Promise<void> {
  const electron = window.electronAPI
  if (!electron?.auditConfigure) return
  const accepted = isCurrentAgreementAccepted(privacy)
  await electron.auditConfigure({
    enabled: accepted && privacy.auditLoggingEnabled,
    acceptedAgreementVersion: privacy.acceptedAgreementVersion,
    currentAgreementVersion: USER_AGREEMENT_VERSION,
    retentionDays: privacy.auditRetentionDays,
  })
}
