// Badge — unified inline chip / pill. Replaces the 7+ chip styles that
// individual artifact cards hand-rolled. `agent` variant is reserved for
// AI-surface pills (mention chips, model selector); `type-<kind>` maps
// to spectrum types so XRD / XPS / Raman / IR badges all render with the
// same shape but differ only in hue.

import type { HTMLAttributes, ReactNode } from 'react'

export type BadgeVariant =
  | 'neutral'
  | 'agent'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'type-xrd'
  | 'type-xps'
  | 'type-raman'
  | 'type-ir'

export type BadgeSize = 'sm' | 'md'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  /** Optional leading icon (chevrons, status dots, lucide icons). */
  leading?: ReactNode
}

export default function Badge({
  variant = 'neutral',
  size = 'sm',
  leading,
  className,
  children,
  ...rest
}: Props) {
  const classes = [
    'ui-badge',
    `ui-badge--${variant}`,
    size === 'md' ? 'ui-badge--md' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} {...rest}>
      {leading}
      {children}
    </span>
  )
}
