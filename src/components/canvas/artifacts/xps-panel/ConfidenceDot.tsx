// Colour-coded confidence indicator for lookup assignment rows.
//
// - green  `#8c9e8c`  — high confidence (≥ 0.8): close BE match + common state
// - amber  `#c4a86c`  — borderline (0.5–0.8): accept with a human check
// - red    `#9e8c8c`  — low (< 0.5): tolerance-edge or obscure state
//
// Missing confidence renders a neutral grey marker so older persisted
// artifacts (pre-Phase 14) still display without breaking the row layout.
// The dot title exposes the raw number for users who want the underlying
// value rather than the banded colour.

export default function ConfidenceDot({
  confidence,
}: {
  confidence?: number
}) {
  const hasValue = typeof confidence === 'number' && Number.isFinite(confidence)
  const c = hasValue ? (confidence as number) : null
  const color =
    c == null
      ? 'var(--color-border)'
      : c >= 0.8
        ? '#8c9e8c'
        : c >= 0.5
          ? '#c4a86c'
          : '#9e8c8c'
  const title = hasValue
    ? `confidence ${(c as number).toFixed(2)}`
    : 'confidence unavailable'
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        marginRight: 6,
        borderRadius: 2,
        background: color,
        flexShrink: 0,
      }}
    />
  )
}
