// Phase α — per-tool inline editor registry for ToolCallCard.
//
// When the orchestrator pauses a tool step for approval, the card looks
// up the tool name here and, if a custom editor is registered, renders it
// between the card body and the Approve / Reject / Expand button row.
// The editor hands its user-edited payload back through `onChange`; the
// card forwards that payload to `setStepApproval` when the user clicks
// Approve.

import { lazy, Suspense, type ComponentType } from 'react'
import type { TaskStep } from '../../../types/session'

/**
 * An inline approval editor. Receives the paused step plus a change
 * callback; whatever value it passes to `onChange` becomes the
 * `editedOutput` sent through `setStepApproval(..., 'approved', edited)`.
 * Editors should treat `step.output` as read-only and derive local
 * state from it.
 */
export interface ToolCardEditorProps {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export type ToolCardEditor = ComponentType<ToolCardEditorProps>

function lazyEditor(
  loader: () => Promise<{ default: ComponentType<ToolCardEditorProps> }>,
): ToolCardEditor {
  const LazyEditor = lazy(loader)
  return function LazyToolCardEditor(props: ToolCardEditorProps) {
    return (
      <Suspense
        fallback={
          <div className="tool-approval-editor-empty">
            Loading editor…
          </div>
        }
      >
        <LazyEditor {...props} />
      </Suspense>
    )
  }
}

const DetectPeaksCardEditor = lazyEditor(
  () => import('./DetectPeaksCardEditor'),
)
const XpsFitPeaksEditor = lazyEditor(
  () => import('./editors/XpsFitPeaksEditor'),
)
const ComputeScriptEditor = lazyEditor(
  () => import('./editors/ComputeScriptEditor'),
)
const LatexEditSelectionEditor = lazyEditor(
  () => import('./editors/LatexEditSelectionEditor'),
)
const LatexFixCompileErrorEditor = lazyEditor(
  () => import('./editors/LatexFixCompileErrorEditor'),
)
const LatexFigureEditor = lazyEditor(
  () => import('./editors/LatexFigureEditor'),
)
const WorkspaceWriteFileEditor = lazyEditor(
  () => import('./editors/WorkspaceWriteFileEditor'),
)
const WorkspaceEditFileEditor = lazyEditor(
  () => import('./editors/WorkspaceEditFileEditor'),
)

const REGISTRY: Record<string, ToolCardEditor> = {
  detect_peaks: DetectPeaksCardEditor,
  xps_fit_peaks: XpsFitPeaksEditor,
  compute_create_script: ComputeScriptEditor,
  latex_edit_selection: LatexEditSelectionEditor,
  latex_fix_compile_error: LatexFixCompileErrorEditor,
  latex_insert_figure_from_artifact: LatexFigureEditor,
  workspace_write_file: WorkspaceWriteFileEditor,
  workspace_edit_file: WorkspaceEditFileEditor,
  format_convert: WorkspaceWriteFileEditor,
  compute_from_snippet: ComputeScriptEditor,
  simulate_structure: ComputeScriptEditor,
  structure_tweak: ComputeScriptEditor,
  export_for_engine: ComputeScriptEditor,
}

export function getToolCardEditor(
  toolName: string | undefined,
): ToolCardEditor | null {
  if (!toolName) return null
  return REGISTRY[toolName] ?? null
}
