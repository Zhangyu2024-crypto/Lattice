// Extracted from FileTree.tsx to keep the main component under the
// maintainability ceiling. Replaces the old toast-based Properties output
// that auto-dismissed before the user could read eight fields. Reads from
// `data-index-store` so Sample / Tags / Technique stay live with whatever
// just got assigned via the context menu.

import { Info } from 'lucide-react'
import type { IndexedEntry } from '../../../stores/workspace-store'
import { useDataIndexStore } from '../../../stores/data-index-store'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { formatSize } from './helpers'

interface PropertiesDialogProps {
  entry: IndexedEntry
  onClose: () => void
}

export default function PropertiesDialog({
  entry,
  onClose,
}: PropertiesDialogProps) {
  useEscapeKey(onClose)
  const meta = useDataIndexStore((s) => s.index.fileMeta[entry.relPath])
  const sampleName = useDataIndexStore((s) => {
    if (!meta?.sampleId) return 'unassigned'
    const sample = s.index.samples[meta.sampleId]
    return sample ? sample.name : meta.sampleId
  })

  const rows: Array<[string, string]> = [
    ['Name', entry.name],
    ['Path', entry.relPath || '/'],
    ['Kind', entry.kind ?? (entry.isDirectory ? 'folder' : 'file')],
    ['Size', formatSize(entry.size)],
    [
      'Modified',
      entry.mtime ? new Date(entry.mtime).toLocaleString() : 'unknown',
    ],
    ['Tags', meta?.tags?.length ? meta.tags.join(', ') : 'none'],
    ['Technique', meta?.technique ?? 'unset'],
    ['Sample', sampleName],
  ]

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-properties-dialog-title"
        style={{
          width: 'min(440px, 92vw)',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-sidebar, #1e1e1e)',
          border: '1px solid var(--color-border, #2a2a2a)',
          borderRadius: 10,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)',
          color: 'var(--color-text-primary, #ddd)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border, #2a2a2a)',
          }}
        >
          <Info size={16} strokeWidth={1.7} />
          <h2
            id="file-properties-dialog-title"
            style={{
              margin: 0,
              fontSize: 'var(--text-md)',
              fontWeight: 600,
            }}
          >
            Properties
          </h2>
        </header>

        <div
          style={{
            padding: '12px 16px',
            overflowY: 'auto',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted, #b8bec6)',
          }}
        >
          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              columnGap: 12,
              rowGap: 6,
            }}
          >
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt
                  style={{
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {k}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    color: 'var(--color-text-primary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '10px 16px',
            borderTop: '1px solid var(--color-border, #2a2a2a)',
            background: 'var(--color-bg-panel, #191919)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '4px 12px',
              fontSize: 'var(--text-sm)',
              background: 'var(--color-bg-hover, #2a2a2a)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border, #333)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
