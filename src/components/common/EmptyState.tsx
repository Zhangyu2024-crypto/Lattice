// EmptyState — module-facing empty/loading/error surface.
//
// This complements the smaller `ui/EmptyState` primitive (which is a
// generic slot-based card). This one is variant-driven: callers pick a
// semantic variant and we supply the icon + a11y role + default tone.
// Used by LibraryModal / KnowledgeBrowserModal (Sprint 2 §2.1) to stop
// the four different "no results / offline / error" spellings that were
// drifting across modules.

import type { ReactNode } from 'react'
import {
  AlertCircle,
  CloudOff,
  Inbox,
  Loader2,
  Search,
  WifiOff,
} from 'lucide-react'

export type EmptyStateVariant =
  | 'no-data'
  | 'no-results'
  | 'disconnected'
  | 'error'
  | 'offline'
  | 'loading'

export type EmptyStateSize = 'sm' | 'md' | 'lg'

interface Props {
  variant: EmptyStateVariant
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: { label: string; onClick: () => void; disabled?: boolean }
  size?: EmptyStateSize
}

const DEFAULT_ICON_SIZE: Record<EmptyStateSize, number> = {
  sm: 16,
  md: 22,
  lg: 28,
}

function defaultIcon(variant: EmptyStateVariant, size: number): ReactNode {
  switch (variant) {
    case 'no-data':
      return <Inbox size={size} aria-hidden />
    case 'no-results':
      return <Search size={size} aria-hidden />
    case 'disconnected':
      return <WifiOff size={size} aria-hidden />
    case 'error':
      return <AlertCircle size={size} aria-hidden />
    case 'offline':
      return <CloudOff size={size} aria-hidden />
    case 'loading':
      return <Loader2 size={size} className="spin" aria-hidden />
  }
}

export default function EmptyState({
  variant,
  title,
  description,
  icon,
  action,
  size = 'md',
}: Props) {
  const role =
    variant === 'loading'
      ? 'status'
      : variant === 'error'
        ? 'alert'
        : undefined
  const iconNode = icon ?? defaultIcon(variant, DEFAULT_ICON_SIZE[size])
  const className = [
    'module-empty',
    `module-empty--${size}`,
    `module-empty--${variant}`,
  ].join(' ')
  return (
    <div className={className} role={role} aria-live={role === 'status' ? 'polite' : undefined}>
      <span className="module-empty__icon">{iconNode}</span>
      <div className="module-empty__title">{title}</div>
      {description && (
        <div className="module-empty__desc">{description}</div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="module-empty__action"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
