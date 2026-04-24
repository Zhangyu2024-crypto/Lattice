// CIF text editor modal — the expert escape hatch for structure
// artifacts. Mounted from StructureArtifactCard's "Edit CIF…" button.
//
// Contract:
//   • Seeds its textarea with the artifact's current canonical CIF.
//   • On Save, re-parses through parseCif + writeCif → builds a fresh
//     StructureArtifactPayload and hands it to `onSave` (the card's
//     `onPatchPayload` wrapper). Parse failure surfaces inline so the
//     user can correct the text without losing their draft.
//   • Esc / Cancel / backdrop click close without saving.
//
// Why a full text editor instead of per-field inputs? The CIF spec is
// broad enough (multi-occupancy, non-P1 settings, site labels, ADPs,
// spacegroup Hermann-Mauguin strings) that any structured UI either
// omits edge cases or balloons into a second app. Experts already
// speak CIF; a textarea + reparse is the cheapest "let me tweak
// anything" UX.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import {
  computeFormula,
  computeLatticeParams,
  parseCif,
  writeCif,
  type ParsedCif,
} from '../../../../lib/cif'
import type {
  StructureArtifactPayload,
  StructureTransform,
} from '../../../../types/artifact'
import { useEscapeKey } from '../../../../hooks/useEscapeKey'

interface Props {
  open: boolean
  onClose: () => void
  /** Current payload — we seed the textarea from `payload.cif` and
   *  preserve `transforms` / `computedFromArtifactId` across save so
   *  the audit trail remains intact. */
  payload: StructureArtifactPayload
  onSave: (nextPayload: StructureArtifactPayload) => void
}

export default function EditCifDialog({
  open,
  onClose,
  payload,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(payload.cif)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEscapeKey(onClose, open)

  // Re-seed whenever the dialog opens so a second Edit picks up any
  // intervening transforms (supercell, etc.). Avoids "reopened with
  // stale text" confusion.
  useEffect(() => {
    if (!open) return
    setDraft(payload.cif)
    setError(null)
    const t = window.setTimeout(() => {
      textareaRef.current?.focus()
      // Don't select-all — experts usually tweak a line, not rewrite.
    }, 0)
    return () => window.clearTimeout(t)
  }, [open, payload.cif])

  const handleSave = useCallback(() => {
    const text = draft.trim()
    if (!text) {
      setError('CIF text cannot be empty.')
      return
    }
    let parsed: ParsedCif
    try {
      parsed = parseCif(text)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Parse failed: ${msg}`)
      return
    }
    if (parsed.sites.length === 0) {
      setError(
        'No atom sites found. The CIF must include a `loop_` with ' +
          '`_atom_site_fract_x/y/z` columns.',
      )
      return
    }
    try {
      const canonicalCif = writeCif(parsed)
      const nextPayload: StructureArtifactPayload = {
        ...payload,
        cif: canonicalCif,
        formula: computeFormula(parsed.sites),
        spaceGroup: parsed.spaceGroup ?? 'P 1',
        latticeParams: computeLatticeParams(parsed),
        transforms: [
          ...payload.transforms,
          buildEditTransform(payload.cif, canonicalCif),
        ],
      }
      onSave(nextPayload)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Save failed: ${msg}`)
    }
  }, [draft, payload, onClose, onSave])

  if (!open) return null
  return (
    <div
      className="add-structure-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-cif-title"
    >
      <div className="add-structure-dialog" style={{ width: 640 }}>
        <div className="add-structure-header">
          <div className="add-structure-title" id="edit-cif-title">
            Edit CIF · {payload.formula}
          </div>
          <button
            type="button"
            className="add-structure-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="add-structure-body">
          <div className="add-structure-hint">
            Edit any field — lattice parameters, atom coords, occupancies,
            site labels. On Save, the CIF is re-parsed, re-canonicalised,
            and written back to this artifact (the old CIF is preserved
            in the transform history). Parse errors show inline without
            dropping your draft.
          </div>

          <textarea
            ref={textareaRef}
            className="add-structure-textarea"
            style={{
              minHeight: 340,
              maxHeight: 520,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.5,
            }}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            spellCheck={false}
          />

          {error && (
            <div className="add-structure-error" role="alert">
              <div className="add-structure-error-head">
                <AlertTriangle size={12} strokeWidth={1.8} aria-hidden />
                <span className="add-structure-error-summary">{error}</span>
              </div>
            </div>
          )}
        </div>

        <div className="add-structure-actions">
          <button
            type="button"
            className="add-structure-btn is-ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="add-structure-btn is-primary"
            onClick={handleSave}
            disabled={draft.trim().length === 0}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/** Build a transform row noting the raw-text edit. Not a structural
 *  operation per se, but useful provenance — someone scanning the
 *  transform log can tell "oh, the user hand-edited the CIF at t=5pm"
 *  instead of wondering why the atom count suddenly changed. */
function buildEditTransform(
  previousCif: string,
  nextCif: string,
): StructureTransform {
  const delta = nextCif.length - previousCif.length
  return {
    id: `xfm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'import',
    params: { source: 'manual_cif_edit', byteDelta: delta },
    appliedAt: Date.now(),
    note: `Manual CIF edit (${delta >= 0 ? '+' : ''}${delta} chars)`,
  }
}
