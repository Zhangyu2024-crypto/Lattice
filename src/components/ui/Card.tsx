// Card + CardHeader + CardBody — the missing piece. Every artifact
// card in `canvas/artifacts/*` was hand-drawing its own header div
// with ad-hoc padding (ranging 2-10px) and inline styled title rows.
// This standardizes:
//   - Header is 40px tall (aligned across every card)
//   - Title / subtitle column takes remaining width
//   - Actions (icon buttons, menus) dock to the right
//   - Body stretches and inherits min-height:0 so charts / tables
//     inside it can size themselves correctly

import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Skip border + radius when Card sits inside another shell. */
  borderless?: boolean
  /** Transparent surface (e.g. inside an EmptyState container). */
  flat?: boolean
}

export function Card({
  borderless = false,
  flat = false,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = [
    'ui-card',
    borderless ? 'ui-card--borderless' : '',
    flat ? 'ui-card--flat' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}

interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional leading icon (Lucide). */
  icon?: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  /** Right-docked action area (IconButtons / menus). */
  actions?: ReactNode
}

export function CardHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
  children,
  ...rest
}: CardHeaderProps) {
  const classes = ['ui-card__header', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {icon && <span className="ui-card__header-icon">{icon}</span>}
      {(title || subtitle) && (
        <div className="ui-card__header-titles">
          {title && <div className="ui-card__header-title">{title}</div>}
          {subtitle && (
            <div className="ui-card__header-subtitle">{subtitle}</div>
          )}
        </div>
      )}
      {children}
      {actions && <div className="ui-card__header-actions">{actions}</div>}
    </div>
  )
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Apply the standard 12px padding. Charts + tables pass `false`
   *  because they own their own padding. */
  padded?: boolean
}

export function CardBody({
  padded = false,
  className,
  children,
  ...rest
}: CardBodyProps) {
  const classes = [
    'ui-card__body',
    padded ? 'ui-card__body--padded' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
