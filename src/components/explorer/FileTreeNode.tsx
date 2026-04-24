import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Activity,
  AtSign,
  Atom,
  BarChart3,
  BookOpen,
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Grid3X3,
  Image,
  Layers,
  Lightbulb,
  LineChart,
  ListChecks,
  MessageSquare,
  Network,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Wand2,
} from 'lucide-react'
import type { IndexedEntry } from '../../stores/workspace-store'
import type { LatticeFileKind } from '../../lib/workspace/fs/types'

interface Props {
  entry: IndexedEntry
  depth: number
  expanded: boolean
  childEntries: IndexedEntry[]
  isExpandedSet: Set<string>
  onToggle: (rel: string) => void
  onOpen: (entry: IndexedEntry) => void
  onSelect?: (relPath: string, event: { shift: boolean; ctrl: boolean }) => void
  onContextMenu: (entry: IndexedEntry, x: number, y: number) => void
  renderChild: (child: IndexedEntry, depth: number) => ReactElement
  activeRel?: string | null
  selected?: boolean
  /**
   * Optional hover action — click adds the file as a mention to the chat
   * composer. Wired from FileTree (which owns the dispatch logic). Directory
   * rows ignore this prop; the action is file-only because workspace folders
   * aren't a valid mention target in the current MentionRef protocol.
   */
  onAtClick?: (entry: IndexedEntry) => void
  /**
   * `.chat.json` bare single-click path: activate the corresponding session
   * in the AgentComposer without opening a preview tab in the editor area.
   * Double-click and context-menu "Open" still flow through `onOpen` so the
   * read-only transcript preview remains accessible as a power-user escape
   * hatch.
   */
  onChatEnter?: (relPath: string) => void
}

function kindIcon(kind: LatticeFileKind | undefined, size: number) {
  const props = { size, strokeWidth: 1.6 }
  switch (kind) {
    case 'spectrum':
      return <LineChart {...props} />
    case 'chat':
      return <MessageSquare {...props} />
    case 'peakfit':
    case 'xrd':
    case 'xps':
    case 'raman':
    case 'curve':
      return <Activity {...props} />
    case 'workbench':
      return <SlidersHorizontal {...props} />
    case 'cif':
      return <Atom {...props} />
    case 'script':
      return <FileCode {...props} />
    case 'markdown':
      return <FileText {...props} />
    case 'job':
      return <ListChecks {...props} />
    case 'research-report':
      return <FileText {...props} />
    case 'hypothesis':
      return <Lightbulb {...props} />
    case 'paper':
    case 'bib':
      return <BookOpen {...props} />
    case 'material-comp':
      return <BarChart3 {...props} />
    case 'knowledge':
      return <Network {...props} />
    case 'batch':
      return <Layers {...props} />
    case 'optimization':
      return <TrendingUp {...props} />
    case 'similarity':
      return <Grid3X3 {...props} />
    case 'structure-meta':
      return <Atom {...props} />
    case 'latex-document':
    case 'tex':
      return <FileType {...props} />
    case 'pdf':
      return <FileText {...props} />
    case 'image':
      return <Image {...props} />
    case 'csv':
      return <Table2 {...props} />
    case 'text':
      return <FileText {...props} />
    case 'spectral-data':
    case 'xrd-data':
      return <LineChart {...props} />
    case 'json':
      return <Braces {...props} />
    default:
      return <File {...props} />
  }
}

