// PdfSelectionToolbar — floating toolbar anchored to a PDF selection rect.
// Replaces the old PdfSelectionMenu and widens the action set per the
// "PDF note-taking / selection-tool overhaul" plan:
//
//   Highlight + 4 semantic swatches / Note / Underline / Strike / Todo
//   / Ask AI (goes to the global Agent Composer via composer-bus) / Copy
//   / Define (inline definition card).
//
// Portal-rendered so the toolbar escapes PdfContinuousViewer's overflow
// clip. Anchored to `anchorRect` (first selection rect) top-center by
// default, flipped below when the rect is near the viewport top.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import {
  BookMarked,
  Clipboard,
  Highlighter,
  ListChecks,
  MessageSquare,
  Sparkles,
  StickyNote,
  Strikethrough,
  Underline as UnderlineIcon,
} from 'lucide-react'
import {
  ANNOTATION_COLORS,
  DEFAULT_HIGHLIGHT_COLOR,
} from '../../lib/annotation-colors'

type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>

export type SelectionAction =
  | { type: 'highlight'; color: string }
  | { type: 'note'; content: string; color: string }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'todo' }
  | { type: 'ask' }
  | { type: 'copy' }
  | { type: 'define' }

interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

interface Props {
  /** Viewport-relative rect used for anchor math. `null` hides the toolbar. */
  anchorRect: AnchorRect | null
  onAction: (action: SelectionAction) => void
  onDismiss: () => void
}

/** Toolbar vertical offset from the selection rect (pixels). */
const GAP = 10
/** Approximate toolbar height; used to decide whether a "below" placement
 *  would clip off the viewport bottom and we should flip to "above". */
const TOOLBAR_HEIGHT_ESTIMATE = 44
/** Estimated toolbar width; used for horizontal edge-mirroring so the
 *  toolbar never clips past the viewport when a selection hugs the page
 *  margin. Actual width is ~380 px on the base layout + swatches. */
const TOOLBAR_WIDTH_ESTIMATE = 420

