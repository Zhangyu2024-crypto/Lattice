// Inline rename input used by the Save structure CTA — extracted from
// ComputeCellView. Focused + selected on mount, Enter commits, Escape
// cancels. stopPropagation on the wrapper keeps clicks from stealing
// focus from the cell.

import { useEffect, useRef } from 'react'
import { Atom } from 'lucide-react'

export function RenameSaveInput({
  value,
  onChange,
  onCommit,
  onCancel,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <div className="compute-nb-save-rename" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        className="compute-nb-save-rename-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder="Structure name"
        disabled={disabled}
      />
      <button
        type="button"
        className="compute-nb-run-btn is-small"
        onClick={onCommit}
        disabled={disabled}
        title="Save (Enter)"
      >
        <Atom size={11} aria-hidden /> Save
      </button>
      <button
        type="button"
        className="compute-nb-ghost-btn"
        onClick={onCancel}
        disabled={disabled}
        title="Cancel (Esc)"
      >
        ✕
      </button>
    </div>
  )
}
