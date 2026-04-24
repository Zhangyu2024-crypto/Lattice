import { forwardRef, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Visual tone for a status-bar chip.
 *
 *  - `default` — primary text color (same as surrounding chips).
 *  - `muted`   — 70% opacity; use for low-signal metadata (e.g. composer mode).
 *  - `warn`    — amber text; pairs well with a trailing warning glyph supplied
 *                by the caller (keeping the primitive agnostic to its payload).
 */
export type StatusChipTone = 'default' | 'muted' | 'warn' | 'critical'

export interface StatusChipProps {
  /** Optional leading icon. Callers size it (lucide icons render at 14px in the bar). */
  icon?: ReactNode
  /** Native browser tooltip. */
  title?: string
  /** Visual tone; see {@link StatusChipTone}. */
  tone?: StatusChipTone
  /**
   * If provided, the chip becomes interactive: keyboard-focusable, activatable
   * via Enter/Space, and styled with the `--clickable` modifier.
   */
  onClick?: () => void
  /** Mirrors `aria-haspopup` when the chip opens a popover/menu. */
  ariaHasPopup?: 'dialog' | 'menu'
  /** Mirrors `aria-expanded` for disclosure-style chips. */
  ariaExpanded?: boolean
  /** Optional accessible label override; defaults to the visible text. */
  ariaLabel?: string
  children: ReactNode
}

const TONE_CLASS: Record<StatusChipTone, string> = {
  default: '',
  muted: 'status-chip--muted',
  warn: 'status-chip--warn',
  critical: 'status-chip--critical',
}

/**
 * Unified primitive for `<StatusBar>` chips.
 *
 * Refs are forwarded to the outer element so consumers (e.g. `UsagePopover`)
 * can anchor floating UI to the chip's bounding box.
 */
const StatusChip = forwardRef<HTMLDivElement, StatusChipProps>(function StatusChip(
  {
    icon,
    title,
    tone = 'default',
    onClick,
    ariaHasPopup,
    ariaExpanded,
    ariaLabel,
    children,
  },
  ref,
) {
  const clickable = typeof onClick === 'function'

  const classes = ['status-chip']
  if (clickable) classes.push('status-chip--clickable')
  const toneClass = TONE_CLASS[tone]
  if (toneClass) classes.push(toneClass)

  const handleKeyDown = clickable
    ? (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick!()
        }
      }
    : undefined

  return (
    <div
      ref={ref}
      className={classes.join(' ')}
      title={title}
      onClick={clickable ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={clickable && ariaHasPopup ? ariaExpanded : undefined}
      aria-label={ariaLabel}
    >
      {icon}
      {children}
    </div>
  )
})

export default StatusChip
