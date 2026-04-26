// Pure helpers for the research-report artifact card: markdown exporter,
// citation-pill markdown components, tooltip formatter, and filename
// slugger. Kept separate from the card so they stay easy to unit-test
// and do not pull the whole three-pane shell into other contexts.

import type { Components } from 'react-markdown'
import type {
  Citation,
  ReportSection,
  ResearchReportPayload,
} from './types'
import { CITE_TOKEN_RE } from './types'

export function buildCitationIndexByFirstUse(payload: {
  sections: ReportSection[]
  citations: Citation[]
}): Map<string, number> {
  const knownIds = new Set(payload.citations.map((citation) => citation.id))
  const citationIndex = new Map<string, number>()
  const add = (id: string) => {
    if (!knownIds.has(id) || citationIndex.has(id)) return
    citationIndex.set(id, citationIndex.size + 1)
  }

  for (const section of payload.sections) {
    CITE_TOKEN_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CITE_TOKEN_RE.exec(section.markdown)) !== null) {
      add(match[1])
    }
    for (const id of section.citationIds) add(id)
  }
  for (const citation of payload.citations) add(citation.id)
  return citationIndex
}

export function orderCitationsByIndex(
  citations: Citation[],
  citationIndex: Map<string, number>,
): Citation[] {
  return [...citations].sort(
    (a, b) =>
      (citationIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (citationIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

export function buildMarkdownComponents(
  citationIndex: Map<string, number>,
  citations: Citation[],
  onCiteClick: (id: string) => void,
): Components {
  const byId = new Map(citations.map((c) => [c.id, c]))
  const renderToken = (id: string, key: string) => {
    const n = citationIndex.get(id)
    if (!n) return <span key={key}>[?]</span>
    const cite = byId.get(id)
    const tooltip = cite ? citationTooltip(cite, n) : `Reference ${n}`
    const handleClick = (e: React.SyntheticEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onCiteClick(id)
    }
    return (
      <sup
        key={key}
        role="button"
        tabIndex={0}
        aria-label={`Reference ${n}`}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          handleClick(e)
        }}
        className="research-card-cite-pill"
        title={tooltip}
      >
        {n}
      </sup>
    )
  }
  const transform = (
    node: React.ReactNode,
    keyPrefix: string,
  ): React.ReactNode => {
    if (typeof node !== 'string') return node
    const parts: React.ReactNode[] = []
    let last = 0
    let tokenIdx = 0
    CITE_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CITE_TOKEN_RE.exec(node)) !== null) {
      if (m.index > last) parts.push(node.slice(last, m.index))
      parts.push(renderToken(m[1], `${keyPrefix}-${tokenIdx++}`))
      last = m.index + m[0].length
    }
    if (last < node.length) parts.push(node.slice(last))
    return parts.length > 0 ? parts : node
  }
  const wrap = (
    children: React.ReactNode,
    kp: string,
  ): React.ReactNode => {
    if (Array.isArray(children))
      return children.map((c, i) => transform(c, `${kp}-${i}`))
    return transform(children, kp)
  }
  return {
    p: ({ children }) => <p>{wrap(children, 'p')}</p>,
    li: ({ children }) => <li>{wrap(children, 'li')}</li>,
    td: ({ children }) => <td>{wrap(children, 'td')}</td>,
    strong: ({ children }) => <strong>{wrap(children, 'strong')}</strong>,
    em: ({ children }) => <em>{wrap(children, 'em')}</em>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
  }
}

export function buildFullMarkdown(
  payload: ResearchReportPayload,
  citationIndex: Map<string, number>,
): string {
  const lines: string[] = []
  lines.push(`# ${payload.topic}`, '')
  lines.push(
    `_Mode_: **${payload.mode}**  _Style_: **${payload.style}**  _Generated_: ${new Date(payload.generatedAt).toISOString()}`,
    '',
  )
  if (payload.citations.some((c) => c.unverified)) {
    lines.push(
      '> ⚠️ **Unverified citations.** Some references below were drafted by an LLM and have not been verified against a source library. Check each citation before redistributing this report.',
      '',
    )
  }
  if (payload.interview?.assumptions?.length) {
    lines.push('## Pre-interview Assumptions', '')
    for (const item of payload.interview.assumptions) lines.push(`- ${item}`)
    lines.push('')
  }
  if (payload.assembly?.abstract) {
    lines.push('## Abstract', '', payload.assembly.abstract, '')
  }
  if (payload.assembly?.keywords?.length) {
    lines.push(`**Keywords:** ${payload.assembly.keywords.join('; ')}`, '')
  }
  if (payload.assembly?.methodology) {
    lines.push('## Methodology', '', payload.assembly.methodology, '')
  }
  lines.push('## Outline', '')
  for (const sec of payload.sections)
    lines.push(`${'  '.repeat(sec.level - 1)}- ${sec.heading}`)
  lines.push('')
  for (const sec of payload.sections) {
    lines.push(`${'#'.repeat(sec.level)} ${sec.heading}`, '')
    const body = sec.markdown.replace(CITE_TOKEN_RE, (_m, id: string) => {
      const n = citationIndex.get(id)
      return n ? `[${n}]` : '[?]'
    })
    lines.push(body, '')
  }
  if (payload.citations.length > 0) {
    lines.push('## References', '')
    for (const c of orderCitationsByIndex(payload.citations, citationIndex)) {
      const n = citationIndex.get(c.id) ?? 0
      const venue = c.venue ? `. ${c.venue}` : ''
      const doi = c.doi ? `. doi:${c.doi}` : ''
      const url = !c.doi && c.url ? `. ${c.url}` : ''
      lines.push(
        `[${n}] ${c.authors.join(', ')} (${c.year}). ${c.title}${venue}${doi}${url}`,
      )
    }
    lines.push('')
  }
  if (payload.refinement) {
    lines.push('## Refinement Pass', '')
    for (const change of payload.refinement.changes) lines.push(`- ${change}`)
    for (const issue of payload.refinement.unresolvedIssues) lines.push(`- Unresolved: ${issue}`)
    lines.push('')
  }
  if (payload.export) {
    lines.push('## Export Readiness', '')
    lines.push(`- Markdown ready: ${payload.export.markdownReady ? 'yes' : 'no'}`)
    lines.push(`- LaTeX/PDF ready: ${payload.export.latexReady ? 'yes' : 'no'}`)
    if (payload.export.pdfPipeline) lines.push(`- Pipeline: ${payload.export.pdfPipeline}`)
    for (const note of payload.export.notes) lines.push(`- ${note}`)
    lines.push('')
  }
  if (payload.assembly?.qualityAudit) {
    lines.push('## Quality Audit', '', payload.assembly.qualityAudit.summary, '')
    for (const warning of payload.assembly.qualityAudit.warnings) {
      lines.push(`- ${warning}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function citationTooltip(cite: Citation, n: number): string {
  const firstAuthor = cite.authors[0] ?? 'Anon.'
  const etAl = cite.authors.length > 1 ? ' et al.' : ''
  const venue = cite.venue ? ` — ${cite.venue}` : ''
  const flag = cite.unverified ? ' [unverified]' : ''
  return `[${n}] ${firstAuthor}${etAl} (${cite.year}) — ${cite.title}${venue}${flag}`
}

export function slugify(input: string): string {
  return (
    (input || 'report')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || 'report'
  )
}
