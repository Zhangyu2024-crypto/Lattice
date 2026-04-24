import { useState } from 'react'
import { Box, X } from 'lucide-react'
import { useEscapeKey } from '../../../../hooks/useEscapeKey'
import { TYPO } from '../../../../lib/typography-inline'

export interface SupercellDialogOpts {
  nx: number
  ny: number
  nz: number
}

interface Props {
  onApply: (opts: SupercellDialogOpts) => void
  onClose: () => void
}

/**
 * Parameter dialog for supercell expansion. Accepts nx / ny / nz
 * replication counts (1-10 each). Follows the same layout and styling
 * conventions as SurfaceDialog.
 */
export default function SupercellDialog({ onApply, onClose }: Props) {
  useEscapeKey(onClose)
  const [nx, setNx] = useState(2)
  const [ny, setNy] = useState(2)
  const [nz, setNz] = useState(2)
  const [error, setError] = useState<string | null>(null)

  const handleApply = () => {
    if (nx < 1 || ny < 1 || nz < 1) {
      setError('All dimensions must be >= 1')
      return
    }
    if (nx > 10 || ny > 10 || nz > 10) {
      setError('Dimensions capped at 10 to avoid memory issues')
      return
    }
    setError(null)
    onApply({ nx, ny, nz })
  }

  return (
    <div onClick={onClose} style={S.backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={S.panel}>
        <div style={S.header}>
          <Box size={14} className="surface-dialog-accent-icon" />
          <strong style={S.title}>Build Supercell</strong>
          <span className="surface-dialog-spacer" />
          <button onClick={onClose} style={S.iconBtn} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div style={S.body}>
          <p style={S.blurb}>
            Replicate the unit cell along each crystallographic axis.
          </p>

          <div style={S.dimRow}>
            <NumberField label="nx" value={nx} onChange={setNx} min={1} max={10} />
            <NumberField label="ny" value={ny} onChange={setNy} min={1} max={10} />
            <NumberField label="nz" value={nz} onChange={setNz} min={1} max={10} />
          </div>

          <p style={S.hint}>
            Total cells: {nx * ny * nz}
          </p>

          {error && <div style={S.error}>{error}</div>}
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
  label, value, onChange, min, max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.round(n))
        }}
        style={S.input}
      />
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
    width: 360,
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
  dimRow: {
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
    margin: 0,
  },
  error: {
    fontSize: TYPO.xs,
    color: 'var(--color-red)',
    padding: '6px 8px',
    border: '1px solid var(--color-red)',
    borderRadius: 3,
    background: 'rgba(240, 240, 240, 0.06)',
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
