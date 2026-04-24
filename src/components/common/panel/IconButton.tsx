import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  /** Required — used for both the tooltip and the accessible name. */
  title: string
  /** Shown when `label` is omitted. */
  icon?: ReactNode
  /** Compact text (e.g. toolbar abbreviation). When set, `icon` is ignored. */
  label?: string
  /** `ghost` has no border by default; `bordered` matches the VS Code
   *  toolbar-style outlined button. */
  variant?: 'ghost' | 'bordered'
  /** `xs` is the compact timeline inline button; `sm` is the default
   *  toolbar-sized button. */
  size?: 'sm' | 'xs'
  /** Toggle-state marker. When true, paints the button in the "on" state
   *  — matches VS Code's panel-toggle convention. */
  active?: boolean
}

/**
 * Compact icon-only button used in panel headers and task timeline rows.
 * Centralises padding, focus ring and hover treatment so every call site
 * stops re-declaring the same five inline style properties.
 */
export default function IconButton({
  title,
  label,
  icon,
  variant = 'ghost',
  size = 'sm',
  active = false,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const classes = [
    'panel-icon-btn',
    variant === 'bordered' ? 'bordered' : '',
    size,
    label ? 'with-label' : '',
    active ? 'active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
    >
      {label ? (
        <span className="panel-icon-btn-label">{label}</span>
      ) : (
        icon
      )}
    </button>
  )
}
