import { useState } from 'react'
import { Zap, X } from 'lucide-react'
import { useEscapeKey } from '../../../../hooks/useEscapeKey'
import { TYPO } from '../../../../lib/typography-inline'

export interface VacancyDialogOpts {
  element: string
  count: number
}

interface Props {
  /** Elements present in the current structure, for the dropdown. */
  availableElements: string[]
  onApply: (opts: VacancyDialogOpts) => void
  onClose: () => void
}

/**
 * Parameter dialog for vacancy creation. Lets the user pick which
 * element to remove and how many atoms to delete. Follows the same
 * layout pattern as SurfaceDialog.
 */
export default function VacancyDialog({ availableElements, onApply, onClose }: Props) {
  useEscapeKey(onClose)
  const [element, setElement] = useState(availableElements[0] ?? '')
  const [count, setCount] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const handleApply = () => {
    const trimEl = element.trim()
    if (!trimEl) {
      setError('Select an element to remove')
      return
    }
    if (count < 1) {
      setError('Count must be >= 1')
      return
    }
    setError(null)
    onApply({ element: trimEl, count })
  }

  return (
    <div onClick={onClose} style={S.backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={S.panel}>
        <div style={S.header}>
          <Zap size={14} className="surface-dialog-accent-icon" />
          <strong style={S.title}>Add Vacancy</strong>
          <span className="surface-dialog-spacer" />
          <button onClick={onClose} style={S.iconBtn} title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div style={S.body}>
          <p style={S.blurb}>
            Remove atoms of the selected element to create vacancies.
          </p>

          <label style={S.field}>
            <span style={S.fieldLabel}>Element to remove</span>
            <select
              value={element}
              onChange={(e) => setElement(e.target.value)}
              style={S.select}
            >
              {availableElements.map((el) => (
                <option key={el} value={el}>{el}</option>
              ))}
            </select>
          </label>

          <label style={S.field}>
            <span style={S.fieldLabel}>Count</span>
            <input
              type="number"
              value={count}
              min={1}
              step={1}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setCount(Math.max(1, Math.round(n)))
              }}
              style={S.input}
            />
            <span style={S.hint}>
              Number of {element || '?'} atoms to remove
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
