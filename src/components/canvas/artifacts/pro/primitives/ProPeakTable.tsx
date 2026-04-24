// Shared editable peak table for Pro Workbench DataTabs.
//
// Every technique's peak list (XRD 2θ, XPS binding energy, Raman Raman-
// shift, Curve generic position) used to be a bespoke read-only table;
// Slice 2 of the UI-completeness sweep consolidates them so editing is
// consistent and the add/delete affordance is always visible. The primitive
// is deliberately generic over the row type — each module keeps its own
// `Peak` shape (XrdProPeak, XpsProPeakDetect, CurveFeature, …) and passes
// a `columns` schema describing which cells render and which are editable.
//
// The table is uncontrolled for inline edits — a cell becomes an
// `<input>` on click, commits to the parent on blur / Enter, reverts on
// Escape. Parent owns the array; all mutations funnel through the
// onEdit / onDelete / onAdd callbacks.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Plus, X } from 'lucide-react'
import { TYPO } from '@/lib/typography-inline'

export interface PeakColumnDef<P> {
  /** Key on the row object this column reads from. */
  key: keyof P & string
  /** Header cell label (title case per design system). */
  label: string
  /** Display unit appended to the header in muted text (e.g. "°", "eV"). */
  unit?: string
  /** `numeric` cells right-align + use tabular-nums; also affects edit parser. */
  numeric?: boolean
  /** Number of digits after the decimal point in read mode. Default 3 for
   *  numeric, ignored for strings. */
  precision?: number
  /** If true, click-to-edit is enabled for this column. Numeric columns edit
   *  as `<input type="number" step>`; non-numeric edit as text. */
  editable?: boolean
  /** Step size passed to numeric input. Default 0.01. */
  step?: number
  /** Override cell render when you need non-default formatting (e.g. an
   *  enum pill). Takes precedence over numeric / precision. */
  render?: (value: P[keyof P & string], row: P, idx: number) => React.ReactNode
}

export interface ProPeakTableProps<P> {
  peaks: P[]
  columns: ReadonlyArray<PeakColumnDef<P>>
  /** Emit a partial patch for the row at `idx` when the user commits an
   *  inline edit. Parent applies it to the sub-state. */
  onEdit?: (idx: number, patch: Partial<P>) => void
  /** Delete the row at `idx`. Omit to hide the trash button. */
  onDelete?: (idx: number) => void
  /** Hook for the "+" footer row. Omit to hide. */
  onAdd?: () => void
  /** Fires on row hover / focus to drive the chart's focus marker. The
   *  parent module typically threads this through `useFocusedPeak`. Omit
   *  if the module has no chart marker to highlight. */
  onFocus?: (idx: number | null) => void
  /** Text shown when `peaks` is empty. */
  emptyMessage?: string
  /** Cap rows before showing a "+ N more…" footer. Default 200. */
  maxRows?: number
}

const DEFAULT_MAX_ROWS = 200

