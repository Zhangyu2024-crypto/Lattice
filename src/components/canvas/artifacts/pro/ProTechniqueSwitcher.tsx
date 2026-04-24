// Technique switcher — segmented control slotted into the Pro ribbon's
// left edge. Renders a fixed-order row (XRD / XPS / Curve) so the UI
// stays stable regardless of which artifact kind is driving the unified
// workbench. Raman / FTIR intentionally absent: the backend only has
// real processing for XRD and XPS. Legacy artifacts that still carry
// 'raman' / 'ftir' technique cursors render via the module registry
// (see registry.ts) but can't be selected from here.
//
// Legacy kinds pass a single-entry `available` list to freeze the
// control: non-matching segments render disabled with a tooltip, and the
// active segment is visually locked (the unified workbench also blocks
// onChange via `disabled`).
//
// Phase 4 wires the `hints` map so segments with existing work on the
// other-technique sub-states show a tiny indicator dot; until then the
// unified workbench passes `undefined` and the dot never renders.

import type { CSSProperties } from 'react'
import type { SpectrumTechnique } from '@/types/artifact'
import { TYPO } from '@/lib/typography-inline'

interface Props {
  active: SpectrumTechnique
  available: SpectrumTechnique[]
  onChange: (t: SpectrumTechnique) => void
  /** Optional per-technique indicator — truthy entries render a small dot
   *  on the segment. Used by Phase 4 to mark techniques with work. */
  hints?: Partial<Record<SpectrumTechnique, boolean>>
  /** When true, the entire switcher is non-interactive (legacy kinds). */
  disabled?: boolean
}

const ORDER: ReadonlyArray<{ technique: SpectrumTechnique; label: string }> = [
  { technique: 'xrd', label: 'XRD' },
  { technique: 'xps', label: 'XPS' },
]

export default function ProTechniqueSwitcher({
  active,
  available,
  onChange,
  hints,
  disabled,
}: Props) {
  const availableSet = new Set(available)
  return (
    <div role="tablist" style={S.root}>
      {ORDER.map(({ technique, label }) => {
        const isActive = technique === active
        const isAvailable = availableSet.has(technique)
        const segDisabled = disabled || !isAvailable
        const title = !isAvailable
          ? 'Not available for this artifact'
          : disabled
            ? 'Technique locked for legacy artifacts'
            : `Switch to ${label}`
        const style: CSSProperties = {
          ...S.seg,
          ...(isActive ? S.segActive : {}),
          ...(segDisabled ? S.segDisabled : {}),
        }
        return (
          <button
            key={technique}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={segDisabled}
            title={title}
            onClick={() => {
              if (!segDisabled && !isActive) onChange(technique)
            }}
            style={style}
          >
            <span>{label}</span>
            {hints?.[technique] && !isActive ? <span style={S.dot} /> : null}
          </button>
        )
      })}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: 2,
    padding: 2,
    borderRadius: 4,
    background: 'var(--color-bg-active)',
    flexShrink: 0,
  },
  seg: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: TYPO.xxs,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontFamily: 'inherit',
    color: 'var(--color-text-secondary)',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 3,
    cursor: 'pointer',
  },
  segActive: {
    background: 'var(--color-bg-base)',
    color: 'var(--color-accent-text, var(--color-accent))',
    borderColor: 'var(--color-border)',
    cursor: 'default',
  },
  segDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--color-accent)',
    flexShrink: 0,
  },
}
