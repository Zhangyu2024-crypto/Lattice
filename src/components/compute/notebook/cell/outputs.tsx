// Cell output area — dispatcher and public surface.
//
// The real renderers live under ./outputs/* (one file per kind) so this
// module stays small and easy to scan. The split is behaviour-preserving:
//   • CellOutput           — dispatches on cell.kind to the right renderer.
//   • ScriptOutput         — stdout / stderr / error / figures panel.
//   • StructureOutput      — 3D StructureViewer + CIF pre + save/export.
//   • OutputSection        — shared labelled section wrapper.
//   • StderrWithTraceback  — Python traceback highlighter.
//   • firstLineSnippet     — one-line preview used for collapsed-input peek.
//
// External callers only import CellOutput and firstLineSnippet; the
// remaining symbols are re-exported for the sake of the (unchanged)
// module contract.

import { Loader2 } from 'lucide-react'
import type { ComputeCell } from '../../../../types/artifact'

import { ScriptOutput } from './outputs/ScriptOutput'
import { StructureOutput } from './outputs/StructureOutput'

export { OutputSection } from './outputs/OutputSection'
export { StderrWithTraceback } from './outputs/StderrWithTraceback'
export { ScriptOutput } from './outputs/ScriptOutput'
export { StructureOutput } from './outputs/StructureOutput'
export { firstLineSnippet } from './outputs/helpers'

export function CellOutput({
  cell,
  sessionId,
  isRunning,
  onSaveStructure,
  onPaneHeightChange,
}: {
  cell: ComputeCell
  sessionId: string
  isRunning: boolean
  onSaveStructure?: (name: string) => Promise<string | null>
  onPaneHeightChange?: (
    pane: 'editor' | 'viewer' | 'console',
    height: number,
  ) => void
}) {
  if (isRunning) {
    return (
      <div className="compute-nb-cell-output is-running">
        <Loader2 size={14} className="spin" aria-hidden />
        <span>
          {cell.kind === 'structure-ai' ? 'Generating CIF…' : 'Executing…'}
        </span>
      </div>
    )
  }
  const run = cell.lastRun
  if (!run || run.endedAt == null) return null

  // Structure cells try to render a 3D viewer when stdout parses as CIF.
  if (cell.kind === 'structure-ai' || cell.kind === 'structure-code') {
    return (
      <StructureOutput
        cell={cell}
        run={run}
        sessionId={sessionId}
        onSaveStructure={onSaveStructure}
        viewerHeight={cell.paneHeights?.viewer}
        onViewerHeightChange={
          onPaneHeightChange
            ? (h) => onPaneHeightChange('viewer', h)
            : undefined
        }
        consoleHeight={cell.paneHeights?.console}
        onConsoleHeightChange={
          onPaneHeightChange
            ? (h) => onPaneHeightChange('console', h)
            : undefined
        }
      />
    )
  }
  return (
    <ScriptOutput
      run={run}
      consoleHeight={cell.paneHeights?.console}
      onConsoleHeightChange={
        onPaneHeightChange
          ? (h) => onPaneHeightChange('console', h)
          : undefined
      }
    />
  )
}
