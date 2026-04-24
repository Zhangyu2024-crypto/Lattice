// EmptyState — replaces the three pre-existing spellings that were
// scattered across the app:
//   - `<div className="artifact-empty">` (SpectrumArtifactCard)
//   - `<EmptyLine>` (SessionView)
//   - `<ProEmpty>` (Pro Workbenches)

import type { HTMLAttributes, ReactNode } from 'react'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export default function EmptyState({
  icon,
  title,
  hint,
  action,
  compact = false,
  className,
  children,
  ...rest
}: Props) {
  const classes = [
    'ui-empty',
    compact ? 'ui-empty--compact' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {icon && <span className="ui-empty__icon">{icon}</span>}
      {title && <div className="ui-empty__title">{title}</div>}
      {hint && <div className="ui-empty__hint">{hint}</div>}
      {children}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  )
}
