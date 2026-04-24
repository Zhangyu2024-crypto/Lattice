// 3D StructureViewer + CIF pre + save/export for structure-ai and
// structure-code cells.
//
// The component is intentionally pessimistic about the LLM output —
// if `parseCif(stdout)` doesn't produce sites we fall back to the
// plain console view so the tracebacks / raw reply stay visible. All
// of the interactive bits (rename + save, copy, toggle generated
// Python, toggle CIF source) live here rather than in sub-components
// because they share state with the header row and splitting further
// buys nothing.

import { useCallback, useMemo, useState } from 'react'
import { Atom, Check, Copy, FileImage } from 'lucide-react'

import StructureViewer from '../../../../canvas/artifacts/structure/StructureViewer'
import { ResizeHandle } from '../../ResizeHandle'
import { computeFormula, parseCif } from '../../../../../lib/cif'
import { useRuntimeStore } from '../../../../../stores/runtime-store'
import { toast } from '../../../../../stores/toast-store'
import type { ComputeCell, ComputeProRun } from '../../../../../types/artifact'
import { RenameSaveInput } from '../RenameSaveInput'
import { OutputSection } from './OutputSection'
import { StderrWithTraceback } from './StderrWithTraceback'

export function StructureOutput({
  cell,
  run,
  sessionId,
  onSaveStructure,
  viewerHeight,
  onViewerHeightChange,
  consoleHeight,
  onConsoleHeightChange,
}: {
  cell: ComputeCell
  run: ComputeProRun
  sessionId: string
  onSaveStructure?: (name: string) => Promise<string | null>
  viewerHeight?: number
  onViewerHeightChange?: (h: number) => void
  consoleHeight?: number
  onConsoleHeightChange?: (h: number) => void
}) {
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showCifSource, setShowCifSource] = useState(false)
  // Structure-ai cells carry the LLM-generated pymatgen script on the
  // run; this toggles a collapsible block so the user can inspect /
  // copy it without a second LLM call. Default off to keep the viewer
  // the primary focus.
  const [showGeneratedCode, setShowGeneratedCode] = useState(false)
  const generatedCode = run.generatedCode ?? null
  // Drag-resize drafts; committed values live on cell.paneHeights.
  const [draftViewerH, setDraftViewerH] = useState<number | null>(null)
  const [draftConsoleH, setDraftConsoleH] = useState<number | null>(null)
  const effectiveViewerH = draftViewerH ?? viewerHeight ?? 360
  const effectiveConsoleH = draftConsoleH ?? consoleHeight ?? 360
  // Inline rename state — when the user clicks "Save structure" the first
  // time we open a tiny <input> seeded with the suggested title. Enter
  // commits, Esc cancels. A second click without editing (or just Enter)
  // saves with the suggestion.
  const [renameOpen, setRenameOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const cifText = run.stdout
  const hasStderr = run.stderr.trim().length > 0
  const parsed = useMemo(() => {
    const trimmed = cifText.trim()
    if (!trimmed) return null
    try {
      const p = parseCif(cifText)
      if (p.sites.length === 0) return null
      return p
    } catch {
      return null
    }
  }, [cifText])

  const hasValidCif = parsed !== null
  const formula = parsed ? computeFormula(parsed.sites) : null

  // "Saved" bit lives on the cell's provenance so it survives renders
  // and HMR. When set, the CTA flips to "Open saved" and reopens the
  // existing artifact instead of creating a duplicate.
  const savedId = cell.provenance?.savedStructureId ?? null

  const commitSave = useCallback(
    async (rawName: string) => {
      if (!parsed || saving || !onSaveStructure) return
      const fallback = formula || cell.title || 'structure'
      const name = rawName.trim() || fallback
      setSaving(true)
      try {
        const newId = await onSaveStructure(name)
        if (newId) {
          setRenameOpen(false)
          setNameDraft('')
        }
      } finally {
        setSaving(false)
      }
    },
    [parsed, saving, onSaveStructure, formula, cell.title],
  )

  const handleSaveClick = useCallback(() => {
    if (savedId) {
      focusArtifact(sessionId, savedId)
      return
    }
    if (!parsed) return
    // First click just opens the rename input (focused by effect below);
    // user presses Enter or the Save button to actually commit.
    if (!renameOpen) {
      setNameDraft(formula || cell.title || 'structure')
      setRenameOpen(true)
      return
    }
    void commitSave(nameDraft)
  }, [
    savedId,
    focusArtifact,
    sessionId,
    parsed,
    renameOpen,
    formula,
    cell.title,
    nameDraft,
    commitSave,
  ])

  const handleCopy = useCallback(async () => {
    if (!cifText.trim()) return
    try {
      await navigator.clipboard.writeText(cifText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error('Copy failed')
    }
  }, [cifText])

  if (!hasValidCif) {
    // Structure-code cell that failed (or structure-ai that returned no CIF) —
    // fall back to the plain console so tracebacks / LLM raw reply are visible.
    // When the LLM emitted code but pymatgen errored, show the generated
    // script too — it's the load-bearing artifact for debugging.
    return (
      <div className="compute-nb-cell-output">
        {generatedCode && (
          <OutputSection label="generated python">
            <pre className="compute-nb-console">{generatedCode}</pre>
          </OutputSection>
        )}
        {cifText.trim() && (
          <OutputSection label="stdout">
            <pre className="compute-nb-console">{cifText}</pre>
          </OutputSection>
        )}
        {hasStderr && (
          <OutputSection label={cell.kind === 'structure-ai' ? 'error' : 'stderr'}>
            <pre className="compute-nb-console is-err">
              <StderrWithTraceback text={run.stderr} />
            </pre>
          </OutputSection>
        )}
        {!cifText.trim() && !hasStderr && !generatedCode && (
          <div className="compute-nb-output-empty">
            <FileImage size={14} strokeWidth={1.2} aria-hidden />
            <span>No CIF detected.</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="compute-nb-cell-output">
      <div className="compute-nb-structure-header">
        <span className="compute-nb-output-label">Structure</span>
        {formula && (
          <span className="compute-nb-structure-formula">{formula}</span>
        )}
        {parsed?.spaceGroup && (
          <span className="compute-nb-structure-sg">{parsed.spaceGroup}</span>
        )}
        <span className="compute-nb-spacer" />
        {generatedCode && (
          <button
            type="button"
            className="compute-nb-ghost-btn"
            onClick={(e) => {
              e.stopPropagation()
              setShowGeneratedCode((v) => !v)
            }}
            title={
              showGeneratedCode
                ? 'Hide generated Python'
                : 'Show the pymatgen script the LLM produced'
            }
          >
            {showGeneratedCode ? 'Hide Python' : 'Show Python'}
          </button>
        )}
        <button
          type="button"
          className="compute-nb-ghost-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowCifSource((v) => !v)
          }}
          title={showCifSource ? 'Hide CIF source' : 'Show CIF source'}
        >
          {showCifSource ? 'Hide CIF' : 'Show CIF'}
        </button>
        <button
          type="button"
          className="compute-nb-ghost-btn"
          onClick={(e) => {
            e.stopPropagation()
            void handleCopy()
          }}
          title="Copy CIF"
        >
          {copied ? (
            <>
              <Check size={11} aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy size={11} aria-hidden /> Copy
            </>
          )}
        </button>
        {renameOpen && !savedId ? (
          <RenameSaveInput
            value={nameDraft}
            onChange={setNameDraft}
            onCommit={() => void commitSave(nameDraft)}
            onCancel={() => {
              setRenameOpen(false)
              setNameDraft('')
            }}
            disabled={saving}
          />
        ) : (
          <button
            type="button"
            className="compute-nb-run-btn is-small"
            onClick={(e) => {
              e.stopPropagation()
              handleSaveClick()
            }}
            disabled={saving}
            title={
              savedId
                ? 'Focus the saved Structure artifact'
                : 'Save this structure as a top-level artifact'
            }
          >
            <Atom size={11} aria-hidden />
            {savedId ? 'Open saved' : 'Save structure'}
          </button>
        )}
      </div>
      <div
        className="compute-nb-structure-viewer"
        style={{ height: effectiveViewerH }}
      >
        <StructureViewer
          cif={cifText}
          style="ball-stick"
          showUnitCell
          autoSpin={false}
          showAxes={false}
        />
      </div>
      {onViewerHeightChange && (
        <ResizeHandle
          height={effectiveViewerH}
          min={180}
          max={900}
          onDraft={setDraftViewerH}
          onCommit={(f) => {
            setDraftViewerH(null)
            onViewerHeightChange(f)
          }}
          label="Resize 3D viewer"
        />
      )}
      {showGeneratedCode && generatedCode && (
        <OutputSection label="generated python">
          <pre
            className="compute-nb-console"
            style={{ maxHeight: effectiveConsoleH }}
          >
            {generatedCode}
          </pre>
        </OutputSection>
      )}
      {showCifSource && (
        <>
          <pre
            className="compute-nb-console compute-nb-structure-source"
            style={{ maxHeight: effectiveConsoleH }}
          >
            {cifText}
          </pre>
          {onConsoleHeightChange && (
            <ResizeHandle
              height={effectiveConsoleH}
              min={100}
              max={600}
              onDraft={setDraftConsoleH}
              onCommit={(f) => {
                setDraftConsoleH(null)
                onConsoleHeightChange(f)
              }}
              label="Resize CIF source"
            />
          )}
        </>
      )}
      {hasStderr && (
        <OutputSection label="notes">
          <pre
            className="compute-nb-console is-err"
            style={{ maxHeight: effectiveConsoleH }}
          >
            <StderrWithTraceback text={run.stderr} />
          </pre>
        </OutputSection>
      )}
    </div>
  )
}
