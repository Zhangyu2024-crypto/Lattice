import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from 'lucide-react'
import { usePrefsStore } from '../../../stores/prefs-store'
import {
  PERMISSION_MODES,
  PERMISSION_MODE_LABEL,
  PERMISSION_MODE_DESCRIPTION,
  type PermissionMode,
} from '../../../types/permission-mode'
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

  return (
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
  )
}
