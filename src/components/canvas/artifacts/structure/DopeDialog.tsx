import { useState } from 'react'
import { Atom, X } from 'lucide-react'
import { useEscapeKey } from '../../../../hooks/useEscapeKey'
import { TYPO } from '../../../../lib/typography-inline'

export interface DopeDialogOpts {
  targetElement: string
  dopant: string
  fraction: number
}

interface Props {
  /** Elements present in the current structure, for the target dropdown. */
  availableElements: string[]
  onApply: (opts: DopeDialogOpts) => void
  onClose: () => void
}

/**
 * Parameter dialog for element substitution (doping). Lets the user pick
 * a target element from the current structure, type a dopant element
 * symbol, and set the substitution fraction (0-1). Follows the same
 * layout pattern as SurfaceDialog.
 */
export default function DopeDialog({ availableElements, onApply, onClose }: Props) {
  useEscapeKey(onClose)
  const [targetElement, setTargetElement] = useState(availableElements[0] ?? '')
  const [dopant, setDopant] = useState('')
  const [fraction, setFraction] = useState(0.05)
  const [error, setError] = useState<string | null>(null)

  const handleApply = () => {
    const trimTarget = targetElement.trim()
    const trimDopant = dopant.trim()
    if (!trimTarget) {
      setError('Select a target element')
      return
    }
    if (!trimDopant) {
      setError('Enter a dopant element symbol')
      return
    }
    if (trimTarget === trimDopant) {
      setError('Target and dopant must be different elements')
      return
    }
    if (fraction <= 0 || fraction > 1) {
      setError('Fraction must be in (0, 1]')
      return
    }
    setError(null)
    onApply({ targetElement: trimTarget, dopant: trimDopant, fraction })
  }

  return (
    <div onClick={onClose} style={S.backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={S.panel}>
        <div style={S.header}>
          <Atom size={14} className="surface-dialog-accent-icon" />
          <strong style={S.title}>Dope Element</strong>
          <span className="surface-dialog-spacer" />
          <button onClick={onClose} style={S.iconBtn} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div style={S.body}>
          <p style={S.blurb}>
            Randomly substitute a fraction of <strong>target</strong> atoms
            with the <strong>dopant</strong> element.
          </p>

          <label style={S.field}>
            <span style={S.fieldLabel}>Target element</span>
            <select
              value={targetElement}
              onChange={(e) => setTargetElement(e.target.value)}
              style={S.select}
            >
              {availableElements.map((el) => (
                <option key={el} value={el}>{el}</option>
              ))}
            </select>
          </label>

          <label style={S.field}>
            <span style={S.fieldLabel}>Dopant element</span>
            <input
              type="text"
              value={dopant}
              onChange={(e) => setDopant(e.target.value)}
              placeholder="e.g. Fe"
              maxLength={3}
              style={S.input}
            />
          </label>

          <label style={S.field}>
            <span style={S.fieldLabel}>Fraction</span>
            <input
              type="number"
              value={fraction}
              min={0.001}
              max={1}
              step={0.01}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setFraction(n)
              }}
              style={S.input}
            />
            <span style={S.hint}>
              {(fraction * 100).toFixed(1)}% of {targetElement || '?'} sites
            </span>
          </label>

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
    width: 380,
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
  select: {
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
