// Shared toolbar for the "copy / export this table" affordance.
//
// Two variants:
//   - `inline` (default): two icon buttons side-by-side — Copy TSV +
//     Download CSV. A third "Copy as Markdown" action lives under an
//     overflow popover so the common row stays compact.
//   - `compact`: a single `⋯` icon that opens a three-item menu.
//     Used where a row-level header is already busy (sidebar lists,
//     small card sections).
//
// All three actions route through `table-export.ts` so serialization is
// identical across the app. Empty tables render nothing — buttons on
// zero-row data are confusing and produce empty files.

import { useRef, useState } from 'react'
import { ClipboardCopy, FileDown, MoreHorizontal } from 'lucide-react'
import {
  copyTable,
  downloadCsv,
  type TableSpec,
} from '../../lib/table-export'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'

export interface TableActionsProps<T> {
  spec: TableSpec<T>
  /**
   * UI layout variant. `inline` renders two icon buttons + a small
   * overflow for "Copy as Markdown". `compact` collapses everything
   * into a single `⋯` menu.
   */
  variant?: 'inline' | 'compact'
  /** Extra className passed through to the root. */
  className?: string
}

/**
 * Renderless-ish toolbar — only concerned with firing the three export
 * actions. Callers control placement by wrapping this component
 * wherever they want the buttons (typically a card header right-slot).
 */
export function TableActions<T>({
  spec,
  variant = 'inline',
  className,
}: TableActionsProps<T>) {
  const hasRows = spec.rows.length > 0
  if (!hasRows) return null

  if (variant === 'compact') {
    return <CompactMenu spec={spec} className={className} />
  }
  return <InlineBar spec={spec} className={className} />
}

// ── Inline variant ────────────────────────────────────────────────

function InlineBar<T>({
  spec,
  className,
}: {
  spec: TableSpec<T>
  className?: string
}) {
  const [markdownOpen, setMarkdownOpen] = useState(false)
  const overflowWrapRef = useRef<HTMLDivElement | null>(null)

  useOutsideClickDismiss(overflowWrapRef, markdownOpen, () =>
    setMarkdownOpen(false),
  )

  return (
    <div className={`table-actions ${className ?? ''}`.trim()}>
      <button
        type="button"
        className="session-mini-btn"
        title="Copy table to clipboard (TSV — paste into Excel / Sheets)"
        aria-label="Copy table"
        onClick={() => void copyTable(spec, 'tsv')}
      >
        <ClipboardCopy size={12} aria-hidden />
      </button>
      <button
        type="button"
        className="session-mini-btn"
        title="Download table as CSV"
        aria-label="Download CSV"
        onClick={() => downloadCsv(spec)}
      >
        <FileDown size={12} aria-hidden />
      </button>
      <div className="table-actions-overflow-wrap" ref={overflowWrapRef}>
        <button
          type="button"
          className="session-mini-btn"
          title="More copy formats"
          aria-label="More copy formats"
          aria-haspopup="menu"
          aria-expanded={markdownOpen}
          onClick={() => setMarkdownOpen((v) => !v)}
        >
          <MoreHorizontal size={12} aria-hidden />
        </button>
        {markdownOpen && (
          <div
            className="table-actions-overflow-menu"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="table-actions-overflow-item"
              onClick={() => {
                setMarkdownOpen(false)
                void copyTable(spec, 'markdown')
              }}
            >
              Copy as Markdown
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Compact variant ──────────────────────────────────────────────

function CompactMenu<T>({
  spec,
  className,
}: {
  spec: TableSpec<T>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useOutsideClickDismiss(wrapRef, open, () => setOpen(false))

  const fire = (action: () => void | Promise<void>) => () => {
    setOpen(false)
    void action()
  }

  return (
    <div
      className={`table-actions is-compact ${className ?? ''}`.trim()}
      ref={wrapRef}
    >
      <button
        type="button"
        className="session-mini-btn"
        title="Table actions"
        aria-label="Table actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={12} aria-hidden />
      </button>
      {open && (
        <div
          className="table-actions-compact-menu"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="table-actions-overflow-item"
            onClick={fire(() => copyTable(spec, 'tsv'))}
          >
            <ClipboardCopy size={12} aria-hidden />
            Copy (TSV)
          </button>
          <button
            type="button"
            role="menuitem"
            className="table-actions-overflow-item"
            onClick={fire(() => copyTable(spec, 'markdown'))}
          >
            <ClipboardCopy size={12} aria-hidden />
            Copy as Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className="table-actions-overflow-item"
            onClick={fire(() => downloadCsv(spec))}
          >
            <FileDown size={12} aria-hidden />
            Download CSV
          </button>
        </div>
      )}
    </div>
  )
}
