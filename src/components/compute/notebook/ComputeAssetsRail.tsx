// ComputeAssetsRail — left-side resource rail inside the Compute overlay.
//
// Shows three sections against the active session:
//   1. Structures — session StructureArtifacts + structure-* cells' last
//      successful build. Click inserts a reference into the focused cell
//      (Code cells get `load_structure('<key>')`; AI cells get `@struct-<key>`).
//   2. Files — session.files (.cif, .xy, .csv, etc). Click → kind-aware
//      insertion into the focused cell.
//   3. Cells — every cell in the current Compute workbench, quick-jump.
//
// Collapses to a 32px vertical strip with a chevron + "ASSETS" label so
// long cell streams can claim more horizontal real estate.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  Atom,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Folder,
  FolderOpen,
  LineChart,
  Link2,
} from 'lucide-react'
import { toast } from '../../../stores/toast-store'
import { copyText } from '../../../lib/clipboard-helper'
import type {
  ComputeCell,
  ComputeProArtifact,
  ComputeProRun,
  StructureArtifact,
} from '../../../types/artifact'
import type { Session } from '../../../types/session'
import {
  computeFormula,
  parseCif,
} from '../../../lib/cif'
import ContextMenu, { type ContextMenuItem } from '../../common/ContextMenu'

/** Shape returned by the `compute:list-dir-at` IPC. Mirrors the main
 *  workspace-root payload but the relPath is relative to the compute
 *  workbench's own chosen directory, not the global root. */
interface ComputeFsEntry {
  name: string
  relPath: string
  parentRel: string
  isDirectory: boolean
  size: number
  mtime: number
}

/** Normalised row shape so one renderer handles every section. */
interface StructureRow {
  key: string              // Stable id used in load_structure()/@struct-<key>
  label: string
  sub?: string
  source: 'artifact' | 'cell'
  sourceId: string         // artifact id or cell id
  formula?: string
  spaceGroup?: string
}

interface FileRow {
  relPath: string
  name: string
  kind: string
  /** Depth in the workspace tree for indentation (0 = root child). */
  depth: number
  /** True for directory entries — they render with a folder icon and
   *  are not clickable as references. */
  isDir: boolean
}

interface CellRow {
  id: string
  label: string
  kind: ComputeCell['kind']
  status: 'idle' | 'ok' | 'err' | 'running'
}

export interface ComputeAssetsRailProps {
  session: Session
  artifact: ComputeProArtifact
  focusedCellId: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onInsertStructureReference: (cellId: string, row: StructureRow) => void
  onInsertFileReference: (cellId: string, row: FileRow) => void
  /** Double-click / "Load into cell" action — reads the file off disk and
   *  spawns a new cell with its content pre-filled. Async because the
   *  parent does an IPC read; returned Promise ignored by the rail. */
  onLoadFileIntoCell: (row: FileRow) => void | Promise<void>
  onFocusCell: (cellId: string) => void
  /** The compute workbench's independent root path (payload.computeWorkspacePath).
   *  Null when unset — rail shows a hint to pick a folder. */
  computeWorkspacePath: string | null
  /** Dispatched when the user picks a new folder (or clears the current
   *  one). Parent patches `payload.computeWorkspacePath`; the global
   *  workspace-store is intentionally NOT touched so the main Explorer
   *  stays pointed wherever the user had it. */
  onPickWorkspacePath: (absPath: string | null) => void
}

