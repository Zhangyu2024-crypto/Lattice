/**
 * Small segmented-control button used by the spectral-data toolbar to flip
 * between chart / split / source views. Presentational only.
 */
export function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 3,
        background: active ? 'var(--accent, #0e7490)' : 'transparent',
        color: active ? '#fff' : 'var(--color-text-muted)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
