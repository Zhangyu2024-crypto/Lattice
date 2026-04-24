// Compute Notebook — a single scrollable stream of persistent cells.
//
// One mental model: a compute-pro artifact has a `cells` array; the UI
// renders one cell per entry. Cells are editable Jupyter-style; each
// kind (python / lammps / cp2k / structure-ai / structure-code) owns a
// body component in `ComputeCellView`. Cells are created from:
//   - "+ New cell ▾" split-button in the topbar (appends to end)
//   - `CellInsertGap` between any two cells (inserts at that index)
//   - Ask AI dock (replaces focused cell or spawns a new one)
// AI is always available via the persistent ComputeAskDock at the
// bottom of the main column; Cmd+K focuses it (it does not open a
// modal). Each cell has a Sparkles button in its overflow menu that
// sets the dock's target + focuses the input.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { useComputeRunner } from '../../../hooks/useComputeRunner'
import { localProCompute } from '../../../lib/local-pro-compute'
import { useRuntimeStore } from '../../../stores/runtime-store'
import { toast } from '../../../stores/toast-store'
import type {
  ComputeCell,
  ComputeCellKind,
  ComputeProArtifact,
  ComputeProPayload,
} from '../../../types/artifact'
import ComputeCellView from './ComputeCellView'
import AddStructureDialog from './AddStructureDialog'
import ComputeAskDock, {
  type CmdKApply,
  type ComputeAskDockHandle,
} from './ComputeAskDock'
import ComputeAssetsRail, {
  type FileRow,
  type StructureRow,
} from './ComputeAssetsRail'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useOutsideClickDismiss } from '../../../hooks/useOutsideClickDismiss'
import {
  genArtifactId,
  selectActiveSession,
} from '../../../stores/runtime-store'
import { NewCellMenu } from './menus/NewCellMenu'
import { RunMenu } from './menus/RunMenu'
import { CellInsertGap } from './menus/CellInsertGap'
import { StreamFootCreator } from './menus/StreamFootCreator'
import { EmptyStream } from './menus/EmptyStream'
import { SortableCellSlot } from './menus/SortableCellSlot'
import { healthDotColor, healthTooltip } from './menus/health'
import {
  buildDopeTweak,
  buildSupercellTweak,
  buildSurfaceTweak,
  buildVacancyTweak,
  type TweakResult,
} from '../../../lib/compute-tweak-templates'
import type { TweakApplyArgs } from './ComputeCellView'
import {
  buildCp2kExportCell,
  buildLammpsExportCell,
} from '../../../lib/compute-export-templates'
import { downloadTextFile } from '../../../lib/pro-export'
import { slugForCifKey } from '../../../lib/local-pro-compute'
import {
  computeFormula,
  computeLatticeParams,
  parseCif,
} from '../../../lib/cif'
import type {
  StructureArtifact,
  StructureArtifactPayload,
} from '../../../types/artifact'

interface Props {
  sessionId: string
  artifact: ComputeProArtifact
  /** One-shot: if non-null on mount (or when it changes), the notebook
   *  creates a new cell with this shape + focuses it. Used by
   *  StructureCard → Simulate ▾ to spawn pre-filled cells from outside
   *  the overlay. */
  initialSpawn?: {
    kind: ComputeCellKind
    code: string
    title?: string
    provenance?: import('../../../types/artifact').ComputeCellProvenance
  } | null
  onSpawnConsumed?: () => void
  /** One-shot: focus this cell on mount (e.g. StructureCard → Used in
   *  back-link). Separate from `initialSpawn` because it addresses an
   *  existing cell rather than creating one. */
  initialFocusCellId?: string | null
  onFocusCellConsumed?: () => void
}

const HEALTH_POLL_MS = 30_000

const STARTER_CODE: Partial<Record<ComputeCellKind, string>> = {
  python:
    '# Write Python to analyze your data.\n' +
    "print('hello from compute')\n",
  lammps:
    '# LAMMPS input deck — minimal LJ liquid template\n' +
    'units lj\natom_style atomic\n',
  cp2k:
    '# CP2K input — fill in &FORCE_EVAL / &SUBSYS\n',
  'structure-code':
    '# Generate a CIF and print it to stdout.\n' +
    'from pymatgen.core import Lattice, Structure\n\n' +
    'lattice = Lattice.cubic(3.994)\n' +
    'species = ["Ba", "Ti", "O", "O", "O"]\n' +
    'coords = [\n' +
    '    [0.0, 0.0, 0.0],\n' +
    '    [0.5, 0.5, 0.5],\n' +
    '    [0.5, 0.5, 0.0],\n' +
    '    [0.5, 0.0, 0.5],\n' +
    '    [0.0, 0.5, 0.5],\n' +
    ']\n' +
    'structure = Structure(lattice, species, coords)\n' +
    'print(structure.to(fmt="cif"))\n',
  shell:
    '# Shell cell — bash runs in the bundled conda environment.\n' +
    'pwd\n' +
    'ls -la\n',
  markdown:
    '## New section\n\nWrite notes, context, equations, whatever. Double-click to edit.\n',
}

