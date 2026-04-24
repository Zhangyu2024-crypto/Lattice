import type { CSSProperties } from 'react'

// Inline style map for the pseudo-Voigt profile fit modal. Kept as
// CSSProperties (rather than Tailwind / CSS modules) to match the rest
// of the canvas artifact modals — they need to layer above arbitrary
// backdrops and we want zero risk of class-name collisions.

export const S: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    zIndex: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    width: 'min(560px, 90vw)',
    background: 'var(--color-bg-base)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--color-border)',
    paddingBottom: 6,
  },
  title: {
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-sans)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 2,
  },
  chartWrap: {
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    background: 'var(--color-bg-active)',
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  sliderRow: {
    display: 'grid',
    gridTemplateColumns: '44px 1fr 70px 70px',
    alignItems: 'center',
    gap: 8,
    fontSize: 'var(--text-xxs)',
    color: 'var(--color-text-muted)',
  },
  sliderLabel: {
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  slider: {
    accentColor: 'var(--color-accent)',
    width: '100%',
  },
  sliderValue: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-secondary)',
    textAlign: 'right',
  },
  sliderUnit: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-2xs)',
  },
  resultRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    padding: '4px 0',
    borderTop: '1px solid var(--color-border)',
    borderBottom: '1px solid var(--color-border)',
  },
  resultChip: {
    fontSize: 'var(--text-xxs)',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-sans)',
  },
  resultValue: {
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-mono)',
    marginLeft: 4,
  },
  actions: {
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
  },
  fitBtn: {
    background: 'var(--color-bg-active)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    padding: '4px 10px',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-xxs)',
    cursor: 'pointer',
  },
  applyBtn: {
    background: 'var(--color-text-primary)',
    border: '1px solid var(--color-text-primary)',
    borderRadius: 3,
    padding: '4px 10px',
    color: 'var(--color-bg-base)',
    fontSize: 'var(--text-xxs)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    padding: '4px 10px',
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xxs)',
    cursor: 'pointer',
  },
}
