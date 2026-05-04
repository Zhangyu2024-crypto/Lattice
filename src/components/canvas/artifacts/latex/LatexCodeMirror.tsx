import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'
import { latex } from 'codemirror-lang-latex'

interface Props {
  /** Source text for the currently active file. */
  value: string
  onChange: (next: string) => void
  onCursorChange?: (cursor: number) => void
  /** Additional extensions appended after the base stack. Phase B/C plugin
   *  points (selection menu, ghost text) flow through here without touching
   *  this host. */
  extraExtensions?: readonly Extension[]
}

// Sibling of ComputeArtifactCard's inline editor (src/components/canvas/
// artifacts/ComputeArtifactCard.tsx:192-225). Kept as a thin host so Phase B
// can inject selection-toolbar extensions and Phase C the ghost-text plugin
// without disturbing the multi-file switching logic in LatexDocumentCard.
export default function LatexCodeMirror({
  value,
  onChange,
  onCursorChange,
  extraExtensions,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  onChangeRef.current = onChange
  onCursorChangeRef.current = onCursorChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        keymap.of([...defaultKeymap, indentWithTab]),
        latex(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
          if (update.selectionSet) {
            onCursorChangeRef.current?.(
              update.state.selection.main.head,
            )
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: 'var(--text-base)' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
        ...(extraExtensions ?? []),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Recreate when collaboration extensions switch between local editing
    // and Yjs-backed editing. File switches and AI replacements are still
    // keyed by the parent, so `value` intentionally stays out of deps.
  }, [extraExtensions])

  return <div ref={hostRef} className="latex-editor-host" />
}
