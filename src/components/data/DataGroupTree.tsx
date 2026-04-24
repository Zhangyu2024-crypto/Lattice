import { useState, useCallback, useMemo } from 'react'
import {
  Atom,
  ChevronDown,
  ChevronRight,
  Code,
  FileEdit,
  FileText,
  FlaskConical,
  Image,
  LineChart,
  TrendingUp,
} from 'lucide-react'
import type { FsEntry } from '@/lib/workspace/fs/types'
import type { DataType } from '@/types/data-index'
import { useDataIndexStore } from '@/stores/data-index-store'
import StarRating from './StarRating'

function dataTypeIcon(dt: DataType | undefined, size: number) {
  const p = { size, strokeWidth: 1.6 }
  switch (dt) {
    case 'spectrum': return <LineChart {...p} />
    case 'analysis': return <TrendingUp {...p} />
    case 'image': return <Image {...p} />
    case 'paper': return <FileText {...p} />
    case 'structure': return <Atom {...p} />
    case 'compute': return <Code {...p} />
    case 'report': return <FileEdit {...p} />
    default: return <FileText {...p} />
  }
}

function TechniqueBadge({ technique }: { technique: string | undefined }) {
  if (!technique) return null
  const colors: Record<string, string> = {
    XRD: '#4fc3f7', XPS: '#81c784', Raman: '#ffb74d', FTIR: '#ce93d8',
    SEM: '#90a4ae', TEM: '#a1887f', EDS: '#80cbc4', AFM: '#ef9a9a',
  }
  return (
    <span
      style={{
        fontSize: "var(--text-2xs)",
        padding: '0 4px',
        borderRadius: 3,
        background: '#2a2a2a',
        border: '1px solid #444',
        color: colors[technique] ?? '#888',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {technique}
    </span>
  )
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <>
      {tags.slice(0, 2).map((t) => (
        <span
          key={t}
          style={{
            fontSize: "var(--text-2xs)",
            padding: '0 4px',
            borderRadius: 3,
            background: '#1a3a5c',
            color: '#58a6ff',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {t}
        </span>
      ))}
      {tags.length > 2 && (
        <span style={{ fontSize: "var(--text-2xs)", color: '#555', flexShrink: 0 }}>+{tags.length - 2}</span>
      )}
    </>
  )
}

interface FileRowProps {
  entry: FsEntry
  selected: boolean
  onSelect: () => void
  onDoubleClick: () => void
}

function FileRow({ entry, selected, onSelect, onDoubleClick }: FileRowProps) {
  const index = useDataIndexStore((s) => s.index)
  const fm = index.fileMeta[entry.relPath]

  return (
    <div
      role="treeitem"
      aria-selected={selected || undefined}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        paddingLeft: 30,
        paddingRight: 8,
        paddingTop: 3,
        paddingBottom: 3,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: "var(--text-sm)",
        color: '#ccc',
        background: selected ? '#2a3a4a' : undefined,
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#2a2d2e'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = selected ? '#2a3a4a' : 'transparent'
      }}
    >
      {dataTypeIcon(fm?.dataType, 14)}
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
      <TechniqueBadge technique={fm?.technique} />
      <TagChips tags={fm?.tags ?? []} />
      {fm?.rating && <StarRating value={fm.rating} readonly />}
    </div>
  )
}

interface GroupHeaderProps {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  selected?: boolean
  onSelect?: () => void
  isSample?: boolean
  formula?: string
}

function GroupHeader({ label, count, expanded, onToggle, selected, onSelect, isSample, formula }: GroupHeaderProps) {
  const handleClick = () => {
    if (onSelect) onSelect()
    onToggle()
  }

  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={selected || undefined}
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        color: '#ddd',
        background: selected ? '#2a3a4a' : undefined,
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = '#2a2d2e'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = selected ? '#2a3a4a' : 'transparent'
      }}
    >
      {expanded ? <ChevronDown size={12} strokeWidth={1.6} /> : <ChevronRight size={12} strokeWidth={1.6} />}
      {isSample && <FlaskConical size={14} strokeWidth={1.6} style={{ color: '#58a6ff' }} />}
      <span
        style={{
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
        {formula && (
          <span style={{ opacity: 0.5, marginLeft: 4, fontWeight: 400 }}>({formula})</span>
        )}
      </span>
      <span style={{ fontSize: "var(--text-xxs)", color: '#666', flexShrink: 0 }}>({count})</span>
    </div>
  )
}

