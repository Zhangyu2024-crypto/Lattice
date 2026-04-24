// Phase 3b · knowledge_search preview — single hit card.
//
// Renders a chain-match row: paper title (with optional section suffix),
// confidence chip, clamped excerpt, and a paper-id / bucket chip row.
// Clicking the paper-id chip copies the id to the clipboard — no cross-
// renderer "open paper" event exists today, so copy is the most useful
// affordance we can surface here.

import { copyText } from '@/lib/clipboard-helper'
import { formatConfidence, truncate } from './helpers'
import type { Hit } from './types'

export function ResultRow({ hit }: { hit: Hit }) {
  const conf = formatConfidence(hit.confidence)
  const onClickPaper = () => {
    if (hit.paperId == null) return
    void copyText(String(hit.paperId), `Copied paper id ${hit.paperId}`)
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
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={hit.title}
        >
          {hit.title}
        </span>
        {conf ? (
          <span
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              fontWeight: 400,
              fontFamily: 'var(--font-sans)',
            }}
            title="Confidence score"
          >
            {conf}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {truncate(hit.snippet, 260)}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {hit.paperId != null ? (
          <button
            type="button"
            onClick={onClickPaper}
            title={`Copy paper id ${hit.paperId}`}
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(110, 168, 254, 0.12)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            paper #{hit.paperId}
          </button>
        ) : (
          <span
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            chain #{hit.chainId}
          </span>
        )}
        {hit.bucket ? (
          <span
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              textTransform: 'lowercase',
            }}
          >
            {hit.bucket}
          </span>
        ) : null}
      </div>
    </div>
  )
}
