// Phase 3b · knowledge_search preview — query chips + mode chip header.
//
// Summarises the filter that produced the hit list: q, material, metric,
// technique, and tag get a monospaced chip; limit and the response `type`
// are rendered as caption-style pills at the trailing edge.

import type { KnowledgeSearchInput, KnowledgeSearchOutputRaw } from './types'

export function QueryHeader({
  input,
  output,
}: {
  input: KnowledgeSearchInput
  output: KnowledgeSearchOutputRaw
}) {
  const parts: Array<{ key: string; label: string; value: string }> = []
  if (input.q) parts.push({ key: 'q', label: 'q', value: input.q })
  if (input.material) parts.push({ key: 'mat', label: 'material', value: input.material })
  if (input.metric) parts.push({ key: 'met', label: 'metric', value: input.metric })
  if (input.technique) parts.push({ key: 'tech', label: 'technique', value: input.technique })
  if (input.tag) parts.push({ key: 'tag', label: 'tag', value: input.tag })
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      {parts.length > 0 ? (
        parts.map((p) => (
          <span
            key={p.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ color: 'var(--color-text-muted)' }}>{p.label}</span>
            <code
              style={{
                fontFamily: 'var(--font-sans)',
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '1px 5px',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            >
              {p.value}
            </code>
          </span>
        ))
      ) : (
        <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          (no filter)
        </span>
      )}
      {input.limit != null ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            border: '1px solid var(--color-border)',
            borderRadius: 3,
            color: 'var(--color-text-muted)',
          }}
        >
          top {input.limit}
        </span>
      ) : null}
      {output.type ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(110, 168, 254, 0.12)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            textTransform: 'lowercase',
          }}
        >
          {output.type}
        </span>
      ) : null}
    </div>
  )
}