export default function ComputeAssetsRail({
  session,
  artifact,
  focusedCellId,
  collapsed,
  onToggleCollapsed,
  onInsertStructureReference,
  onInsertFileReference,
  onLoadFileIntoCell,
  onFocusCell,
  computeWorkspacePath,
  onPickWorkspacePath,
}: ComputeAssetsRailProps) {
  const structures = useMemo(
    () => collectStructures(session, artifact),
    [session, artifact],
  )
  // Independent file listing — calls the `compute:list-dir-at` IPC with
  // the per-workbench `computeWorkspacePath`. Nothing here touches the
  // global workspace-store, so changing the Compute folder doesn't
  // ripple into the main Explorer.
  const [rawEntries, setRawEntries] = useState<ComputeFsEntry[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listing, setListing] = useState(false)
  useEffect(() => {
    const abs = computeWorkspacePath
    if (!abs) {
      setRawEntries([])
      setListError(null)
      return
    }
    const electron = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!electron?.computeListDirAt) {
      setListError('IPC unavailable — restart the desktop app.')
      return
    }
    let cancelled = false
    setListing(true)
    setListError(null)
    void (async () => {
      try {
        const res = await electron.computeListDirAt(abs)
        if (cancelled) return
        if (res.ok) {
          setRawEntries(res.entries)
        } else {
          setRawEntries([])
          setListError(res.error)
        }
      } catch (err) {
        if (cancelled) return
        setRawEntries([])
        setListError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setListing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [computeWorkspacePath])

  // Raw row list with depth/kind derived — kept for keys and the
  // "total files" count chip. Tree rendering below walks `byParent`
  // instead so only open branches appear.
  const allFiles = useMemo(() => flattenEntries(rawEntries), [rawEntries])
  const byParent = useMemo(() => {
    const map = new Map<string, FileRow[]>()
    for (const row of allFiles) {
      const arr = map.get(parentOf(row.relPath)) ?? []
      arr.push(row)
      map.set(parentOf(row.relPath), arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [allFiles])
  const rootFiles = byParent.get('') ?? []

  // Expanded-folder tracking — a Set of relPaths. A new folder picked
  // via `onPickWorkspacePath` collapses everything (there's nothing left
  // to keep open because the IDs change).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setExpanded(new Set())
  }, [computeWorkspacePath])

  const toggleExpanded = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }, [])

  // Context menu — stored as a small state blob with viewport coords.
  // Mirrors the workspace FileTree's pattern so the same `ContextMenu`
  // primitive works identically (portal-mounted, viewport-clamped).
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    target: FileRow | null
  } | null>(null)

  const handleCopyPath = useCallback(
    async (row: FileRow) => {
      const root = computeWorkspacePath
      if (!root) {
        toast.error('No compute folder picked.')
        return
      }
      const abs = joinAbs(root, row.relPath)
      const electron = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (electron?.computeCopyPathAt) {
        const res = await electron.computeCopyPathAt(abs)
        if (res.ok) {
          toast.success('Path copied')
          return
        }
        toast.error(res.error ?? 'Copy path failed')
        return
      }
      await copyText(abs, 'Path copied')
    },
    [computeWorkspacePath],
  )

  const handleReveal = useCallback(
    async (row: FileRow) => {
      const root = computeWorkspacePath
      if (!root) return
      const abs = joinAbs(root, row.relPath)
      const electron = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (!electron?.computeRevealAt) {
        toast.info('Reveal is only available in the desktop app.')
        return
      }
      const res = await electron.computeRevealAt(abs)
      if (!res.ok) toast.error(res.error ?? 'Reveal failed')
    },
    [computeWorkspacePath],
  )

  const cellRows = useMemo(() => collectCells(artifact), [artifact])

  const handlePickFolder = useCallback(async () => {
    const electron = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!electron?.openDirectory) {
      toast.error('Directory picker unavailable — restart the desktop app.')
      return
    }
    try {
      const next = await electron.openDirectory()
      if (!next) return
      onPickWorkspacePath(next)
      toast.success(`Compute folder → ${shortPath(next)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [onPickWorkspacePath])

  const handleClearFolder = useCallback(() => {
    onPickWorkspacePath(null)
  }, [onPickWorkspacePath])

  if (collapsed) {
    return (
      <aside className="compute-nb-assets is-collapsed" aria-label="Compute assets">
        <button
          type="button"
          className="compute-nb-assets-peek"
          onClick={onToggleCollapsed}
          title="Expand assets"
          aria-label="Expand assets"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
        <span className="compute-nb-assets-peek-label">Assets</span>
        {(structures.length > 0 || allFiles.length > 0) && (
          <span className="compute-nb-assets-peek-count">
            {structures.length + allFiles.length}
          </span>
        )}
      </aside>
    )
  }

  const handleInsertStructure = (row: StructureRow) => {
    if (!focusedCellId) return
    onInsertStructureReference(focusedCellId, row)
  }
  const handleInsertFile = (row: FileRow) => {
    if (!focusedCellId) return
    onInsertFileReference(focusedCellId, row)
  }

  // Build the menu items for the right-clicked row. The renderer lives
  // inside the main render block (below) — here we only compute the
  // array as a memoized helper so the portal doesn't rebuild on every
  // hover. Signature matches the one used by the workspace FileTree.
  const buildFileMenuItems = (row: FileRow | null): ContextMenuItem[] => {
    const electron = typeof window !== 'undefined' && window.electronAPI
    const items: ContextMenuItem[] = []
    if (!row) return items
    if (!row.isDir) {
      items.push({
        label: 'Load into cell',
        icon: <Download size={13} />,
        onClick: () => void onLoadFileIntoCell(row),
      })
      items.push({
        label: focusedCellId ? 'Insert reference' : 'Insert reference (pick a cell)',
        icon: <Link2 size={13} />,
        disabled: !focusedCellId,
        onClick: () => handleInsertFile(row),
      })
    }
    items.push({
      label: 'Copy Path',
      icon: <Clipboard size={13} />,
      onClick: () => void handleCopyPath(row),
    })
    if (electron) {
      items.push({
        label: 'Reveal in Folder',
        icon: <ExternalLink size={13} />,
        onClick: () => void handleReveal(row),
      })
    }
    return items
  }

  // Flattened render list respecting the expanded-set. Walks byParent
  // recursively; only visits a folder's children if it's expanded. The
  // resulting array drives one <AssetRow> per node, so keyboard nav
  // and the existing virtualization-free flat rendering stay simple.
  const visibleFileNodes: FileRow[] = []
  const walk = (rows: FileRow[]) => {
    for (const row of rows) {
      visibleFileNodes.push(row)
      if (row.isDir && expanded.has(row.relPath)) {
        const kids = byParent.get(row.relPath) ?? []
        walk(kids)
      }
    }
  }
  walk(rootFiles)

  return (
    <aside className="compute-nb-assets" aria-label="Compute assets">
      <header className="compute-nb-assets-head">
        <span className="compute-nb-assets-title">Assets</span>
        <span className="compute-nb-spacer" />
        <button
          type="button"
          className="session-mini-btn"
          onClick={onToggleCollapsed}
          title="Collapse assets"
          aria-label="Collapse assets"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
      </header>

      <Section title="Structures" count={structures.length}>
        {structures.length === 0 ? (
          <div className="compute-nb-assets-empty">No structures</div>
        ) : (
          structures.map((row) => (
            <AssetRow
              key={`s-${row.sourceId}`}
              icon={<Atom size={12} strokeWidth={1.6} aria-hidden />}
              label={row.label}
              sub={row.sub}
              onClick={() => handleInsertStructure(row)}
              disabled={!focusedCellId}
              title={
                focusedCellId
                  ? `Insert reference into focused cell`
                  : 'Pick a cell first to receive the reference'
              }
            />
          ))
        )}
      </Section>

      <Section
        title="Files"
        count={allFiles.filter((r) => !r.isDir).length}
        headerRight={
          <div className="compute-nb-assets-section-actions">
            <button
              type="button"
              className="compute-nb-assets-section-action"
              onClick={() => void handlePickFolder()}
              title={
                computeWorkspacePath
                  ? `Current: ${computeWorkspacePath} — click to change`
                  : 'Pick a folder for the Compute workbench (independent of the main Explorer)'
              }
            >
              <FolderOpen size={11} aria-hidden />
              {computeWorkspacePath
                ? shortPath(computeWorkspacePath)
                : 'Pick folder'}
            </button>
            {computeWorkspacePath && (
              <button
                type="button"
                className="compute-nb-assets-section-action"
                onClick={handleClearFolder}
                title="Clear — the Files list becomes empty until you pick a folder"
                aria-label="Clear compute folder"
              >
                ✕
              </button>
            )}
          </div>
        }
      >
        {listing ? (
          <div className="compute-nb-assets-empty">Loading…</div>
        ) : listError ? (
          <div className="compute-nb-assets-empty is-err">{listError}</div>
        ) : !computeWorkspacePath ? (
          <div className="compute-nb-assets-empty">Pick a folder above.</div>
        ) : allFiles.length === 0 ? (
          <div className="compute-nb-assets-empty">Empty folder</div>
        ) : (
          visibleFileNodes.map((row) => (
            <FileTreeRow
              key={`f-${row.relPath}`}
              row={row}
              isExpanded={expanded.has(row.relPath)}
              onToggleExpand={() => toggleExpanded(row.relPath)}
              onDoubleClick={() => {
                if (row.isDir) toggleExpanded(row.relPath)
                else void onLoadFileIntoCell(row)
              }}
              onSingleClick={() => {
                if (row.isDir) toggleExpanded(row.relPath)
                else handleInsertFile(row)
              }}
              onContextMenu={(x, y) =>
                setContextMenu({ x, y, target: row })
              }
              canInsert={!!focusedCellId}
            />
          ))
        )}
      </Section>

      <Section title="Cells" count={cellRows.length}>
        {cellRows.length === 0 ? (
          <div className="compute-nb-assets-empty">No cells yet.</div>
        ) : (
          cellRows.map((row, i) => (
            <AssetRow
              key={`c-${row.id}`}
              icon={<span className={`compute-nb-assets-cell-idx`}>#{i + 1}</span>}
              label={row.label || row.kind}
              sub={row.kind}
              rightTone={statusTone(row.status)}
              onClick={() => onFocusCell(row.id)}
              disabled={false}
              active={row.id === focusedCellId}
              title="Focus this cell"
            />
          ))
        )}
      </Section>

      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={buildFileMenuItems(contextMenu?.target ?? null)}
        onClose={() => setContextMenu(null)}
      />
    </aside>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────

function Section({
  title,
  count,
  children,
  headerRight,
}: {
  title: string
  count: number
  children: React.ReactNode
  /** Optional trailing action (e.g. Files' "Pick folder" button). */
  headerRight?: React.ReactNode
}) {
  return (
    <section className="compute-nb-assets-section">
      <div className="compute-nb-assets-section-head">
        <span className="compute-nb-assets-section-title">{title}</span>
        <span className="compute-nb-assets-section-count">{count}</span>
        {headerRight}
      </div>
      <div className="compute-nb-assets-section-body">{children}</div>
    </section>
  )
}

function FileTreeRow({
  row,
  isExpanded,
  onToggleExpand,
  onDoubleClick,
  onSingleClick,
  onContextMenu,
  canInsert,
}: {
  row: FileRow
  isExpanded: boolean
  onToggleExpand: () => void
  onDoubleClick: () => void
  onSingleClick: () => void
  onContextMenu: (x: number, y: number) => void
  canInsert: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const pad = 8 + row.depth * 10
  return (
    <div
      className={
        'compute-nb-assets-row compute-nb-assets-tree-row' +
        (hovered ? ' is-hover' : '')
      }
      style={{ paddingLeft: pad }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e.clientX, e.clientY)
      }}
      role="button"
      tabIndex={0}
      title={
        row.isDir
          ? isExpanded
            ? 'Collapse folder'
            : 'Expand folder'
          : canInsert
            ? 'Double-click: load into new cell · Single-click: insert reference · Right-click for more'
            : 'Double-click: load into new cell · Right-click for more (pick a cell to use Insert reference)'
      }
    >
      {row.isDir ? (
        <span
          className="compute-nb-assets-tree-chevron"
          aria-hidden
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
        >
          {isExpanded ? (
            <ChevronDown size={11} strokeWidth={1.8} />
          ) : (
            <ChevronRight size={11} strokeWidth={1.8} />
          )}
        </span>
      ) : (
        <span className="compute-nb-assets-tree-chevron compute-nb-assets-tree-chevron--leaf" aria-hidden />
      )}
      <span className="compute-nb-assets-row-icon">
        {row.isDir ? (
          <Folder size={12} strokeWidth={1.6} aria-hidden />
        ) : (
          fileIcon(row.kind)
        )}
      </span>
      <span className="compute-nb-assets-row-label">{row.name}</span>
      {!row.isDir && (
        <span className="compute-nb-assets-row-sub">{row.kind}</span>
      )}
    </div>
  )
}

function AssetRow({
  icon,
  label,
  sub,
  depth = 0,
  onClick,
  disabled,
  active,
  rightTone,
  title,
}: {
  icon: React.ReactNode
  label: string
  sub?: string
  /** Tree indent step — 0 for flat rows, >0 for nested file-tree entries. */
  depth?: number
  onClick: () => void
  disabled?: boolean
  active?: boolean
  rightTone?: 'ok' | 'err' | 'running' | 'idle'
  title?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      className={
        'compute-nb-assets-row' +
        (active ? ' is-active' : '') +
        (hovered ? ' is-hover' : '')
      }
      style={{ paddingLeft: 8 + depth * 10 }}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
    >
      <span className="compute-nb-assets-row-icon">{icon}</span>
      <span className="compute-nb-assets-row-label">{label}</span>
      {sub && <span className="compute-nb-assets-row-sub">{sub}</span>}
      {rightTone && (
        <span className={`compute-nb-assets-row-dot is-${rightTone}`} aria-hidden />
      )}
    </button>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function collectStructures(
  session: Session,
  computeArtifact: ComputeProArtifact,
): StructureRow[] {
  const rows: StructureRow[] = []

  // 1. Standalone StructureArtifacts in session
  for (const id of session.artifactOrder) {
    const a = session.artifacts[id]
    if (!a || a.kind !== 'structure') continue
    const payload = (a as StructureArtifact).payload
    const formula = payload.formula || 'structure'
    rows.push({
      key: slug(a.title || formula || a.id),
      label: a.title || formula,
      sub: payload.spaceGroup || undefined,
      source: 'artifact',
      sourceId: a.id,
      formula,
      spaceGroup: payload.spaceGroup,
    })
  }

  // 2. Structure cells in the current compute-pro artifact whose lastRun
  //    produced a parseable CIF. These are ephemeral structures that
  //    haven't been promoted via "Open as artifact" yet.
  for (const cell of computeArtifact.payload.cells ?? []) {
    if (cell.kind !== 'structure-ai' && cell.kind !== 'structure-code') continue
    const stdout = cell.lastRun?.stdout
    if (!stdout || !stdout.trim().startsWith('data_')) continue
    let formula: string | undefined
    let spaceGroup: string | undefined
    try {
      const parsed = parseCif(stdout)
      if (parsed.sites.length === 0) continue
      formula = computeFormula(parsed.sites)
      spaceGroup = parsed.spaceGroup ?? undefined
    } catch {
      continue
    }
    rows.push({
      key: cell.id,
      label: cell.title || formula || `Cell ${cell.id.slice(-4)}`,
      sub: spaceGroup,
      source: 'cell',
      sourceId: cell.id,
      formula,
      spaceGroup,
    })
  }

  return rows
}

/**
 * Convert the IPC's depth-sorted entries into FileRow shape. The IPC
 * already returns them in directory-first alpha order thanks to
 * `listRecursive`; here we only derive the depth + kind.
 */
function flattenEntries(entries: ComputeFsEntry[]): FileRow[] {
  return entries.map((e) => {
    const depth = Math.max(0, e.relPath.split('/').length - 1)
    const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
    const kind =
      e.isDirectory
        ? 'folder'
        : ext === 'cif'
          ? 'cif'
          : ext === 'csv' || ext === 'tsv'
            ? 'csv'
            : ext === 'xy'
              ? 'xy'
              : ext === 'png' || ext === 'jpg' || ext === 'jpeg'
                ? 'image'
                : ext
    return {
      relPath: e.relPath,
      name: e.name,
      kind,
      depth,
      isDir: e.isDirectory,
    }
  })
}

function collectCells(artifact: ComputeProArtifact): CellRow[] {
  return (artifact.payload.cells ?? []).map((cell) => ({
    id: cell.id,
    label: cell.title || firstLine(cell.code) || cell.kind,
    kind: cell.kind,
    status: runStatus(cell.lastRun),
  }))
}

function runStatus(run: ComputeProRun | null): 'idle' | 'ok' | 'err' | 'running' {
  if (!run) return 'idle'
  if (run.endedAt == null) return 'running'
  if (run.timedOut || run.error) return 'err'
  if (run.exitCode != null && run.exitCode !== 0) return 'err'
  return 'ok'
}

function statusTone(
  status: 'idle' | 'ok' | 'err' | 'running',
): 'ok' | 'err' | 'running' | 'idle' {
  return status
}

function fileIcon(kind: string): React.ReactNode {
  if (kind === 'cif' || kind === 'structure-meta')
    return <Atom size={12} strokeWidth={1.6} aria-hidden />
  if (kind === 'csv' || kind === 'xy')
    return <LineChart size={12} strokeWidth={1.6} aria-hidden />
  if (kind === 'image')
    return <FlaskConical size={12} strokeWidth={1.6} aria-hidden />
  return <FileText size={12} strokeWidth={1.6} aria-hidden />
}

/** Return the parent POSIX path for a relPath. '' for root children. */
function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i < 0 ? '' : relPath.slice(0, i)
}

/** Join an absolute folder root with a relative POSIX path. Used for
 *  clipboard / reveal — the IPC wants an absolute path. */
function joinAbs(root: string, rel: string): string {
  if (!rel) return root
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const trimmed = root.replace(/[\\/]+$/, '')
  return `${trimmed}${sep}${rel.replace(/\//g, sep)}`
}

/** Pretty-print an absolute path for the header chip: keep the last two
 *  segments, prepend "…/" if anything was dropped. */
function shortPath(abs: string): string {
  const parts = abs.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return abs
  return `…/${parts.slice(-2).join('/')}`
}

function firstLine(s: string): string {
  const head = (s ?? '').split('\n')[0]?.trim() ?? ''
  return head.length > 48 ? `${head.slice(0, 47)}…` : head
}

function slug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return s || 'structure'
}

// Re-export shape so the parent can strong-type the insert callbacks.
export type { StructureRow, FileRow, CellRow }