function newCellId(): string {
  return `cell_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export default function ComputeNotebook({
  sessionId,
  artifact,
  initialSpawn,
  onSpawnConsumed,
  initialFocusCellId,
  onFocusCellConsumed,
}: Props) {
  // Defensive normalisation — a pre-v5 persisted payload (rehydrated on a
  // build where migrate didn't run) is missing `cells`. Treat those fields
  // as their empty defaults so the UI degrades gracefully rather than
  // crashing on `.cells.map(...)`.
  const rawPayload = artifact.payload
  const payload: ComputeProPayload = useMemo(
    () => ({
      ...rawPayload,
      cells: rawPayload.cells ?? [],
      focusedCellId: rawPayload.focusedCellId ?? null,
    }),
    [rawPayload],
  )
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)

  // Drag-to-reorder state — which cell (if any) is currently being
  // dragged, and the sensor config. `activationConstraint.distance: 6`
  // makes short taps still register as click/focus, only longer drags
  // start a dnd operation — so clicking the drag handle to focus the
  // cell doesn't accidentally trigger a reorder.
  const [draggingCellId, setDraggingCellId] = useState<string | null>(null)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const [newCellMenuOpen, setNewCellMenuOpen] = useState(false)
  // Controls the lightweight "Add Structure" modal. Triggered from any
  // of the "+" menus' Structure entries. No cell is created — the
  // modal builds a standalone StructureArtifact via buildStructureDirect.
  const [addStructureOpen, setAddStructureOpen] = useState(false)
  const handleNotebookAction = useCallback(
    (actionId: 'add-structure') => {
      if (actionId === 'add-structure') setAddStructureOpen(true)
    },
    [],
  )
  // Ref the wrapping <div> (button + menu together) rather than the button
  // alone so the outside-click detector doesn't fire when the user clicks
  // INSIDE the open menu — mousedown hits the menu item before its
  // React onClick can fire, and a button-only ref would close the menu
  // before the pick was delivered.
  const newCellWrapRef = useRef<HTMLDivElement | null>(null)
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const runMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const session = useRuntimeStore(selectActiveSession)
  const askDockRef = useRef<ComputeAskDockHandle | null>(null)

  const runner = useComputeRunner(sessionId, artifact, {
    onFinished: (_cellId, run, success) => {
      if (success) toast.success(`Done in ${run.durationMs ?? 0} ms`)
      else toast.error(run.error ?? 'Execution failed')
    },
    onError: (_cellId, msg) => toast.error(msg),
  })

  const patch = useCallback(
    (next: Partial<ComputeProPayload>) => {
      // CRITICAL: read the *latest* payload from the store at call time,
      // not the closure-captured render-time snapshot. The health-poll
      // interval and other long-lived callbacks close over `patch` once
      // at mount; if this function spread a stale `payload`, every
      // `patch({health: ...})` tick would silently erase any cell
      // updates the runner had written since mount (classic
      // "structure disappeared after 30s" bug — see
      // writeCellRun in useComputeRunner.ts which correctly uses
      // useRuntimeStore.getState()).
      const fresh = useRuntimeStore.getState().sessions[sessionId]?.artifacts[
        artifact.id
      ]
      const currentPayload =
        fresh?.kind === 'compute-pro'
          ? (fresh.payload as ComputeProPayload)
          : payload
      patchArtifact(sessionId, artifact.id, {
        payload: { ...currentPayload, ...next } satisfies ComputeProPayload,
      })
    },
    // `payload` intentionally omitted — we read it fresh inside.
    // Keeping it would recreate `patch` on every cell tick and
    // invalidate the setInterval callback, which closes over the first
    // patch reference by design (empty-deps effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patchArtifact, sessionId, artifact.id],
  )

  // Poll container health every 30 s; mount-kick once.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const h = await localProCompute.computeHealth()
        if (cancelled) return
        patch({
          health: {
            containerUp: h.container_up,
            pythonVersion: h.python_version ?? null,
            lammpsAvailable: h.lammps_available,
            cp2kAvailable: h.cp2k_available,
            packages: h.packages,
            error: h.error ?? null,
            checkedAt: Date.now(),
          },
        })
      } catch {
        // silent
      }
    }
    void check()
    const t = window.setInterval(check, HEALTH_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * One-shot consumption of `initialSpawn` — e.g. Structure → Simulate ▾
   * dispatched a spawn while the overlay was closed. We guard by
   * artifact.id so the effect only fires once the compute-pro artifact
   * is resolved (first-time opens auto-create it and the effect needs
   * to wait for the next render).
   */
  useEffect(() => {
    if (!initialSpawn) return
    const cell = buildNewCell(initialSpawn.kind, initialSpawn.code)
    if (initialSpawn.title) cell.title = initialSpawn.title
    if (initialSpawn.provenance) {
      cell.provenance = { ...(cell.provenance ?? {}), ...initialSpawn.provenance }
    }
    patch({
      cells: [...payload.cells, cell],
      focusedCellId: cell.id,
    })
    onSpawnConsumed?.()
    // We intentionally depend only on the spawn identity (reference) so
    // re-renders don't re-apply the same spawn; the parent clears the
    // prop via `onSpawnConsumed` immediately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSpawn, artifact.id])

  /** One-shot focusCellId consumption for StructureCard "Used in" jumps. */
  useEffect(() => {
    if (!initialFocusCellId) return
    // Only if the cell actually exists in this artifact; silently ignore
    // stale ids from a different compute-pro workbench.
    if (payload.cells.some((c) => c.id === initialFocusCellId)) {
      patch({ focusedCellId: initialFocusCellId })
    }
    onFocusCellConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusCellId, artifact.id])

  /** "Target this cell in the Ask AI dock and focus its input". Wired
   *  both to the per-cell Sparkles (via the overflow menu in a later
   *  phase) and to the ⌘K shortcut below. */
  const focusAskDock = useCallback(
    (cellContext: ComputeCell | null = null) => {
      if (cellContext && cellContext.id !== payload.focusedCellId) {
        patch({ focusedCellId: cellContext.id })
      }
      // Defer focus by one tick so the patch settles before DOM focus
      // moves to the dock textarea.
      window.setTimeout(() => askDockRef.current?.focus(), 0)
    },
    [patch, payload.focusedCellId],
  )

  /** Move a cell one slot up or down in the stream. Used by keyboard
   *  (Ctrl+Shift+↑/↓) and the drag-to-reorder handle. Clamps at the
   *  ends so repeat presses at slot 0 / slot N-1 are no-ops. */
  const handleMoveCell = useCallback(
    (cellId: string, direction: -1 | 1) => {
      const cells = payload.cells
      const idx = cells.findIndex((c) => c.id === cellId)
      if (idx < 0) return
      const target = idx + direction
      if (target < 0 || target >= cells.length) return
      const next = cells.slice()
      const [moved] = next.splice(idx, 1)
      next.splice(target, 0, moved)
      patch({ cells: next })
    },
    [payload.cells, patch],
  )

  /** Wipe every cell's `lastRun` + reset its executionCount without
   *  deleting the cells themselves — Jupyter's "Clear all outputs"
   *  equivalent. Useful before re-running a whole notebook cleanly. */
  const handleClearAllOutputs = useCallback(() => {
    if (payload.cells.length === 0) return
    const nextCells = payload.cells.map((c) => ({
      ...c,
      lastRun: null,
      executionCount: 0,
      updatedAt: Date.now(),
    }))
    patch({ cells: nextCells })
    toast.success('Cleared all outputs')
  }, [payload.cells, patch])

  /** Flip one of the per-cell collapse flags (`collapsedInput` or
   *  `collapsedOutput`) — chevron toggle in the cell header. */
  const handleToggleCollapse = useCallback(
    (cellId: string, pane: 'input' | 'output') => {
      const nextCells = payload.cells.map((c) => {
        if (c.id !== cellId) return c
        if (pane === 'input') {
          return { ...c, collapsedInput: !c.collapsedInput, updatedAt: Date.now() }
        }
        return { ...c, collapsedOutput: !c.collapsedOutput, updatedAt: Date.now() }
      })
      patch({ cells: nextCells })
    },
    [payload.cells, patch],
  )

  // Jupyter-ish keyboard model:
  //   Cmd/Ctrl+K         → focus Ask AI dock (legacy)
  //   Shift+Enter        → Run focused cell + jump to next
  //   Cmd/Ctrl+Enter     → Run focused cell + stay
  //   Ctrl+Shift+↑/↓     → Move focused cell up / down
  //   Escape             → Blur currently-focused editor (returns focus
  //                        to the cell wrap so arrow-nav shortcuts work)
  //
  // IME guard on every branch — CJK input must never race against
  // these shortcuts while composing a candidate.
  //
  // The keydown handler is registered **once per mount**. Everything it
  // needs from the current render lives in `kbRef`, which is updated on
  // every render via useEffect. Without this indirection the listener
  // re-registers on every cell reorder / code keystroke (`payload.cells`
  // changes reference each time), producing avoidable add/remove churn
  // on `window`.
  const kbRef = useRef({
    cells: payload.cells,
    focusedCellId: payload.focusedCellId,
    runner,
    patch,
    focusAskDock,
    handleMoveCell,
  })
  useEffect(() => {
    kbRef.current = {
      cells: payload.cells,
      focusedCellId: payload.focusedCellId,
      runner,
      patch,
      focusAskDock,
      handleMoveCell,
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      const { cells, focusedCellId, runner, patch, focusAskDock, handleMoveCell } =
        kbRef.current
      const mod = e.metaKey || e.ctrlKey

      // Cmd+K / Ctrl+K → Ask AI dock focus (legacy behaviour).
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        const focused = focusedCellId
          ? cells.find((c) => c.id === focusedCellId) ?? null
          : null
        focusAskDock(focused)
        return
      }

      // All remaining shortcuts require a focused cell.
      if (!focusedCellId) return
      const focusedIdx = cells.findIndex((c) => c.id === focusedCellId)
      if (focusedIdx < 0) return

      // Run shortcuts — Shift+Enter (run + advance) or Cmd/Ctrl+Enter
      // (run + stay). Both must swallow the event so CodeMirror doesn't
      // also insert a newline.
      if (e.key === 'Enter') {
        const wantsRun = e.shiftKey || mod
        if (!wantsRun) return
        e.preventDefault()
        void runner.run(focusedCellId)
        if (e.shiftKey) {
          const next = cells[focusedIdx + 1]
          if (next) patch({ focusedCellId: next.id })
        }
        return
      }

      // Ctrl+Shift+↑ / ↓ — move cell within the stream.
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          handleMoveCell(focusedCellId, -1)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          handleMoveCell(focusedCellId, 1)
          return
        }
      }

      // Escape — blur whatever has focus inside the cell so subsequent
      // keys can fire cell-level shortcuts cleanly. Not preventDefault —
      // some child components (composer) may want to handle Escape too.
      if (e.key === 'Escape') {
        const active = document.activeElement as HTMLElement | null
        if (active && active.tagName !== 'BODY') active.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useOutsideClickDismiss(newCellWrapRef, newCellMenuOpen, () =>
    setNewCellMenuOpen(false),
  )

  const handleAddCell = useCallback(
    (kind: ComputeCellKind, initialCode?: string) => {
      const cell = buildNewCell(kind, initialCode)
      patch({
        cells: [...payload.cells, cell],
        focusedCellId: cell.id,
      })
      return cell
    },
    [patch, payload.cells],
  )

  /** Insert a new cell at `index` (0 = before first cell, length = end).
   *  Shares the `buildNewCell` factory with `handleAddCell`; the only
   *  difference is the slice position. Invoked from `CellInsertGap`. */
  const handleInsertCellAt = useCallback(
    (index: number, kind: ComputeCellKind, initialCode?: string) => {
      const cell = buildNewCell(kind, initialCode)
      const safeIdx = Math.max(0, Math.min(index, payload.cells.length))
      const nextCells = [
        ...payload.cells.slice(0, safeIdx),
        cell,
        ...payload.cells.slice(safeIdx),
      ]
      patch({ cells: nextCells, focusedCellId: cell.id })
      return cell
    },
    [patch, payload.cells],
  )

  const handleDeleteCell = useCallback(
    (cellId: string) => {
      const nextCells = payload.cells.filter((c) => c.id !== cellId)
      const nextFocus =
        payload.focusedCellId === cellId
          ? nextCells[nextCells.length - 1]?.id ?? null
          : payload.focusedCellId
      patch({ cells: nextCells, focusedCellId: nextFocus })
    },
    [patch, payload.cells, payload.focusedCellId],
  )

  const handleDuplicateCell = useCallback(
    (cellId: string) => {
      const src = payload.cells.find((c) => c.id === cellId)
      if (!src) return
      const now = Date.now()
      const copy: ComputeCell = {
        ...src,
        id: newCellId(),
        // A duplicated cell starts without a run — the user re-runs to see
        // whether their tweak changes the output.
        lastRun: null,
        createdAt: now,
        updatedAt: now,
      }
      const idx = payload.cells.findIndex((c) => c.id === cellId)
      const nextCells = [
        ...payload.cells.slice(0, idx + 1),
        copy,
        ...payload.cells.slice(idx + 1),
      ]
      patch({ cells: nextCells, focusedCellId: copy.id })
    },
    [patch, payload.cells],
  )

  const handleCellCodeChange = useCallback(
    (cellId: string, code: string) => {
      const target = payload.cells.find((c) => c.id === cellId)
      if (!target || target.code === code) return
      const nextCells = payload.cells.map((c) =>
        c.id === cellId ? { ...c, code, updatedAt: Date.now() } : c,
      )
      patch({ cells: nextCells })
    },
    [patch, payload.cells],
  )

  const handleFocusCell = useCallback(
    (cellId: string) => {
      if (payload.focusedCellId === cellId) return
      patch({ focusedCellId: cellId })
    },
    [patch, payload.focusedCellId],
  )

  const handleRunCell = useCallback(
    (cellId: string) => {
      void runner.run(cellId)
    },
    [runner],
  )

  /** Persist a pane-height override after the user drops a resize handle.
   *  Writes to `cell.paneHeights[<pane>]` — absent fields fall back to
   *  CSS defaults (editor 180 / viewer 360 / console 360). */
  const handlePaneHeightChange = useCallback(
    (cellId: string, pane: 'editor' | 'viewer' | 'console', height: number) => {
      // Drop no-op drops — the resize handle commits on mouseup, which
      // fires even when the user released at the same height they
      // started at. Without this guard a pure click on the handle
      // patches the entire `cells` array.
      const target = payload.cells.find((c) => c.id === cellId)
      if (target && target.paneHeights?.[pane] === height) return
      const nextCells = payload.cells.map((c) => {
        if (c.id !== cellId) return c
        return {
          ...c,
          paneHeights: {
            ...(c.paneHeights ?? {}),
            [pane]: height,
          },
          updatedAt: Date.now(),
        }
      })
      patch({ cells: nextCells })
    },
    [patch, payload.cells],
  )

  const handleAskDockApply = useCallback(
    (apply: CmdKApply) => {
      if (apply.kind === 'replace-focused' && payload.focusedCellId) {
        // If the focused cell's kind doesn't match what the AI produced,
        // we also update kind (e.g. Python cell → AI returned LAMMPS;
        // keep the slot, change the kind so the editor highlighter fits).
        const nextCells = payload.cells.map((c) => {
          if (c.id !== payload.focusedCellId) return c
          return {
            ...c,
            kind: apply.cellKind,
            code: apply.code,
            updatedAt: Date.now(),
          }
        })
        patch({ cells: nextCells })
        toast.success('AI output applied to focused cell')
        return
      }
      handleAddCell(apply.cellKind, apply.code)
      toast.success(`Created ${apply.cellKind} cell from AI`)
    },
    [payload.focusedCellId, payload.cells, patch, handleAddCell],
  )

  /** Rail insertion — a structure is being dropped into `cellId`. Code
   *  cells get `load_structure('<key>')`; AI cells get `@struct-<key>`
   *  tokens that the runner later resolves to full CIF context. */
  const handleInsertStructureReference = useCallback(
    (cellId: string, row: StructureRow) => {
      const target = payload.cells.find((c) => c.id === cellId)
      if (!target) return
      const token =
        target.kind === 'python' || target.kind === 'structure-code' || target.kind === 'lammps' || target.kind === 'cp2k'
          ? `load_structure('${row.key}')`
          : `@struct-${row.key}`
      const next = target.code
        ? `${target.code.replace(/\s*$/, '')}\n${token}\n`
        : `${token}\n`
      const nextCells = payload.cells.map((c) =>
        c.id === cellId ? { ...c, code: next, updatedAt: Date.now() } : c,
      )
      patch({ cells: nextCells })
    },
    [payload.cells, patch],
  )

  /**
   * "Save structure" — creates (or refocuses) a top-level `structure`
   * artifact from a structure-* cell's CIF and stamps back-links both
   * ways: the artifact carries `computedFromArtifactId` +
   * `computedFromCellId`, and the cell's `provenance.savedStructureId`
   * is set so a second click flips to "Open saved" (idempotent).
   */
  const handleSaveStructure = useCallback(
    async (cellId: string, name: string): Promise<string | null> => {
      const cell = payload.cells.find((c) => c.id === cellId)
      if (!cell) return null
      // Already saved → just focus the existing artifact. The Save CTA
      // shouldn't have fired this path, but be defensive.
      const existing = cell.provenance?.savedStructureId
      if (existing) {
        useRuntimeStore.getState().focusArtifact(sessionId, existing)
        return existing
      }
      const cif = cell.lastRun?.stdout ?? ''
      if (!cif.trim().startsWith('data_')) {
        toast.error('Cell has no parseable CIF to save.')
        return null
      }
      let parsed
      try {
        parsed = parseCif(cif)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        return null
      }
      if (parsed.sites.length === 0) {
        toast.error('CIF has no atomic sites — skipping save.')
        return null
      }
      const structureId = genArtifactId()
      const structurePayload: StructureArtifactPayload = {
        cif,
        formula: computeFormula(parsed.sites),
        spaceGroup: parsed.spaceGroup ?? 'P1',
        latticeParams: computeLatticeParams(parsed),
        transforms: [],
        computedFromArtifactId: artifact.id,
        computedFromCellId: cell.id,
      }
      const structureArtifact: StructureArtifact = {
        id: structureId,
        kind: 'structure',
        title: name || structurePayload.formula || 'structure',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        payload: structurePayload,
      }
      const store = useRuntimeStore.getState()
      store.upsertArtifact(sessionId, structureArtifact)
      // Stamp the cell's provenance so the CTA flips to "Open saved" and
      // a re-click is a focus, not a duplicate save.
      const nextCells = payload.cells.map((c) =>
        c.id === cellId
          ? {
              ...c,
              provenance: {
                ...(c.provenance ?? {}),
                savedStructureId: structureId,
              },
              updatedAt: Date.now(),
            }
          : c,
      )
      patch({ cells: nextCells })
      store.focusArtifact(sessionId, structureId)
      toast.success(`Saved ${structureArtifact.title}`)
      return structureId
    },
    [payload.cells, sessionId, artifact.id, patch],
  )

  const handleJumpToStructure = useCallback(
    (structureId: string) => {
      // Jump back to the editor area's structure card. We close the
      // compute overlay bus so App.tsx flips its open state, then focus
      // the artifact so the editor tab picks it up.
      useRuntimeStore.getState().focusArtifact(sessionId, structureId)
      // The dispatcher that OPENED the overlay used compute-overlay-bus;
      // here we just focus the artifact. App.tsx's CreatorOverlay / main
      // editor picks it up. The overlay stays open; the user can still
      // Cmd+Click × to close. (Auto-closing feels abrupt.)
    },
    [sessionId],
  )

  /** Single dispatcher for all four Tweak kinds — routes to the right
   *  builder, then inserts the produced `structure-code` cell directly
   *  after the parent. Used by the 4-tab Tweak popover. */
  const handleTweakApply = useCallback(
    (parentCellId: string, args: TweakApplyArgs) => {
      const parentIdx = payload.cells.findIndex((c) => c.id === parentCellId)
      if (parentIdx < 0) return
      let tweak: TweakResult
      switch (args.kind) {
        case 'supercell':
          tweak = buildSupercellTweak(parentCellId, args.params)
          break
        case 'dope':
          tweak = buildDopeTweak(parentCellId, args.params)
          break
        case 'surface':
          tweak = buildSurfaceTweak(parentCellId, args.params)
          break
        case 'vacancy':
          tweak = buildVacancyTweak(parentCellId, args.params)
          break
      }
      const now = Date.now()
      const newId = newCellId()
      const newCell: ComputeCell = {
        id: newId,
        kind: 'structure-code',
        title: tweak.title,
        code: tweak.code,
        lastRun: null,
        provenance: tweak.provenance,
        createdAt: now,
        updatedAt: now,
      }
      const nextCells = [
        ...payload.cells.slice(0, parentIdx + 1),
        newCell,
        ...payload.cells.slice(parentIdx + 1),
      ]
      patch({ cells: nextCells, focusedCellId: newId })
      toast.success(`Created ${tweak.title} cell`)
    },
    [payload.cells, patch],
  )

  /** Structure-cell Export ▾ handler:
   *   - 'cif'    → download the last build's CIF as a `.cif` file
   *   - 'lammps' → spawn a structure-code Python cell that ASE-writes a
   *                LAMMPS data file and runs `lmp`
   *   - 'cp2k'   → spawn a native `cp2k` cell with a complete .inp
   *                (cell vectors + coords inlined, default PBE/DZVP).
   * Requires the parent cell to have produced a parseable CIF in
   * `lastRun.stdout` — the caller already gates on `canTweak`. */
  const handleExportAction = useCallback(
    (parentCellId: string, kind: 'cif' | 'lammps' | 'cp2k') => {
      const parent = payload.cells.find((c) => c.id === parentCellId)
      if (!parent) return
      const cifText = parent.lastRun?.stdout?.trim() ?? ''
      if (!cifText.startsWith('data_')) {
        toast.error('No CIF available — build the structure first.')
        return
      }
      let parsed: ReturnType<typeof parseCif>
      try {
        parsed = parseCif(cifText)
      } catch (err) {
        toast.error(
          `CIF parse failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        return
      }
      const formula = parent.title?.trim() || computeFormula(parsed.sites) || 'structure'
      const slug = slugForCifKey(parent.title || formula || parent.id)

      if (kind === 'cif') {
        downloadTextFile(`${slug}.cif`, cifText, 'chemical/x-cif')
        toast.success(`Saved ${slug}.cif`)
        return
      }

      const template =
        kind === 'lammps'
          ? buildLammpsExportCell({ slug, formula, parsedCif: parsed })
          : buildCp2kExportCell({ slug, formula, parsedCif: parsed })

      const parentIdx = payload.cells.findIndex((c) => c.id === parentCellId)
      const now = Date.now()
      const newId = newCellId()
      const newCell: ComputeCell = {
        id: newId,
        kind: template.cellKind,
        title: template.title,
        code: template.code,
        lastRun: null,
        provenance: template.provenance,
        createdAt: now,
        updatedAt: now,
      }
      const insertAt = parentIdx < 0 ? payload.cells.length : parentIdx + 1
      const nextCells = [
        ...payload.cells.slice(0, insertAt),
        newCell,
        ...payload.cells.slice(insertAt),
      ]
      patch({ cells: nextCells, focusedCellId: newId })
      toast.success(`Created ${template.title} cell`)
    },
    [payload.cells, patch],
  )

  /** Rail insertion — a file is being dropped into `cellId`. Code cells
   *  get a path literal; AI cells get a descriptive token. */
  const handleInsertFileReference = useCallback(
    (cellId: string, row: FileRow) => {
      const target = payload.cells.find((c) => c.id === cellId)
      if (!target) return
      const token =
        target.kind === 'python' || target.kind === 'structure-code' || target.kind === 'lammps' || target.kind === 'cp2k'
          ? `# workspace file: ${row.relPath}\nwith open('${row.relPath}') as _f:\n    _data = _f.read()`
          : `@file:${row.relPath}`
      const next = target.code
        ? `${target.code.replace(/\s*$/, '')}\n${token}\n`
        : `${token}\n`
      const nextCells = payload.cells.map((c) =>
        c.id === cellId ? { ...c, code: next, updatedAt: Date.now() } : c,
      )
      patch({ cells: nextCells })
    },
    [payload.cells, patch],
  )

  /** "Load into cell": read the file content off disk and spawn a new
   *  cell whose code is pre-filled. Kind is chosen from the extension:
   *  `.cif` → structure-code parsing stub, `.py` → python w/ the file
   *  content inlined, `.lmp`/`.in` → lammps, other text → python with
   *  the content pasted as a raw string. On error we toast + bail. */
  const handleLoadFileIntoCell = useCallback(
    async (row: FileRow) => {
      const root = payload.computeWorkspacePath
      if (!root) {
        toast.error('No compute folder picked.')
        return
      }
      const electron = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (!electron?.computeReadFileAt) {
        toast.error('File read IPC unavailable — restart the desktop app.')
        return
      }
      const res = await electron.computeReadFileAt(root, row.relPath)
      if (!res.ok) {
        toast.error(`Load failed: ${res.error}`)
        return
      }
      const { content } = res
      const ext = row.name.split('.').pop()?.toLowerCase() ?? ''
      let kind: ComputeCellKind = 'python'
      let code: string
      let title: string
      if (ext === 'cif') {
        kind = 'structure-code'
        title = `CIF · ${row.name}`
        code = [
          `# Loaded from ${row.relPath}`,
          'from pymatgen.io.cif import CifParser',
          'from io import StringIO',
          '',
          'cif_text = """',
          content.replace(/"""/g, '\\"\\"\\"'),
          '"""',
          '',
          'parser = CifParser.from_str(cif_text)',
          's = parser.parse_structures(primitive=False)[0]',
          'print(s.composition.reduced_formula, len(s), "sites")',
          'print(s.to(fmt="cif"))',
        ].join('\n')
      } else if (ext === 'lmp' || ext === 'in') {
        kind = 'lammps'
        title = row.name
        code = content
      } else if (ext === 'cp2k' || ext === 'inp') {
        kind = 'cp2k'
        title = row.name
        code = content
      } else if (ext === 'py') {
        kind = 'python'
        title = row.name
        code = `# Loaded from ${row.relPath}\n${content}`
      } else {
        kind = 'python'
        title = `Read · ${row.name}`
        code = [
          `# Raw content of ${row.relPath}`,
          `_src = """`,
          content.replace(/"""/g, '\\"\\"\\"'),
          `"""`,
          `print(_src[:200])`,
        ].join('\n')
      }
      const cell = buildNewCell(kind, code)
      cell.title = title
      patch({
        cells: [...payload.cells, cell],
        focusedCellId: cell.id,
      })
      toast.success(`Loaded ${row.name} into new cell`)
    },
    [payload.computeWorkspacePath, payload.cells, patch],
  )

  const healthDown = payload.health?.containerUp === false
  const healthTitle = useMemo(() => healthTooltip(payload.health), [payload.health])

  const focusedCell = useMemo(() => {
    if (!payload.focusedCellId) return null
    return payload.cells.find((c) => c.id === payload.focusedCellId) ?? null
  }, [payload.cells, payload.focusedCellId])

  /**
   * Sequential cell batch runner. Awaits each cell; stops at the first
   * failed run. Used by Run ▾ (all / above focused / below focused).
   * The inner `await runner.run()` works because `useComputeRunner.run`
   * returns the finished (or stub-cleared) run; failure is detected via
   * `exitCode !== 0 || error || timedOut` on the returned object.
   */
  const runBatch = useCallback(
    async (cellIds: string[]) => {
      if (cellIds.length === 0) return
      setIsBatchRunning(true)
      const startedAt = Date.now()
      let ran = 0
      try {
        for (const id of cellIds) {
          const result = await runner.run(id)
          ran++
          if (!result) break
          const failed =
            result.timedOut ||
            !!result.error ||
            (result.exitCode != null && result.exitCode !== 0)
          if (failed) {
            const target =
              payload.cells.find((c) => c.id === id)?.title ?? `cell ${id.slice(-6)}`
            toast.error(
              `Batch stopped at ${target}: ${result.error ?? `exit ${result.exitCode ?? '?'}`}`,
            )
            return
          }
        }
        if (ran > 0) {
          const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
          toast.success(`Ran ${ran} cell${ran === 1 ? '' : 's'} in ${secs}s`)
        }
      } finally {
        setIsBatchRunning(false)
      }
    },
    [runner, payload.cells],
  )

  return (
    <div className="compute-nb-root">
      <header className="compute-nb-topbar">
        <span
          className="compute-nb-status-dot"
          style={
            {
              '--dot-color': healthDotColor(payload.health?.containerUp),
            } as React.CSSProperties
          }
          title={healthTitle}
          aria-label={healthTitle}
        />
        <span className="compute-nb-topbar-title">Compute</span>
        <span className="compute-nb-topbar-health" title={healthTitle}>
          {healthTitle}
        </span>
        {healthDown && (
          <span
            className="compute-nb-banner-health-hint"
            title="Bundled conda env is not responding — try restarting the app or reinstalling"
          >
            check env
          </span>
        )}
        <span className="compute-nb-spacer" />
        <RunMenu
          wrapRef={runMenuWrapRef}
          open={runMenuOpen}
          onToggle={() => setRunMenuOpen((v) => !v)}
          onClose={() => setRunMenuOpen(false)}
          cells={payload.cells}
          focusedCellId={payload.focusedCellId}
          disabled={
            isBatchRunning ||
            runner.runningCellId != null ||
            payload.cells.length === 0
          }
          onRun={(ids) => {
            setRunMenuOpen(false)
            void runBatch(ids)
          }}
          onClearOutputs={handleClearAllOutputs}
        />
        <div className="compute-nb-newcell-wrap" ref={newCellWrapRef}>
          <button
            type="button"
            className="compute-nb-run-btn"
            onClick={() => setNewCellMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={newCellMenuOpen}
          >
            <Plus size={12} aria-hidden />
            New cell
            <ChevronDown size={11} aria-hidden />
          </button>
          {newCellMenuOpen && (
            <NewCellMenu
              onPick={(kind) => {
                handleAddCell(kind)
                setNewCellMenuOpen(false)
              }}
              onAction={(actionId) => {
                handleNotebookAction(actionId)
                setNewCellMenuOpen(false)
              }}
            />
          )}
        </div>
      </header>

      <div className="compute-nb-body">
        {session && (
          <ComputeAssetsRail
            session={session}
            artifact={artifact}
            focusedCellId={payload.focusedCellId}
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailCollapsed((v) => !v)}
            onInsertStructureReference={handleInsertStructureReference}
            onInsertFileReference={handleInsertFileReference}
            onLoadFileIntoCell={handleLoadFileIntoCell}
            onFocusCell={handleFocusCell}
            computeWorkspacePath={payload.computeWorkspacePath ?? null}
            onPickWorkspacePath={(abs) =>
              patch({ computeWorkspacePath: abs })
            }
          />
        )}
        <div className="compute-nb-main">
          <div className="compute-nb-stream" role="list">
            {payload.cells.length === 0 ? (
              <EmptyStream
                onCreate={handleAddCell}
                onAction={handleNotebookAction}
              />
            ) : (
              <>
                <CellInsertGap
                  onPick={(kind) => handleInsertCellAt(0, kind)}
                  onAction={handleNotebookAction}
                  disabled={isBatchRunning}
                />
                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragStart={(e) =>
                    setDraggingCellId(String(e.active.id))
                  }
                  onDragEnd={(e) => {
                    setDraggingCellId(null)
                    const { active, over } = e
                    if (!over || active.id === over.id) return
                    const oldIdx = payload.cells.findIndex(
                      (c) => c.id === active.id,
                    )
                    const newIdx = payload.cells.findIndex(
                      (c) => c.id === over.id,
                    )
                    if (oldIdx < 0 || newIdx < 0) return
                    patch({
                      cells: arrayMove(payload.cells, oldIdx, newIdx),
                    })
                  }}
                  onDragCancel={() => setDraggingCellId(null)}
                >
                  <SortableContext
                    items={payload.cells.map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {payload.cells.map((cell, i) => {
                      const canTweak =
                        (cell.kind === 'structure-ai' ||
                          cell.kind === 'structure-code') &&
                        cell.lastRun != null &&
                        cell.lastRun.exitCode === 0 &&
                        !cell.lastRun.error &&
                        (cell.lastRun.stdout ?? '').trim().startsWith('data_')
                      const isFocused = cell.id === payload.focusedCellId
                      return (
                        <SortableCellSlot key={cell.id} id={cell.id}>
                          {({ dragHandleProps, isDragging }) => (
                            <>
                              <ComputeCellView
                                cell={cell}
                                sessionId={sessionId}
                                isFocused={isFocused}
                                isRunning={runner.runningCellId === cell.id}
                                healthDown={healthDown}
                                onFocus={() => handleFocusCell(cell.id)}
                                onCodeChange={(code) =>
                                  handleCellCodeChange(cell.id, code)
                                }
                                onRun={() => handleRunCell(cell.id)}
                                onDuplicate={() => handleDuplicateCell(cell.id)}
                                onDelete={() => handleDeleteCell(cell.id)}
                                onAskAI={() => focusAskDock(cell)}
                                onTweakApply={
                                  canTweak
                                    ? (args) => handleTweakApply(cell.id, args)
                                    : undefined
                                }
                                onExportAction={
                                  canTweak
                                    ? (kind) =>
                                        handleExportAction(cell.id, kind)
                                    : undefined
                                }
                                onJumpToParent={handleFocusCell}
                                onJumpToStructure={handleJumpToStructure}
                                onSaveStructure={
                                  (cell.kind === 'structure-ai' ||
                                    cell.kind === 'structure-code') &&
                                  cell.lastRun != null
                                    ? (name) =>
                                        handleSaveStructure(cell.id, name)
                                    : undefined
                                }
                                onPaneHeightChange={(pane, h) =>
                                  handlePaneHeightChange(cell.id, pane, h)
                                }
                                onToggleCollapse={(pane) =>
                                  handleToggleCollapse(cell.id, pane)
                                }
                                dragHandleProps={dragHandleProps}
                                isDragging={isDragging}
                              />
                              {isFocused && (
                                <ComputeAskDock
                                  ref={askDockRef}
                                  sessionId={sessionId}
                                  targetCell={cell}
                                  parentBusy={isBatchRunning}
                                  onClearTarget={() =>
                                    patch({ focusedCellId: null })
                                  }
                                  onApply={handleAskDockApply}
                                  inline
                                />
                              )}
                              <CellInsertGap
                                onPick={(kind) =>
                                  handleInsertCellAt(i + 1, kind)
                                }
                                onAction={handleNotebookAction}
                                disabled={isBatchRunning}
                              />
                            </>
                          )}
                        </SortableCellSlot>
                      )
                    })}
                  </SortableContext>
                </DndContext>
                {/* draggingCellId sentinel: keep an eye on the dragging
                    state for debugging — useful when a cell "sticks" in
                    dragging UI after an unexpected abort. */}
                {draggingCellId && (
                  <span aria-hidden data-dragging={draggingCellId} />
                )}
                <StreamFootCreator
                  onCreate={handleAddCell}
                  onAction={handleNotebookAction}
                />
              </>
            )}
          </div>
        </div>
      </div>
      <AddStructureDialog
        open={addStructureOpen}
        onClose={() => setAddStructureOpen(false)}
      />
    </div>
  )
}

// ─── Factory helpers ─────────────────────────────────────────────────

function buildNewCell(
  kind: ComputeCellKind,
  initialCode?: string,
): ComputeCell {
  const now = Date.now()
  return {
    id: newCellId(),
    kind,
    code: initialCode ?? STARTER_CODE[kind] ?? '',
    lastRun: null,
    createdAt: now,
    updatedAt: now,
  }
}

