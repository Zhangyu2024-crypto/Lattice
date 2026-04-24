// Session-level permission-mode dropdown, mounted in ChatPanelHeader.
//
// One source of truth: `usePrefsStore.permissionMode`. Changing the mode
// retroactively affects any tool calls that start AFTER the change;
// in-flight pending approvals are left alone so a user can't accidentally
// auto-approve a card they're still reading.

import { useRef, useState } from 'react'
import { Check, ChevronDown, Shield, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { usePrefsStore } from '../../stores/prefs-store'
import {
  PERMISSION_MODES,
  PERMISSION_MODE_LABEL,
  PERMISSION_MODE_SHORT,
  PERMISSION_MODE_DESCRIPTION,
  type PermissionMode,
} from '../../types/permission-mode'
import { toast } from '../../stores/toast-store'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'

// Icon per mode — all from the `Shield*` family so the picker reads as
// a single semantic cluster. Picker button swaps the icon to match the
// current mode; open menu shows per-item icons for visual scanability.
const MODE_ICON: Record<PermissionMode, typeof Shield> = {
  normal: Shield,
  'auto-accept': ShieldCheck,
  'read-only': ShieldX,
  yolo: ShieldAlert,
}

// Modes that are "off-default enough" to warrant a toast confirmation
// after switching — so a muscle-memory click doesn't silently leave the
// user in YOLO for the next agent turn.
const NOISY_MODES: ReadonlySet<PermissionMode> = new Set(['yolo', 'read-only'])

export default function PermissionModePicker() {
  const mode = usePrefsStore((s) => s.permissionMode)
  const setMode = usePrefsStore((s) => s.setPermissionMode)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEscapeKey(() => setOpen(false), open)
  useOutsideClickDismiss(rootRef, open, () => setOpen(false))

  const CurrentIcon = MODE_ICON[mode]

  const select = (next: PermissionMode) => {
    setOpen(false)
    if (next === mode) return
    setMode(next)
    if (NOISY_MODES.has(next)) {
      const label = PERMISSION_MODE_LABEL[next]
      toast.info(`${label} mode: ${PERMISSION_MODE_DESCRIPTION[next]}`)
    }
  }

  return (
    <div ref={rootRef} className="permission-mode-picker">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`permission-mode-trigger${open ? ' is-open' : ''} mode-${mode}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={PERMISSION_MODE_DESCRIPTION[mode]}
      >
        <CurrentIcon size={12} strokeWidth={1.8} aria-hidden />
        <span className="permission-mode-trigger-label">
          {PERMISSION_MODE_SHORT[mode]}
        </span>
        <ChevronDown
          size={10}
          strokeWidth={1.8}
          aria-hidden
          className="permission-mode-trigger-chevron"
        />
      </button>
      {open ? (
        <div className="permission-mode-menu" role="listbox">
          {PERMISSION_MODES.map((m) => {
            const Icon = MODE_ICON[m]
            const selected = m === mode
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={selected}
                className={`permission-mode-menu-item${selected ? ' is-selected' : ''}`}
                onClick={() => select(m)}
              >
                <Icon size={12} strokeWidth={1.8} aria-hidden />
                <div className="permission-mode-menu-item-body">
                  <div className="permission-mode-menu-item-label">
                    {PERMISSION_MODE_LABEL[m]}
                  </div>
                  <div className="permission-mode-menu-item-desc">
                    {PERMISSION_MODE_DESCRIPTION[m]}
                  </div>
                </div>
                {selected ? (
                  <Check
                    size={11}
                    strokeWidth={2}
                    aria-hidden
                    className="permission-mode-menu-item-check"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
