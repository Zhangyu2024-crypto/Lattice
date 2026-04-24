import { useState } from 'react'
import { Grid3x3, X } from 'lucide-react'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { TYPO } from '../../../lib/typography-inline'

export interface SurfaceDialogOpts {
  h: number
  k: number
  l: number
  slabLayers: number
  vacuumAngstrom: number
}

interface Props {
  onApply: (opts: SurfaceDialogOpts) => void
  onClose: () => void
}

/**
 * Small modal for configuring a Miller-indexed slab cut. Keeps state
 * local — applies in one shot to the parent's `applyTransform`.
 */
export default function SurfaceDialog({ onApply, onClose }: Props) {
  useEscapeKey(onClose)
  const [h, setH] = useState(0)
  const [k, setK] = useState(0)
  const [l, setL] = useState(1)
  const [slabLayers, setSlabLayers] = useState(2)
  const [vacuumAngstrom, setVacuumAngstrom] = useState(10)
  const [error, setError] = useState<string | null>(null)

  const handleApply = () => {
    if (h === 0 && k === 0 && l === 0) {
      setError('(h,k,l) cannot all be zero')
      return
    }
    if (slabLayers < 1) {
      setError('Slab layers must be ≥ 1')
      return
    }
    if (vacuumAngstrom < 0) {
      setError('Vacuum must be ≥ 0')
      return
    }
    setError(null)
    onApply({ h, k, l, slabLayers, vacuumAngstrom })
  }

  return (
    <div onClick={onClose} style={S.backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={S.panel}>
        <div style={S.header}>
          <Grid3x3 size={14} className="surface-dialog-accent-icon" />
          <strong style={S.title}>Generate Surface Slab</strong>
          <span className="surface-dialog-spacer" />
          <button onClick={onClose} style={S.iconBtn} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div style={S.body}>
          <p style={S.blurb}>
            Cuts a slab perpendicular to the <strong>(h k l)</strong> plane
            and adds vacuum along the new z axis.
          </p>

          <div style={S.hklRow}>
            <NumberField label="h" value={h} onChange={setH} step={1} />
            <NumberField label="k" value={k} onChange={setK} step={1} />
            <NumberField label="l" value={l} onChange={setL} step={1} />
          </div>

          <NumberField
            label="Slab layers"
            value={slabLayers}
            onChange={setSlabLayers}
            step={1}
            min={1}
            hint="How thick along the new z axis"
          />
          <NumberField
            label="Vacuum (Å)"
            value={vacuumAngstrom}
            onChange={setVacuumAngstrom}
            step={1}
            min={0}
            hint="Vacuum layer above the slab"
          />

          {error && <div style={S.error}>{error}</div>}

          <p style={S.caveat}>
            Geometric MVP: Wyckoff-aware slab termination is not handled.
            Users with polar surfaces should verify the slab visually.
          </p>
        </div>

        <div style={S.footer}>
          <button onClick={onClose} style={S.ghostBtn}>Cancel</button>
          <button onClick={handleApply} style={S.primaryBtn}>Apply</button>
        </div>
      </div>
    </div>
  )
}

function NumberField({
  label, value, onChange, step, min, hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  hint?: string
}) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        style={S.input}
      />
      {hint && <span style={S.hint}>{hint}</span>}
    </label>
  )
}

const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1150,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  panel: {
    width: 420,
    maxWidth: '100%',
    background: 'var(--color-bg-sidebar)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 14px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  title: { fontSize: TYPO.base, color: 'var(--color-text-primary)' },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    display: 'flex',
    padding: 2,
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  blurb: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-secondary)',
    margin: 0,
    lineHeight: 1.5,
  },
  hklRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fieldLabel: {
    fontSize: TYPO.xs,
    color: 'var(--color-text-secondary)',
  },
  input: {
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: 3,
    padding: '5px 8px',
    color: 'var(--color-text-primary)',
    fontSize: TYPO.sm,
    outline: 'none',
    fontFamily: 'var(--font-mono)',
  },
  hint: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
  },
  error: {
    fontSize: TYPO.xs,
    color: 'var(--color-red)',
    padding: '6px 8px',
    border: '1px solid var(--color-red)',
    borderRadius: 3,
    background: 'rgba(240, 240, 240, 0.06)',
  },
  caveat: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
    margin: 0,
    lineHeight: 1.5,
  },
  footer: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    padding: '10px 14px',
    borderTop: '1px solid var(--color-border)',
  },
  primaryBtn: {
    background: 'var(--color-accent)',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    padding: '6px 14px',
    fontSize: TYPO.sm,
    cursor: 'pointer',
  },
  ghostBtn: {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    padding: '6px 14px',
    fontSize: TYPO.sm,
    cursor: 'pointer',
  },
}
