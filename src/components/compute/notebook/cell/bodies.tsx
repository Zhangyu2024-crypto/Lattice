// Editor bodies — extracted from ComputeCellView. Three kinds:
//
//   • ScriptBody     — CodeMirror editor for python / lammps / cp2k /
//                      structure-code / shell cells.
//   • StructureAiBody — plain textarea prompting the LLM to produce CIF.
//   • MarkdownBody    — Jupyter-style click-to-edit markdown cell.

import { useEffect, useMemo, useRef, useState } from 'react'
import { python } from '@codemirror/lang-python'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeMirrorEditor from '../../../editor/editors/CodeMirrorEditor'
import { ResizeHandle } from '../ResizeHandle'
import type { ComputeCellKind } from '../../../../types/artifact'

export function ScriptBody({
  kind,
  code,
  onCodeChange,
  editorHeight,
  onEditorHeightChange,
}: {
  kind: ComputeCellKind
  code: string
  onCodeChange: (code: string) => void
  editorHeight?: number
  onEditorHeightChange?: (h: number) => void
}) {
  // Python highlighter covers python AND structure-code (pymatgen scripts).
  // LAMMPS / CP2K don't have dedicated @codemirror grammars — fallback to
  // plain text is acceptable (consistent with the prior workbench).
  const usePython = kind === 'python' || kind === 'structure-code'
  const languageExt = useMemo(() => (usePython ? python() : undefined), [usePython])
  // Draft height during drag; committed value lives on the cell payload
  // and re-enters via `editorHeight` prop after `onEditorHeightChange`.
  const [draft, setDraft] = useState<number | null>(null)
  const height = draft ?? editorHeight ?? 180
  return (
    <>
      <div className="compute-nb-cell-editor" style={{ height }}>
        <CodeMirrorEditor
          value={code}
          onChange={onCodeChange}
          language={languageExt}
        />
      </div>
      {onEditorHeightChange && (
        <ResizeHandle
          height={height}
          min={80}
          max={800}
          onDraft={setDraft}
          onCommit={(final) => {
            setDraft(null)
            onEditorHeightChange(final)
          }}
          label="Resize editor"
        />
      )}
    </>
  )
}

/**
 * Markdown cell body — Jupyter-style click-to-edit. The rendered
 * markdown is the default view; double-clicking swaps in a textarea
 * for editing, and Escape / blur swaps back to preview. This matches
 * the "markdown cell" UX users have in their muscle memory from
 * Jupyter / JupyterLab / VS Code notebooks.
 */
export function MarkdownBody({
  code,
  onCodeChange,
}: {
  code: string
  onCodeChange: (code: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(false)
    }
    // Shift+Enter as "commit + exit edit" — parallels the "run" meaning
    // shift+Enter has elsewhere in the notebook (there's no run for md).
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="compute-nb-markdown-editor">
        <textarea
          ref={textareaRef}
          className="compute-nb-markdown-input"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder="Write markdown…"
        />
        <div className="compute-nb-markdown-hint">
          Esc / Shift+Enter to finish · click out to preview
        </div>
      </div>
    )
  }

  return (
    <div
      className="compute-nb-markdown-preview"
      role="region"
      tabIndex={0}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          setEditing(true)
        }
      }}
      title="Double-click (or press Enter) to edit"
    >
      {code.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{code}</ReactMarkdown>
      ) : (
        <span className="compute-nb-markdown-placeholder">
          Double-click to write markdown…
        </span>
      )}
    </div>
  )
}

export function StructureAiBody({
  code,
  isRunning,
  onCodeChange,
}: {
  code: string
  isRunning: boolean
  onCodeChange: (code: string) => void
}) {
  return (
    <textarea
      className="compute-nb-structure-input"
      value={code}
      onChange={(e) => onCodeChange(e.target.value)}
      placeholder="Describe a structure — e.g. '2x2x2 supercell of Fe3O4 with an oxygen vacancy on site 4', 'perovskite BaTiO3 tetragonal phase'…"
      disabled={isRunning}
      rows={5}
    />
  )
}