export default function ProPeakTable<P extends object>({
  peaks,
  columns,
  onEdit,
  onDelete,
  onAdd,
  onFocus,
  emptyMessage = 'No rows.',
  maxRows = DEFAULT_MAX_ROWS,
}: ProPeakTableProps<P>) {
  const [editing, setEditing] = useState<{ idx: number; key: string } | null>(
    null,
  )
  const [draft, setDraft] = useState<string>('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commitEdit = useCallback(() => {
    if (!editing || !onEdit) return setEditing(null)
    const col = columns.find((c) => c.key === editing.key)
    if (!col) return setEditing(null)
    const raw = draft.trim()
    let next: unknown
    if (col.numeric) {
      if (raw === '') {
        next = undefined
      } else {
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return setEditing(null)
        next = parsed
      }
    } else {
      next = raw === '' ? undefined : raw
    }
    const row = peaks[editing.idx]
    if (row != null && row[col.key as keyof P] !== next) {
      onEdit(editing.idx, { [col.key]: next } as Partial<P>)
    }
    setEditing(null)
  }, [editing, draft, columns, onEdit, peaks])

  const cancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  const startEdit = (idx: number, col: PeakColumnDef<P>) => {
    if (!col.editable || !onEdit) return
    const row = peaks[idx]
    const raw = row?.[col.key as keyof P]
    setDraft(raw == null ? '' : String(raw))
    setEditing({ idx, key: col.key })
  }

  // ─── Render ──────────────────────────────────────────────────────

  if (peaks.length === 0 && !onAdd) {
    return <div style={styles.empty}>{emptyMessage}</div>
  }

  const visibleRows = peaks.slice(0, maxRows)
  const overflow = peaks.length - visibleRows.length

  // Grid template: index + all columns + (delete if enabled)
  const gridCols = [
    '32px',
    ...columns.map((c) => (c.numeric ? 'minmax(60px, 1fr)' : 'minmax(80px, 1.2fr)')),
    onDelete ? '24px' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div style={styles.wrap}>
      <div
        role="row"
        style={{ ...styles.head, gridTemplateColumns: gridCols }}
      >
        <span>#</span>
        {columns.map((c) => (
          <span key={c.key} style={styles.headCell}>
            {c.label}
            {c.unit ? (
              <span style={styles.unit}> {c.unit}</span>
            ) : null}
          </span>
        ))}
        {onDelete ? <span /> : null}
      </div>
      <div style={styles.body}>
        {visibleRows.map((row, i) => (
          <div
            key={`row-${i}`}
            role="row"
            onMouseEnter={onFocus ? () => onFocus(i) : undefined}
            onMouseLeave={onFocus ? () => onFocus(null) : undefined}
            onFocus={onFocus ? () => onFocus(i) : undefined}
            onBlur={onFocus ? () => onFocus(null) : undefined}
            style={{ ...styles.row, gridTemplateColumns: gridCols }}
          >
            <span style={styles.idx}>{i + 1}</span>
            {columns.map((col) => {
              const active =
                editing && editing.idx === i && editing.key === col.key
              if (active) {
                return (
                  <input
                    key={col.key}
                    ref={inputRef}
                    type={col.numeric ? 'number' : 'text'}
                    step={col.numeric ? col.step ?? 0.01 : undefined}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    onBlur={commitEdit}
                    style={styles.input}
                  />
                )
              }
              const value = (row as Record<string, unknown>)[col.key] as
                P[keyof P & string]
              const node = col.render
                ? col.render(value, row, i)
                : formatCell(value, col)
              return (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => startEdit(i, col)}
                  disabled={!col.editable || !onEdit}
                  style={{
                    ...styles.cellBtn,
                    ...(col.numeric ? styles.cellNumeric : null),
                    ...(col.editable && onEdit ? null : styles.cellReadonly),
                  }}
                  title={col.editable && onEdit ? 'Click to edit' : undefined}
                >
                  {node}
                </button>
              )
            })}
            {onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(i)}
                style={styles.delBtn}
                title="Remove row"
                aria-label="Remove row"
              >
                <X size={10} aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
        {overflow > 0 ? (
          <div style={styles.overflow}>+{overflow} more…</div>
        ) : null}
        {peaks.length === 0 && onAdd ? (
          <div style={styles.emptyInline}>{emptyMessage}</div>
        ) : null}
      </div>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          style={styles.addBtn}
          title="Add a blank row"
        >
          <Plus size={11} aria-hidden /> Add row
        </button>
      ) : null}
    </div>
  )
}

function formatCell<P>(
  value: P[keyof P & string] | undefined,
  col: PeakColumnDef<P>,
): React.ReactNode {
  if (value == null || value === '') return <span style={{ opacity: 0.4 }}>—</span>
  if (col.numeric && typeof value === 'number') {
    const prec = col.precision ?? 3
    return value.toFixed(prec)
  }
  return String(value)
}

// ─── Inline styles (token-driven, keep chrome grayscale per design) ──

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
  },
  head: {
    display: 'grid',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: 'var(--color-bg-sidebar)',
    borderBottom: '1px solid var(--color-border)',
    fontSize: TYPO.xxs,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
  },
  headCell: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unit: {
    fontWeight: 400,
    color: 'var(--color-text-muted)',
    opacity: 0.75,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  row: {
    display: 'grid',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: TYPO.xs,
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-primary)',
    borderBottom: '1px solid color-mix(in srgb, var(--color-border) 45%, transparent)',
  },
  idx: {
    color: 'var(--color-text-muted)',
    fontSize: TYPO['2xs'],
  },
  cellBtn: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 3,
    color: 'inherit',
    font: 'inherit',
    padding: '2px 4px',
    textAlign: 'left',
    cursor: 'pointer',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cellNumeric: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums slashed-zero',
  },
  cellReadonly: {
    cursor: 'default',
  },
  input: {
    minWidth: 0,
    width: '100%',
    padding: '1px 4px',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border-focus)',
    borderRadius: 3,
    color: 'var(--color-text-primary)',
    font: 'inherit',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  },
  delBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: 3,
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 0,
    height: 18,
    width: 18,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflow: {
    padding: '6px 10px',
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
  empty: {
    padding: '16px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
  emptyInline: {
    padding: '12px 8px',
    fontSize: TYPO.xs,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
  addBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    margin: '4px 8px',
    background: 'transparent',
    border: '1px dashed var(--color-border)',
    borderRadius: 4,
    color: 'var(--color-text-muted)',
    fontSize: TYPO.xxs,
    cursor: 'pointer',
    alignSelf: 'flex-start',
    fontFamily: 'inherit',
  },
}
