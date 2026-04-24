export default function DaraStatusBanner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        padding: '0 2px 6px',
        fontSize: 'var(--text-xxs)',
        color: 'var(--color-text-muted)',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '1px 6px',
          border: '1px solid var(--color-border)',
          borderRadius: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 'var(--text-2xs)',
          color: 'var(--color-text-primary)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        bgmn built-in
      </span>
      <span>
        Full Rietveld refinement via the bundled BGMN engine (dara-xrd).
        No external Docker service required.
      </span>
    </div>
  )
}
