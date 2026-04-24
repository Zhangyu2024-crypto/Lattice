import { type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'

// Centered command-palette-style overlay for the focus variant's AI panel.
// The body (LatexAgentChat + its props) is passed in as children so the
// palette shell doesn't need to re-declare every chat prop type.
export function AiPalette({
  onClose,
  children,
}: {
  onClose: () => void
  children: ReactNode
}) {
  return (
    <>
      <div
        className="latex-focus-palette-scrim"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="latex-focus-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Creator AI"
      >
        <div className="latex-focus-palette-head">
          <span className="latex-focus-palette-title">
            <Sparkles size={13} aria-hidden />
            Creator AI
          </span>
          <span className="latex-focus-palette-hint">
            Esc to close · ⌘K to toggle
          </span>
          <button
            type="button"
            className="latex-focus-palette-close"
            onClick={onClose}
            aria-label="Close AI palette (Esc)"
            title="Close (Esc)"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        <div className="latex-focus-palette-body">{children}</div>
      </div>
    </>
  )
}