export default function FileTreeNode({
  entry,
  depth,
  expanded,
  childEntries,
  isExpandedSet,
  onToggle,
  onOpen,
  onSelect,
  onContextMenu,
  renderChild,
  activeRel,
  selected,
  onAtClick,
  onChatEnter,
}: Props) {
  const paddingLeft = useMemo(() => 8 + depth * 12, [depth])
  const isDir = entry.isDirectory
  const isActive = !isDir && activeRel === entry.relPath
  const isHighlighted = selected || isActive
  // Local hover state drives the "@" icon reveal. We already mutate the row's
  // background in onMouseEnter/Leave via ref-free inline style; tracking
  // hover separately in state is the simplest way to key a child's opacity
  // without promoting the whole row to a styled-components / CSS-module
  // rewrite. The re-render cost is negligible (one row per transition).
  const [hovered, setHovered] = useState(false)
  const showAtIcon = !isDir && onAtClick !== undefined

  const rowClick = (e: React.MouseEvent) => {
    if (isDir) {
      onToggle(entry.relPath)
      return
    }
    const hasMod = e.shiftKey || e.ctrlKey || e.metaKey
    onSelect?.(entry.relPath, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
    // `.chat.json` files back a live conversation, not a static document.
    // Bare single-click activates the session in AgentComposer; no editor
    // tab is opened. Modifier-click keeps select-only for multi-select,
    // and double-click falls through to the normal preview path below.
    if (
      !hasMod &&
      onChatEnter &&
      entry.relPath.toLowerCase().endsWith('.chat.json')
    ) {
      onChatEnter(entry.relPath)
    }
  }

  const rowDoubleClick = () => {
    if (!isDir) onOpen(entry)
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingLeft,
    paddingRight: 8,
    paddingTop: 3,
    paddingBottom: 3,
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: "var(--text-sm)",
    color: 'var(--fg, #ddd)',
    background: isHighlighted ? 'rgba(96, 165, 250, 0.15)' : undefined,
    borderLeft: selected ? '2px solid #60a5fa' : '2px solid transparent',
  }

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={isActive || undefined}
        style={rowStyle}
        onClick={rowClick}
        onDoubleClick={rowDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(entry, e.clientX, e.clientY)
        }}
        onMouseEnter={(e) => {
          setHovered(true)
          if (!isHighlighted) (e.currentTarget as HTMLDivElement).style.background = 'var(--hover, #2a2d2e)'
        }}
        onMouseLeave={(e) => {
          setHovered(false)
          ;(e.currentTarget as HTMLDivElement).style.background = isHighlighted
            ? 'rgba(96, 165, 250, 0.15)'
            : 'transparent'
        }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown size={12} strokeWidth={1.6} />
          ) : (
            <ChevronRight size={12} strokeWidth={1.6} />
          )
        ) : (
          <span style={{ display: 'inline-block', width: 12 }} />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen size={14} strokeWidth={1.6} />
          ) : (
            <Folder size={14} strokeWidth={1.6} />
          )
        ) : (
          kindIcon(entry.kind, 14)
        )}
        <span
          style={{
            flex: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entry.name}
        </span>
        {showAtIcon ? (
          <button
            type="button"
            aria-label={`Add @${entry.name} to chat`}
            title="Add to chat as @mention"
            onClick={(e) => {
              // Must stop propagation so the row's own onClick (select /
              // toggle) doesn't fire when the user clicks the hover action.
              e.stopPropagation()
              onAtClick?.(entry)
            }}
            onDoubleClick={(e) => {
              // Shield rowDoubleClick — otherwise a fast double-click on the
              // icon would open the file in the editor as a side-effect.
              e.stopPropagation()
            }}
            style={{
              // Hover-revealed: invisible by default, pointer-events disabled
              // so it cannot steal row clicks when not shown. The row keeps
              // its existing background handling unchanged.
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 80ms ease',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              padding: 0,
              marginLeft: 4,
              background: 'transparent',
              border: 'none',
              borderRadius: 3,
              color: 'var(--fg-muted, #9aa0a6)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <AtSign size={12} strokeWidth={1.8} aria-hidden />
          </button>
        ) : null}
      </div>
      {isDir && expanded ? (
        <div role="group">
          {childEntries.length === 0 ? (
            <div
              style={{
                paddingLeft: paddingLeft + 20,
                paddingTop: 2,
                paddingBottom: 2,
                fontSize: "var(--text-xs)",
                color: 'var(--fg-muted, #777)',
              }}
            >
              (empty)
            </div>
          ) : (
            childEntries.map((child) => renderChild(child, depth + 1))
          )}
        </div>
      ) : null}
      {/* Reference to satisfy the linter — expansion state surfaces through
          `renderChild`, not via this prop directly. */}
      {isExpandedSet ? null : null}
    </div>
  )
}