export default function PdfSelectionToolbar({
  anchorRect,
  onAction,
  onDismiss,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HIGHLIGHT_COLOR)

  // Reset transient state when the anchor disappears (selection cleared).
  useEffect(() => {
    if (!anchorRect) {
      setNoteOpen(false)
      setDraftNote('')
    }
  }, [anchorRect])

  // Keyboard shortcuts while the toolbar is visible. Typing into the note
  // textarea suppresses the single-letter handlers (checked via target).
  useEffect(() => {
    if (!anchorRect) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
        return
      }
      // Don't swallow single keys while user is typing a note.
      if (noteOpen) return
      const target = e.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case 'h':
          onAction({ type: 'highlight', color: highlightColor })
          break
        case 'n':
          setNoteOpen(true)
          break
        case 'u':
          onAction({ type: 'underline' })
          break
        case 's':
          onAction({ type: 'strike' })
          break
        case 't':
          onAction({ type: 'todo' })
          break
        case 'a':
          onAction({ type: 'ask' })
          break
        case 'c':
          onAction({ type: 'copy' })
          break
        case 'd':
          onAction({ type: 'define' })
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchorRect, highlightColor, noteOpen, onAction, onDismiss])

  const position = useMemo(() => {
    if (!anchorRect) return null
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    // Default to BELOW the selection's last line — keeps the toolbar out of
    // the reading path (selections above it stay unobstructed). Flip to
    // above only when there's no room below.
    const roomBelow = vh - anchorRect.bottom
    const placeBelow = roomBelow > TOOLBAR_HEIGHT_ESTIMATE + GAP
    // Horizontal: center on the anchor rect but clamp so the toolbar's
    // (unmeasured) width can't run off-screen at page edges.
    const rawCenterX = (anchorRect.left + anchorRect.right) / 2
    const halfW = TOOLBAR_WIDTH_ESTIMATE / 2
    const margin = 12
    const centerX = Math.min(
      Math.max(rawCenterX, halfW + margin),
      vw - halfW - margin,
    )
    return {
      top: placeBelow ? anchorRect.bottom + GAP : anchorRect.top - GAP,
      left: centerX,
      placeBelow,
    }
  }, [anchorRect])

  if (!anchorRect || !position) return null

  const rootStyle: CSSVarStyle = {
    '--pdf-tb-top': `${position.top}px`,
    '--pdf-tb-left': `${position.left}px`,
    '--pdf-tb-translate-y': position.placeBelow ? '0' : '-100%',
  }

  // `onMouseDown preventDefault` is load-bearing — it keeps the browser
  // selection alive while the user clicks a toolbar button (otherwise the
  // click collapses the selection and we lose `ann.rects`).
  const preventSelectionLoss = (e: React.MouseEvent) => e.preventDefault()

  return createPortal(
    <div
      className={`pdf-selection-toolbar${
        position.placeBelow ? ' is-below' : ' is-above'
      }`}
      style={rootStyle}
      onMouseDown={preventSelectionLoss}
      role="toolbar"
      aria-label="PDF selection tools"
    >
      {!noteOpen ? (
        <>
          <div className="pdf-selection-toolbar-group">
            <button
              type="button"
              className="pdf-selection-toolbar-btn is-primary"
              onClick={() =>
                onAction({ type: 'highlight', color: highlightColor })
              }
              title="Highlight (H)"
            >
              <Highlighter size={13} aria-hidden />
              <span>Highlight</span>
            </button>
            <div className="pdf-selection-toolbar-swatches" role="group" aria-label="Highlight color">
              {ANNOTATION_COLORS.map((spec) => {
                const swatchStyle: CSSVarStyle = { '--swatch': spec.hex }
                return (
                  <button
                    key={spec.id}
                    type="button"
                    className={`pdf-selection-toolbar-swatch${
                      highlightColor === spec.hex ? ' is-active' : ''
                    }`}
                    style={swatchStyle}
                    onClick={() => {
                      setHighlightColor(spec.hex)
                      onAction({ type: 'highlight', color: spec.hex })
                    }}
                    title={`${spec.label} — ${spec.hint}`}
                    aria-label={`${spec.label} highlight`}
                  />
                )
              })}
            </div>
          </div>

          <div className="pdf-selection-toolbar-divider" />

          <div className="pdf-selection-toolbar-group">
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => setNoteOpen(true)}
              title="Note (N)"
              aria-label="Add note"
            >
              <StickyNote size={13} aria-hidden />
            </button>
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => onAction({ type: 'underline' })}
              title="Underline (U)"
              aria-label="Underline"
            >
              <UnderlineIcon size={13} aria-hidden />
            </button>
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => onAction({ type: 'strike' })}
              title="Strike-through (S)"
              aria-label="Strike-through"
            >
              <Strikethrough size={13} aria-hidden />
            </button>
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => onAction({ type: 'todo' })}
              title="Mark as todo (T)"
              aria-label="Mark as todo"
            >
              <ListChecks size={13} aria-hidden />
            </button>
          </div>

          <div className="pdf-selection-toolbar-divider" />

          <div className="pdf-selection-toolbar-group">
            <button
              type="button"
              className="pdf-selection-toolbar-btn is-accent"
              onClick={() => onAction({ type: 'ask' })}
              title="Ask AI about this passage (A)"
            >
              <MessageSquare size={13} aria-hidden />
              <span>Ask AI</span>
            </button>
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => onAction({ type: 'copy' })}
              title="Copy quote with citation (C)"
              aria-label="Copy quote"
            >
              <Clipboard size={13} aria-hidden />
            </button>
            <button
              type="button"
              className="pdf-selection-toolbar-btn"
              onClick={() => onAction({ type: 'define' })}
              title="Define term (D)"
              aria-label="Define term"
            >
              <BookMarked size={13} aria-hidden />
            </button>
          </div>
        </>
      ) : (
        <div className="pdf-selection-toolbar-note">
          <textarea
            autoFocus
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setNoteOpen(false)
                setDraftNote('')
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                const next = draftNote.trim()
                if (!next) return
                onAction({ type: 'note', content: next, color: highlightColor })
                setNoteOpen(false)
                setDraftNote('')
              }
            }}
            placeholder="Note… (Ctrl+Enter to save, Esc to cancel)"
            className="pdf-selection-toolbar-note-input"
            rows={3}
          />
          <div className="pdf-selection-toolbar-note-actions">
            <button
              type="button"
              onClick={() => {
                setNoteOpen(false)
                setDraftNote('')
              }}
              className="pdf-selection-toolbar-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const next = draftNote.trim()
                if (!next) return
                onAction({
                  type: 'note',
                  content: next,
                  color: highlightColor,
                })
                setNoteOpen(false)
                setDraftNote('')
              }}
              className="pdf-selection-toolbar-btn is-primary"
            >
              <Sparkles size={12} aria-hidden />
              <span>Save</span>
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
