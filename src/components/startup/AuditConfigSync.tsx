import { useEffect } from 'react'
import { syncAuditConfigToMain } from '../../lib/audit-config-sync'
import { usePrefsStore } from '../../stores/prefs-store'
import { toast } from '../../stores/toast-store'

export default function AuditConfigSync() {
  const privacy = usePrefsStore((s) => s.privacy)

  useEffect(() => {
    void syncAuditConfigToMain(privacy).catch((err) => {
      toast.warn(
        `Could not update local record settings: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
  }, [privacy])

  return null
}
