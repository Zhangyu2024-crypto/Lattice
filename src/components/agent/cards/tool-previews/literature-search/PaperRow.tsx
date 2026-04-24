// Phase 3b · literature_search preview — single paper row.
//
// A lightweight in-card paper row. Kept local because the existing
// PaperArtifactCard operates on a PaperArtifact payload — different shape
// (library metadata) than this tool's OpenAlex/arXiv search row.

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { toast } from '@/stores/toast-store'
import { formatAuthors, truncate } from './helpers'
import type { LitPaperRow } from './types'

export function PaperRow({ row }: { row: LitPaperRow }) {
  const [expanded, setExpanded] = useState(false)
  const abstractCharCap = 180
  const shortAbstract = truncate(row.abstract.trim(), abstractCharCap)
  const canExpand =
    row.abstract.trim().length > abstractCharCap || row.abstract.includes('\n')
  const onImport = () => {
    toast.warn('Library import not wired yet')
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        background: 'rgba(110, 168, 254, 0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 6,
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-primary)',
          fontWeight: 600,
          lineHeight: 1.3,
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            flex: 1,
          }}
          title={row.title}
        >
          {row.title}
        </span>
        <span
          style={{
            fontSize: 'var(--text-xxs)',
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(110, 168, 254, 0.12)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
            fontWeight: 400,
            textTransform: 'lowercase',
          }}
        >
          {row.source}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '60%',
          }}
          title={row.authors}
        >
          {formatAuthors(row.authors, 3)}
        </span>
        {row.year ? <span>· {row.year}</span> : null}
        {row.venue ? (
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '40%',
            }}
            title={row.venue}
          >
            · {row.venue}
          </span>
        ) : null}
        {row.citedByCount != null ? (
          <span>· {row.citedByCount.toLocaleString()} cites</span>
        ) : null}
      </div>
      {row.abstract ? (
        <button
          type="button"
          onClick={() => canExpand && setExpanded((v) => !v)}
          disabled={!canExpand}
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-primary)',
            lineHeight: 1.5,
            background: 'transparent',
            border: 'none',
            padding: 0,
            textAlign: 'left',
            cursor: canExpand ? 'pointer' : 'default',
            opacity: 0.9,
          }}
          title={canExpand ? (expanded ? 'Collapse abstract' : 'Expand abstract') : undefined}
        >
          {expanded ? row.abstract : shortAbstract}
        </button>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 2,
        }}
      >
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 'var(--text-xxs)',
              padding: '1px 5px',
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <ExternalLink size={10} aria-hidden /> open
          </a>
        ) : null}
        {row.doi ? (
          <span
            style={{
              fontSize: 'var(--text-xxs)',
              padding: '1px 5px',
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-sans)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 260,
            }}
            title={row.doi}
          >
            doi:{row.doi}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="agent-card-btn"
          onClick={onImport}
          style={{ fontSize: 'var(--text-xxs)', padding: '1px 6px' }}
          title="Send to library (not wired yet)"
        >
          + Library
        </button>
      </div>
    </div>
  )
}
