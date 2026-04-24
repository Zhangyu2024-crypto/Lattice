// ComputeCellView — single cell renderer for the Compute notebook.
//
// Renders the shared header (kind chip · status · meta · actions) and
// dispatches to a kind-specific body. Each body lives in `cell/` so the
// file stays focused on the shared chrome; the sub-components all share
// the same container so future "open in new tab" / "export" affordances
// can target any cell shape uniformly.

import { useState } from 'react'
import {
  ChevronRight,
  CopyPlus,
  GripVertical,
  Loader2,
  Play,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type {
  ComputeCell,
  ComputeCellKind,
} from '../../../types/artifact'
import { CellStatus, formatMeta } from './cell/CellStatus'
import { ProvenanceChip } from './cell/ProvenanceChip'
import { TweakButton, type TweakApplyArgs } from './cell/TweakPopover'
import { ExportButton } from './cell/ExportButton'
import { MarkdownBody, ScriptBody, StructureAiBody } from './cell/bodies'
import { CellOutput, firstLineSnippet } from './cell/outputs'

// Re-export so existing `import type { TweakApplyArgs } from './ComputeCellView'`
// call-sites (e.g. ComputeNotebook) keep working unchanged.
export type { TweakApplyArgs }

export interface ComputeCellViewProps {
  cell: ComputeCell
  sessionId: string
  isFocused: boolean
  isRunning: boolean
  healthDown: boolean
  onFocus: () => void
  onCodeChange: (code: string) => void
  onRun: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAskAI: () => void
  /** Only passed for structure cells that have a successful build. When
   *  supplied, the Tweak ▾ button appears in the header and dispatches
   *  one of the four supported tweak kinds. */
  onTweakApply?: (args: TweakApplyArgs) => void
  /** Only passed for structure cells that have a successful build.
   *  When supplied, the Export ▾ button appears in the header and
   *  dispatches one of the three export actions. */
  onExportAction?: (kind: 'cif' | 'lammps' | 'cp2k') => void
  /** Click "← from #N" provenance chip → focus the parent cell. */
  onJumpToParent?: (parentCellId: string) => void
  /** Click "← from structure <title>" → focus a structure artifact. */
  onJumpToStructure?: (structureId: string) => void
  /** Save-structure path — the notebook implements the cross-cutting
   *  work (create artifact, patch `cell.provenance.savedStructureId`).
   *  Resolves to the new artifact id, or null on failure. */
  onSaveStructure?: (name: string) => Promise<string | null>
  /** Persist a pane-height override after the user drops a resize
   *  handle. `pane` names one of the three resizable sub-panes
   *  (editor / viewer / console). */
  onPaneHeightChange?: (
    pane: 'editor' | 'viewer' | 'console',
    height: number,
  ) => void
  /** Flip the cell's collapsedInput / collapsedOutput flag. Wired to
   *  the chevron toggles in the cell header. */
  onToggleCollapse?: (pane: 'input' | 'output') => void
  /** Listeners + handle ref supplied by @dnd-kit's `useSortable`. When
   *  present, a grip-handle renders in the cell's left gutter and the
   *  whole cell becomes draggable. Omit for non-reorderable contexts. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  /** True while this cell is being dragged — used to dim / ghost it. */
  isDragging?: boolean
}

const KIND_LABEL: Record<ComputeCellKind, string> = {
  python: 'Python',
  lammps: 'LAMMPS',
  cp2k: 'CP2K',
  'structure-ai': 'Structure · AI',
  'structure-code': 'Structure · Code',
  markdown: 'Markdown',
  shell: 'Shell',
}

export default function ComputeCellView({
  cell,
  sessionId,
  isFocused,
  isRunning,
  healthDown,
  onFocus,
  onCodeChange,
  onRun,
  onDuplicate,
  onDelete,
  onAskAI,
  onTweakApply,
  onExportAction,
  onJumpToParent,
  onJumpToStructure,
  onSaveStructure,
  onPaneHeightChange,
  onToggleCollapse,
  dragHandleProps,
  isDragging,
}: ComputeCellViewProps) {
  const [tweakOpen, setTweakOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const isStructureAi = cell.kind === 'structure-ai'
  const isMarkdown = cell.kind === 'markdown'
  // Markdown cells never hit the runner — they're pure documentation.
  // Shell cells run through the container like python/lammps/cp2k.
  const needsContainer = !isStructureAi && !isMarkdown
  const runDisabled =
    isRunning || !cell.code.trim() || (needsContainer && healthDown)
  const runTitle = isRunning
    ? 'Running…'
    : !cell.code.trim()
      ? 'Empty cell'
      : needsContainer && healthDown
        ? 'Compute container is stopped'
        : isStructureAi
          ? 'Build structure via LLM'
          : 'Run · Ctrl+Enter'
  const runLabel = isStructureAi ? 'Build' : 'Run'

  const inputCollapsed = cell.collapsedInput === true
  const outputCollapsed = cell.collapsedOutput === true

  return (
    <div
      className={
        'compute-nb-cell' +
        (isFocused ? ' is-focused' : '') +
        (isDragging ? ' is-dragging' : '')
      }
      role="listitem"
      // `onMouseDownCapture` rather than `onClickCapture` so the focus
      // fires even when the pointer lands on something that swallows
      // the `click` event before it bubbles — CodeMirror's internal
      // handlers, the TweakPopover, header action buttons that
      // stopPropagation on mousedown, etc. Capture-phase mousedown is
      // the earliest signal React gives us and it runs before any
      // child can intervene.
      onMouseDownCapture={onFocus}
    >
      <header className="compute-nb-cell-head">
        {dragHandleProps && (
          <button
            type="button"
            className="compute-nb-cell-drag-handle"
            title="Drag to reorder"
            aria-label="Drag cell to reorder"
            {...dragHandleProps}
          >
            <GripVertical size={12} aria-hidden />
          </button>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            className="compute-nb-cell-collapse"
            title={inputCollapsed ? 'Expand code' : 'Collapse code'}
            aria-label={inputCollapsed ? 'Expand code' : 'Collapse code'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleCollapse('input')
            }}
          >
            <ChevronRight
              size={12}
              aria-hidden
              style={{
                transform: inputCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: 'transform 120ms ease',
              }}
            />
          </button>
        )}
        <span className={`compute-nb-kind-chip is-${cell.kind}`}>
          {KIND_LABEL[cell.kind] ?? cell.kind}
        </span>
        {typeof cell.executionCount === 'number' && cell.executionCount > 0 && (
          <span
            className="compute-nb-exec-count"
            title={`Executed ${cell.executionCount} time${cell.executionCount === 1 ? '' : 's'}`}
          >
            In [{cell.executionCount}]
          </span>
        )}
        <CellStatus cell={cell} isRunning={isRunning} />
        <span className="compute-nb-cell-meta">
          {formatMeta(cell.lastRun)}
        </span>
        {cell.provenance && (
          <ProvenanceChip
            provenance={cell.provenance}
            onJumpToParent={onJumpToParent}
            onJumpToStructure={onJumpToStructure}
          />
        )}
        <span className="compute-nb-spacer" />
        <button
          type="button"
          className="session-mini-btn"
          onClick={(e) => {
            e.stopPropagation()
            onAskAI()
          }}
          title="Ask AI about this cell · ⌘K"
          aria-label="Ask AI about this cell"
        >
          <Sparkles size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="session-mini-btn"
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate()
          }}
          title="Duplicate cell"
          aria-label="Duplicate cell"
        >
          <CopyPlus size={12} aria-hidden />
        </button>
        {onTweakApply && (
          <TweakButton
            open={tweakOpen}
            onOpenChange={setTweakOpen}
            onApply={onTweakApply}
          />
        )}
        {onExportAction && (
          <ExportButton
            open={exportOpen}
            onOpenChange={setExportOpen}
            onPick={onExportAction}
          />
        )}
        <button
          type="button"
          className="session-mini-btn is-danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          title="Delete cell"
          aria-label="Delete cell"
        >
          <Trash2 size={12} aria-hidden />
        </button>
        {!isMarkdown && (
          <button
            type="button"
            className="compute-nb-run-btn"
            onClick={(e) => {
              e.stopPropagation()
              onRun()
            }}
            disabled={runDisabled}
            title={runTitle}
          >
            {isRunning ? (
              <Loader2 size={12} className="spin" aria-hidden />
            ) : isStructureAi ? (
              <Sparkles size={12} aria-hidden />
            ) : (
              <Play size={12} aria-hidden />
            )}
            {runLabel}
          </button>
        )}
      </header>

      <div className="compute-nb-cell-body">
        {inputCollapsed ? (
          <button
            type="button"
            className="compute-nb-cell-collapsed-peek"
            onClick={() => onToggleCollapse?.('input')}
            title="Expand code"
          >
            … input collapsed ({firstLineSnippet(cell.code)})
          </button>
        ) : isMarkdown ? (
          <MarkdownBody code={cell.code} onCodeChange={onCodeChange} />
        ) : isStructureAi ? (
          <StructureAiBody
            code={cell.code}
            isRunning={isRunning}
            onCodeChange={onCodeChange}
          />
        ) : (
          <ScriptBody
            kind={cell.kind}
            code={cell.code}
            onCodeChange={onCodeChange}
            editorHeight={cell.paneHeights?.editor}
            onEditorHeightChange={
              onPaneHeightChange
                ? (h) => onPaneHeightChange('editor', h)
                : undefined
            }
          />
        )}

        {!isMarkdown && onToggleCollapse && cell.lastRun && (
          <button
            type="button"
            className="compute-nb-cell-output-toggle"
            onClick={() => onToggleCollapse('output')}
            title={outputCollapsed ? 'Expand output' : 'Collapse output'}
          >
            <ChevronRight
              size={11}
              aria-hidden
              style={{
                transform: outputCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                transition: 'transform 120ms ease',
              }}
            />
            {outputCollapsed ? 'output collapsed — click to expand' : 'output'}
          </button>
        )}

        {!isMarkdown && !outputCollapsed && (
          <CellOutput
            cell={cell}
            sessionId={sessionId}
            isRunning={isRunning}
            onSaveStructure={onSaveStructure}
            onPaneHeightChange={onPaneHeightChange}
          />
        )}
      </div>
    </div>
  )
}

