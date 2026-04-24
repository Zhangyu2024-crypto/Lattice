import { useCallback, useEffect, useRef, useState } from 'react'
import { TableActions } from '../../common/TableActions'
import { specFromTableElement } from '../../../lib/table-export-dom'
import type { TableSpec } from '../../../lib/table-export'

/**
 * Wrap react-markdown's `<table>` so every rendered chat table carries
 * a TableActions toolbar in its top-right corner. Spec is derived from
 * the rendered DOM at click-time — we don't pre-parse because the
 * markdown body may still be streaming and reconciling, and reading the
 * live DOM is the simplest source of truth.
 */
export default function ChatMarkdownTable({
  children,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>) {
  const tableRef = useRef<HTMLTableElement | null>(null)
  const [spec, setSpec] = useState<TableSpec<Record<string, string>> | null>(null)
  // Derive the spec lazily on hover — avoids paying the DOM walk for
  // every table on every render tick during streaming.
  const ensureSpec = useCallback(() => {
    const el = tableRef.current
    if (!el) return
    const next = specFromTableElement(el, { filename: 'chat-table' })
    setSpec(next)
  }, [])
  // Kick the DOM walk once on mount so the button is available
  // immediately — we pay the ≤50-cell parse on paint, not on first
  // hover. Subsequent invocations (if the table streams in more rows)
  // are covered by the onMouseEnter re-walk below.
  useEffect(() => {
    ensureSpec()
  }, [ensureSpec])
  return (
    <div
      className="chat-bubble-table-wrap"
      onMouseEnter={ensureSpec}
      onFocus={ensureSpec}
    >
      {spec && (
        <div className="chat-bubble-table-actions" aria-label="Table actions">
          <TableActions spec={spec} />
        </div>
      )}
      <table ref={tableRef} {...rest}>
        {children}
      </table>
    </div>
  )
}
