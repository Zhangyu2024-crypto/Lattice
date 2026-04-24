import { useEffect, useRef, type CSSProperties } from 'react'
import type { ProWorkbenchKind } from '../../lib/pro-workbench'
import type { SpectrumTechnique } from '../../types/artifact'
import { useStableCallback } from '../../hooks/useStableCallback'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (kind: ProWorkbenchKind, technique?: SpectrumTechnique) => void
  anchor?: { top: number; left: number }
}

interface Option {
  kind: ProWorkbenchKind
  technique?: SpectrumTechnique
  label: string
  hint: string
  abbr: string
}

// All spectrum-shaped techniques funnel through the unified `spectrum-pro`
// artifact; the technique hint picks the sub-state that the shell promotes
// to the legacy workbench on mount.
const OPTIONS: Option[] = [
  {
    kind: 'spectrum-pro',
    label: 'Spectrum Lab',
    hint: 'XRD · XPS',
    abbr: 'Sp',
  },
]

export default function ProLauncherMenu({
  open,
  onClose,
  onSelect,
  anchor,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Route document listeners through a stable callback so the effect below
  // can bind once per `open` transition. Without this, every parent render
  // that produced a new `onClose` identity would tear down & re-attach the
  // listeners, racing with in-flight click events (observed when the launcher
  // opened from a menu that itself re-rendered on the mousedown).
  const handleClose = useStableCallback(onClose)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) handleClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
    // handleClose is referentially stable across renders; deps intentionally
    // reduce to [open] so listeners mount/unmount exactly with visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="pro-launcher-backdrop">
      <div
        ref={ref}
        className={
          'pro-launcher-menu ' +
          (anchor ? 'is-anchored' : 'is-centered')
        }
        style={
          anchor
            ? ({
                '--pop-top': `${anchor.top}px`,
                '--pop-left': `${anchor.left}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <div className="pro-launcher-header">Open Lab</div>
        {OPTIONS.map((o) => (
          <button
            key={`${o.kind}:${o.technique ?? ''}`}
            type="button"
            className="pro-launcher-row"
            onClick={() => {
              onSelect(o.kind, o.technique)
              onClose()
            }}
          >
            <span className="pro-launcher-row-abbr">{o.abbr}</span>
            <span className="pro-launcher-row-label">{o.label}</span>
            <span className="pro-launcher-row-hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
