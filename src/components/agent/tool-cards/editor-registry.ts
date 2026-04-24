// Phase α — per-tool inline editor registry for ToolCallCard.
//
// When the orchestrator pauses a tool step for approval, the card looks
// up the tool name here and, if a custom editor is registered, renders it
// between the card body and the Approve / Reject / Expand button row.
// The editor hands its user-edited payload back through `onChange`; the
// card forwards that payload to `setStepApproval` when the user clicks
// Approve.
//
// Keep this file light — it exists to keep ToolCallCard.tsx from having
// to import every domain-specific editor up-front. New editors should
// drop a file next to this registry and add one entry below; the editor
// module itself can be lazy-loaded later if the bundle grows.

import type { ComponentType } from 'react'
import type { TaskStep } from '../../../types/session'
import DetectPeaksCardEditor from './DetectPeaksCardEditor'
import XpsFitPeaksEditor from './editors/XpsFitPeaksEditor'
import ComputeScriptEditor from './editors/ComputeScriptEditor'
import LatexEditSelectionEditor from './editors/LatexEditSelectionEditor'
import LatexFixCompileErrorEditor from './editors/LatexFixCompileErrorEditor'
import LatexFigureEditor from './editors/LatexFigureEditor'
import WorkspaceWriteFileEditor from './editors/WorkspaceWriteFileEditor'
import WorkspaceEditFileEditor from './editors/WorkspaceEditFileEditor'

/**
 * An inline approval editor. Receives the paused step plus a change
 * callback; whatever value it passes to `onChange` becomes the
 * `editedOutput` sent through `setStepApproval(..., 'approved', edited)`.
 * Editors should treat `step.output` as read-only and derive local
 * state from it — the store write round-trips through `approvalState`
 * and `editedOutput` only.
 */
export interface ToolCardEditorProps {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export type ToolCardEditor = ComponentType<ToolCardEditorProps>

const REGISTRY: Record<string, ToolCardEditor> = {
  detect_peaks: DetectPeaksCardEditor,
  xps_fit_peaks: XpsFitPeaksEditor,
  compute_create_script: ComputeScriptEditor,
  latex_edit_selection: LatexEditSelectionEditor,
  latex_fix_compile_error: LatexFixCompileErrorEditor,
  latex_insert_figure_from_artifact: LatexFigureEditor,
  workspace_write_file: WorkspaceWriteFileEditor,
  workspace_edit_file: WorkspaceEditFileEditor,
  // format_convert emits a WorkspaceWriteProposal — reuse the same diff
  // editor card so the user sees the new-file preview before approving.
  format_convert: WorkspaceWriteFileEditor,
  // Domain-aware compute tools reuse the same CM6 editor as
  // compute_create_script — all emit { artifactId, ... } and create a
  // ComputeArtifact the editor can read code from.
  compute_from_snippet: ComputeScriptEditor,
  simulate_structure: ComputeScriptEditor,
  structure_tweak: ComputeScriptEditor,
  export_for_engine: ComputeScriptEditor,
}

/** Look up the editor component for a tool name. Returns `null` when
 *  no custom editor is registered — the card then renders just the
 *  default body + approval button row. */
export function getToolCardEditor(toolName: string | undefined): ToolCardEditor | null {
  if (!toolName) return null
  return REGISTRY[toolName] ?? null
}
