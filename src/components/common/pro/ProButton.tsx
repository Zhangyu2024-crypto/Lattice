import type { CSSProperties, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { TYPO } from '../../../lib/typography-inline'

type Variant = 'primary' | 'ghost' | 'danger'

interface Props {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  title?: string
  fullWidth?: boolean
  compact?: boolean
  style?: CSSProperties
}

export default function ProButton({
  children,
  onClick,
  variant = 'ghost',
  disabled = false,
  loading = false,
  type = 'button',
  title,
  fullWidth = false,
  compact = false,
  style,
}: Props) {
  const base: CSSProperties = {
    ...BASE_STYLE,
    ...VARIANTS[variant],
    ...(compact ? COMPACT : {}),
    ...(fullWidth ? { width: '100%' } : {}),
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : loading ? 0.85 : 1,
    ...style,
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      style={base}
    >
      {loading && <Loader2 size={12} className="spin" />}
      {children}
    </button>
  )
}

const BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: TYPO.xs,
  fontWeight: 600,
  fontFamily: 'inherit',
  borderRadius: 4,
  border: '1px solid',
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
}

const COMPACT: CSSProperties = {
  padding: '3px 8px',
  fontSize: TYPO.xxs,
}

const VARIANTS: Record<Variant, CSSProperties> = {
  primary: {
    background: 'var(--color-accent)',
    borderColor: 'var(--color-accent)',
    color: '#FFFFFF',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-secondary)',
  },
  danger: {
    background: 'transparent',
    borderColor: 'color-mix(in srgb, var(--color-red) 45%, transparent)',
    color: 'var(--color-red)',
  },
}