interface Props {
  grouped: Map<string, FsEntry[]>
}

export default function DataGroupTree({ grouped }: Props) {
  const groupBy = useDataIndexStore((s) => s.groupBy)
  const index = useDataIndexStore((s) => s.index)
  const selectedFile = useDataIndexStore((s) => s.selectedFile)
  const selectedSample = useDataIndexStore((s) => s.selectedSample)
  const setSelectedFile = useDataIndexStore((s) => s.setSelectedFile)
  const setSelectedSample = useDataIndexStore((s) => s.setSelectedSample)
  const handleOpenFile = useCallback((relPath: string) => {
    const name = relPath.split('/').pop()?.toLowerCase() ?? ''
    const api = (window as unknown as { electronAPI?: Record<string, (...a: unknown[]) => Promise<unknown>> }).electronAPI
    if (name.endsWith('.pdf') && api?.openPdfReaderWindow) {
      void (api.openPdfReaderWindow as (r: string) => Promise<unknown>)(relPath)
    } else {
      void api?.openFile?.({ relPath })
    }
  }, [])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const sampleByName = useMemo(() => {
    const map = new Map<string, { id: string; formula?: string }>()
    for (const sample of Object.values(index.samples)) {
      map.set(sample.name, { id: sample.id, formula: sample.formula })
    }
    return map
  }, [index.samples])

  const sortedKeys = useMemo(() => {
    const keys = [...grouped.keys()]
    if (groupBy === 'sample') {
      return keys.sort((a, b) => {
        if (a === 'Unassigned') return 1
        if (b === 'Unassigned') return -1
        return a.localeCompare(b)
      })
    }
    if (groupBy === 'date') return keys.sort((a, b) => b.localeCompare(a))
    return keys.sort((a, b) => a.localeCompare(b))
  }, [grouped, groupBy])

  if (sortedKeys.length === 0) {
    return (
      <div
        style={{
          padding: '16px 14px',
          fontSize: "var(--text-sm)",
          color: '#888',
          textAlign: 'center',
        }}
      >
        No files match current filters.
      </div>
    )
  }

  return (
    <div
      role="tree"
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: 0,
      }}
    >
      {sortedKeys.map((key) => {
        const entries = grouped.get(key)!
        const expanded = expandedGroups.has(key)
        const isSampleGroup = groupBy === 'sample' && key !== 'Unassigned'
        const sampleInfo = isSampleGroup ? sampleByName.get(key) : undefined

        return (
          <div key={key}>
            <GroupHeader
              label={key}
              count={entries.length}
              expanded={expanded}
              onToggle={() => toggleGroup(key)}
              selected={isSampleGroup && !!sampleInfo && selectedSample === sampleInfo.id}
              onSelect={
                isSampleGroup && sampleInfo
                  ? () => setSelectedSample(sampleInfo.id)
                  : undefined
              }
              isSample={isSampleGroup}
              formula={sampleInfo?.formula}
            />
            {expanded &&
              entries.map((entry) => (
                <FileRow
                  key={entry.relPath}
                  entry={entry}
                  selected={selectedFile === entry.relPath}
                  onSelect={() => setSelectedFile(entry.relPath)}
                  onDoubleClick={() => handleOpenFile(entry.relPath)}
                />
              ))}
          </div>
        )
      })}
    </div>
  )
}
