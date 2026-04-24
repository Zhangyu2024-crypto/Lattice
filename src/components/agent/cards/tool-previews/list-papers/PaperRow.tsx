// Phase 3b · list_papers preview — single library paper row.
//
// Renders one library paper: id chip (copies paper id to clipboard on
// click), clamped title, optional "pdf" attachment pill, author/year/
// journal byline, and up to six tag chips with a "+N" overflow.

import { copyText } from '@/lib/clipboard-helper'
import { formatAuthors } from './helpers'
import type { LibraryPaperRow } from './types'

export function PaperRow({ paper }: { paper: LibraryPaperRow }) {
  const onCopyId = () => {
    void copyText(String(paper.id), `Copied paper id ${paper.id}`)
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
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
        <button
          type="button"
          onClick={onCopyId}
          title={`Copy paper id ${paper.id}`}
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(110, 168, 254, 0.12)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontWeight: 400,
            flexShrink: 0,
          }}
        >
          #{paper.id}
        </button>
        <span
          style={{
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            flex: 1,
          }}
          title={paper.title}
        >
          {paper.title}
        </span>
        {paper.hasPdf ? (
          <span
            title="PDF attached"
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(50, 200, 100, 0.12)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              flexShrink: 0,
            }}
          >
            pdf
          </span>
        ) : null}
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
            maxWidth: '55%',
          }}
          title={paper.authors}
        >
          {formatAuthors(paper.authors, 3)}
        </span>
        {paper.year ? <span>· {paper.year}</span> : null}
        {paper.journal ? (
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '40%',
            }}
            title={paper.journal}
          >
            · {paper.journal}
          </span>
        ) : null}
      </div>
      {paper.tags && paper.tags.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {paper.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: "var(--text-xxs)",
                padding: '1px 5px',
                borderRadius: 3,
                background: 'rgba(110, 168, 254, 0.08)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              {tag}
            </span>
          ))}
          {paper.tags.length > 6 ? (
            <span
              style={{
                fontSize: "var(--text-xxs)",
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              +{paper.tags.length - 6}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
