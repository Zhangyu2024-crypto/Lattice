// Phase 3b · paper_rag_ask preview card.
//
// Surfaces the synthesised answer and its citation sources so the user can
// sanity-check the RAG result before the LLM quotes it. The answer body is
// rendered as lightly-formatted plain text (paragraph splitting on blank
// lines) — pulling `react-markdown` in here is overkill for a small answer
// string and would duplicate the heavier message renderer used by the chat
// thread. Citations become a chip row; clicking a chip toggles an excerpt
// under the row.

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'

// ─── Input / output shape narrowing ───────────────────────────────────

interface RagInput {
  paperId: number
  question: string
}

interface RagSource {
  section?: string
  page?: number
  preview?: string
  score?: number
}

interface RagOutput {
  paperId: number
  answer: string
  sources: RagSource[]
}

function narrowInput(value: unknown): RagInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { paperId?: unknown; question?: unknown }
  if (typeof v.paperId !== 'number' || !Number.isFinite(v.paperId)) return null
  if (typeof v.question !== 'string' || v.question.length === 0) return null
  return { paperId: v.paperId, question: v.question }
}

function narrowOutput(value: unknown): RagOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { paperId?: unknown; answer?: unknown; sources?: unknown }
  if (typeof v.answer !== 'string') return null
  const paperId =
    typeof v.paperId === 'number' && Number.isFinite(v.paperId) ? v.paperId : -1
  const sources: RagSource[] = []
  if (Array.isArray(v.sources)) {
    for (const raw of v.sources) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      sources.push({
        section: typeof r.section === 'string' ? r.section : undefined,
        page:
          typeof r.page === 'number' && Number.isFinite(r.page)
            ? r.page
            : undefined,
        preview: typeof r.preview === 'string' ? r.preview : undefined,
        score:
          typeof r.score === 'number' && Number.isFinite(r.score)
            ? r.score
            : undefined,
      })
    }
  }
  return { paperId, answer: v.answer, sources }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function splitParagraphs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return trimmed.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
}

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap - 1)}…`
}

function sourceLabel(src: RagSource, idx: number): string {
  if (src.section && src.page != null) return `${src.section} · p.${src.page}`
  if (src.section) return src.section
  if (src.page != null) return `p.${src.page}`
  return `src ${idx + 1}`
}

function formatScore(s: number | undefined): string | null {
  if (s == null || !Number.isFinite(s)) return null
  // Scores can be raw cosine similarity (0-1) or heterogeneous rank floats;
  // we guard the 0-1 range so the chip stays informative either way.
  if (s >= 0 && s <= 1) return `${Math.round(s * 100)}%`
  return s.toFixed(2)
}

// ─── Rendering ────────────────────────────────────────────────────────

function QuestionHeader({ input }: { input: RagInput }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span
        style={{
          color: 'var(--color-text-muted)',
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        paper #{input.paperId}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text-primary)',
          lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
        title={input.question}
      >
        {input.question}
      </span>
    </div>
  )
}

function AnswerBody({
  paragraphs,
  clamp,
}: {
  paragraphs: string[]
  clamp: boolean
}) {
  if (paragraphs.length === 0) {
    return (
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}
      >
        (empty answer)
      </span>
    )
  }
  // Clamped view keeps only the first paragraph + a "show more" affordance
  // so the compact density never runs away. The expanded density renders
  // every paragraph, still inside a scroll region so a multi-page response
  // can't dominate the chat thread.
  const shown = clamp ? paragraphs.slice(0, 1) : paragraphs
  const remainder = clamp ? paragraphs.length - shown.length : 0
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
        color: 'var(--color-text-primary)',
      }}
    >
      {shown.map((p, i) => (
        <p
          key={i}
          style={{
            margin: 0,
            display: clamp ? '-webkit-box' : 'block',
            WebkitLineClamp: clamp ? 4 : undefined,
            WebkitBoxOrient: clamp ? 'vertical' : undefined,
            overflow: clamp ? 'hidden' : 'visible',
          }}
        >
          {clamp ? truncate(p, 360) : p}
        </p>
      ))}
      {remainder > 0 ? (
        <span
          style={{
            fontSize: "var(--text-xxs)",
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          +{remainder} more paragraph{remainder === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )
}

function CitationRow({
  sources,
  activeIndex,
  onToggle,
}: {
  sources: RagSource[]
  activeIndex: number | null
  onToggle: (i: number) => void
}) {
  if (sources.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
      }}
    >
      {sources.map((src, i) => {
        const active = activeIndex === i
        const label = sourceLabel(src, i)
        const score = formatScore(src.score)
        return (
          <button
            key={i}
            type="button"
            onClick={() => onToggle(i)}
            aria-pressed={active}
            title={src.preview ?? label}
            style={{
              fontSize: "var(--text-xxs)",
              padding: '1px 5px',
              borderRadius: 3,
              background: active
                ? 'rgba(110, 168, 254, 0.25)'
                : 'rgba(110, 168, 254, 0.08)',
              border: '1px solid var(--color-border)',
              color: active
                ? 'var(--color-text-primary)'
                : 'var(--color-text-muted)',
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>[{label}]</span>
            {score ? (
              <span style={{ opacity: 0.7 }}>{score}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function CitationExcerpt({ source }: { source: RagSource }) {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        padding: '6px 8px',
        borderLeft: '2px solid rgba(110, 168, 254, 0.4)',
        background: 'rgba(0, 0, 0, 0.15)',
        borderRadius: '0 3px 3px 0',
        color: 'var(--color-text-muted)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}
    >
      {source.preview ?? '(no excerpt)'}
    </div>
  )
}

function Malformed() {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}
    >
      malformed output
    </div>
  )
}

function Body({
  input,
  output,
  clampAnswer,
  maxHeight,
}: {
  input: RagInput | null
  output: RagOutput
  clampAnswer: boolean
  maxHeight: number | null
}) {
  const paragraphs = useMemo(() => splitParagraphs(output.answer), [output.answer])
  const [activeCite, setActiveCite] = useState<number | null>(null)
  const onToggle = (i: number) =>
    setActiveCite((prev) => (prev === i ? null : i))

  const core: ReactNode = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <AnswerBody paragraphs={paragraphs} clamp={clampAnswer} />
      {output.sources.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontSize: "var(--text-xxs)",
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Citations ({output.sources.length})
          </div>
          <CitationRow
            sources={output.sources}
            activeIndex={activeCite}
            onToggle={onToggle}
          />
          {activeCite != null && output.sources[activeCite] ? (
            <CitationExcerpt source={output.sources[activeCite]!} />
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {input ? <QuestionHeader input={input} /> : null}
      {maxHeight != null ? (
        <div style={{ maxHeight, overflow: 'auto' }}>{core}</div>
      ) : (
        core
      )}
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const PaperRagAskPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: input
        ? `paper_rag_ask · #${input.paperId}`
        : 'paper_rag_ask',
      compact: <Malformed />,
    }
  }

  const answerChars = output.answer.length
  const oneLiner = `paper #${output.paperId} · ${output.sources.length} cite${
    output.sources.length === 1 ? '' : 's'
  } · ${answerChars} chars`

  return {
    oneLiner,
    compact: (
      <Body input={input} output={output} clampAnswer maxHeight={null} />
    ),
    expanded: (
      <Body
        input={input}
        output={output}
        clampAnswer={false}
        maxHeight={420}
      />
    ),
  }
}
