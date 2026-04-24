export type HealthLevel = 'ok' | 'warn' | 'err' | 'idle'

interface Props {
  level: HealthLevel
  label: string
  title?: string
  onClick?: () => void
}

export default function ProHealthBadge({ level, label, title, onClick }: Props) {
  const color = COLORS[level]
  return (
    <span
      className={
        'pro-health-badge' + (onClick ? ' is-interactive' : '')
      }
      style={{ '--pro-health-color': color } as React.CSSProperties}
      title={title}
      onClick={onClick}
    >
      <span className="pro-health-badge-dot" />
      {label}
    </span>
  )
}

const COLORS: Record<HealthLevel, string> = {
  ok: 'var(--color-green)',
  warn: 'var(--color-yellow)',
  err: 'var(--color-red)',
  idle: 'var(--color-text-muted)',
}
