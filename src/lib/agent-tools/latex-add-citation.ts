// Phase A3 — `latex_add_citation` agent tool.
//
// Scans the active latex-document artifact's text against the session's
// `paper` artifacts, produces a set of `\cite{key}` insertion operations,
// plus bib entries sized for the demo's natbib + `\bibliography{refs}`
// pattern. Surfaces as a review-mode AgentCard — no editor; Approve applies
// all operations in one patchArtifact call.
//
// The tool is intentionally "suggestion"-shaped: it never mutates the
// artifact itself. The card's Approve button triggers `applyCitationOps`.

import type { LocalTool } from '../../types/agent-tool'
import type { Artifact } from '../../types/artifact'
import type { LatexDocumentPayload } from '../../types/latex'
import { useRuntimeStore } from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'

interface PaperArtifactMeta {
  artifactId: string
  bibkey: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  abstract: string | null
}

export interface LatexCitationOp {
  file: string
  insertAt: number
  text: string
  cite: string
  context: string
}

interface Input {
  artifactId?: string
  paperIds?: string[]
}

interface SuccessOutput {
  success: true
  artifactId: string
  operations: LatexCitationOp[]
  bibAdditions: string
  citationsAdded: number
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

const PROMPT_SYSTEM =
  'You are a citation placement assistant for academic LaTeX. Given the ' +
  'manuscript prose and a list of candidate papers (each with an abstract), ' +
  'choose 0-N places where a `\\cite{key}` would strengthen an unsupported ' +
  'claim. Return STRICT JSON — no prose, no code fences — as an array: ' +
  '[{"bibkey":"smith2020","insertAfter":"exact substring from the source ' +
  'where the cite should follow"}]. Quote `insertAfter` verbatim from the ' +
  'manuscript; keep it 20-80 chars long so the orchestrator can locate the ' +
  'span. Skip claims already adjacent to a \\cite. Return [] if no ' +
  'additions are warranted.'

function stripFence(text: string): string {
  const m = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  return m ? m[1] : text.trim()
}

function slugifyAuthor(name: string): string {
  const last = name.split(/[\s,]+/).filter(Boolean).pop() ?? name
  return last.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function paperBibkey(
  authors: string[],
  year: number | null,
  existing: Set<string>,
): string {
  const base = `${slugifyAuthor(authors[0] ?? 'paper')}${year ?? ''}` || 'paper'
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}${String.fromCharCode(96 + i)}`)) i += 1
  return `${base}${String.fromCharCode(96 + i)}`
}

function extractPapers(
  sessionId: string,
  filterIds?: string[],
): PaperArtifactMeta[] {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) return []
  const filter = filterIds ? new Set(filterIds) : null
  const used = new Set<string>()
  const out: PaperArtifactMeta[] = []
  for (const id of session.artifactOrder) {
    if (filter && !filter.has(id)) continue
    const artifact: Artifact | undefined = session.artifacts[id]
    if (!artifact || artifact.kind !== 'paper') continue
    const payload = artifact.payload as {
      metadata?: {
        title?: string
        authors?: string[]
        year?: number
        venue?: string
        doi?: string
        abstract?: string
      }
    }
    const meta = payload.metadata ?? {}
    const authors = Array.isArray(meta.authors) ? meta.authors.filter(Boolean) : []
    const bibkey = paperBibkey(authors, meta.year ?? null, used)
    used.add(bibkey)
    out.push({
      artifactId: id,
      bibkey,
      title: meta.title ?? artifact.title ?? 'Untitled',
      authors,
      year: meta.year ?? null,
      venue: meta.venue ?? null,
      doi: meta.doi ?? null,
      abstract: (meta.abstract ?? '').slice(0, 600) || null,
    })
  }
  return out
}

function formatBibEntry(p: PaperArtifactMeta): string {
  const authorField = p.authors.length > 0 ? p.authors.join(' and ') : 'Anonymous'
  const parts: string[] = [
    `@article{${p.bibkey},`,
    `  author  = {${authorField}},`,
    `  title   = {${p.title}},`,
  ]
  if (p.venue) parts.push(`  journal = {${p.venue}},`)
  if (p.year != null) parts.push(`  year    = {${p.year}},`)
  if (p.doi) parts.push(`  doi     = {${p.doi}},`)
  parts.push('}')
  return parts.join('\n')
}

function buildManuscriptPreview(
  payload: LatexDocumentPayload,
  maxChars = 4000,
): string {
  // Concatenate .tex files (skip .bib / assets) with file headers; truncate
  // at a budget. Preserves positional hints the LLM needs to match excerpts.
  const parts: string[] = []
  let budget = maxChars
  for (const f of payload.files) {
    if (f.kind !== 'tex') continue
    const header = `%% FILE: ${f.path}\n`
    const body = f.content.slice(0, Math.max(0, budget - header.length))
    parts.push(header + body)
    budget -= header.length + body.length
    if (budget <= 0) break
  }
  return parts.join('\n\n')
}

function findInsertionOffset(
  text: string,
  anchor: string,
): number | null {
  if (!anchor) return null
  const idx = text.indexOf(anchor)
  return idx < 0 ? null : idx + anchor.length
}

interface LlmPlacement {
  bibkey: string
  insertAfter: string
}

function parseLlmJson(raw: string): LlmPlacement[] {
  try {
    const parsed = JSON.parse(stripFence(raw))
    if (!Array.isArray(parsed)) return []
    const out: LlmPlacement[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const bibkey = typeof (item as { bibkey?: unknown }).bibkey === 'string'
        ? (item as { bibkey: string }).bibkey
        : null
      const after = typeof (item as { insertAfter?: unknown }).insertAfter === 'string'
        ? (item as { insertAfter: string }).insertAfter
        : null
      if (!bibkey || !after) continue
      out.push({ bibkey, insertAfter: after })
    }
    return out
  } catch {
    return []
  }
}

export const latexAddCitationTool: LocalTool<Input, Output> = {
  name: 'latex_add_citation',
  description:
    'Scan a latex-document artifact against the session\'s paper artifacts ' +
    'and propose `\\cite{...}` insertions + corresponding .bib entries. ' +
    'Does not mutate the artifact; the card\'s Approve button applies the ' +
    'operations through `applyLatexCitationOps`.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'latex-document artifact id.',
      },
      paperIds: {
        type: 'array',
        description:
          'Optional subset of paper artifact ids to consider (string[]); ' +
          'defaults to all paper artifacts in the current session.',
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    const artifactId = typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) {
      return { success: false, error: 'artifactId is required (string)' }
    }
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }
    const artifact = session.artifacts[artifactId]
    if (!artifact) {
      return { success: false, error: `Artifact not found: ${artifactId}` }
    }
    if (artifact.kind !== 'latex-document') {
      return {
        success: false,
        error: `Artifact ${artifactId} is kind="${artifact.kind}"; expected latex-document.`,
      }
    }
    const payload = artifact.payload as LatexDocumentPayload

    const papers = extractPapers(ctx.sessionId, input?.paperIds)
    if (papers.length === 0) {
      return {
        success: false,
        error:
          'No paper artifacts in the current session to cite. Import one ' +
          'from Library first.',
      }
    }

    const manuscript = buildManuscriptPreview(payload)
    const paperSummary = papers
      .map(
        (p) =>
          `- bibkey=${p.bibkey} · ${p.authors.join(', ') || 'Anonymous'} (${p.year ?? 'n.d.'})` +
          ` · ${p.title}\n  abstract: ${p.abstract ?? '(no abstract)'}`,
      )
      .join('\n')

    const userMsg = [
      `SYSTEM: ${PROMPT_SYSTEM}`,
      '',
      'PAPERS:',
      paperSummary,
      '',
      'MANUSCRIPT:',
      manuscript,
    ].join('\n')

    const llm = await sendLlmChat({
      mode: 'agent',
      userMessage: userMsg,
      transcript: [],
      sessionId: ctx.sessionId,
    })
    if (!llm.success) {
      return { success: false, error: llm.error ?? 'LLM call failed' }
    }

    const placements = parseLlmJson(llm.content)

    // Turn LLM placements into concrete ops keyed by file/offset. We only
    // consider ops that anchor inside the actual artifact text (safety
    // against hallucinated anchors).
    const ops: LatexCitationOp[] = []
    const bibkeysUsed = new Set<string>()
    for (const p of placements) {
      const paper = papers.find((x) => x.bibkey === p.bibkey)
      if (!paper) continue
      for (const file of payload.files) {
        if (file.kind !== 'tex') continue
        const offset = findInsertionOffset(file.content, p.insertAfter)
        if (offset == null) continue
        ops.push({
          file: file.path,
          insertAt: offset,
          text: `~\\cite{${paper.bibkey}}`,
          cite: paper.bibkey,
          context: p.insertAfter.slice(0, 80),
        })
        bibkeysUsed.add(paper.bibkey)
        break
      }
    }

    const bibAdditions = papers
      .filter((p) => bibkeysUsed.has(p.bibkey))
      .map(formatBibEntry)
      .join('\n\n')

    const summary =
      ops.length === 0
        ? 'No citations needed — either no unsupported claims matched, or ' +
          'LLM output could not be aligned to the manuscript.'
        : `${ops.length} citation${ops.length === 1 ? '' : 's'} proposed across ` +
          `${new Set(ops.map((o) => o.file)).size} file(s) + ${bibkeysUsed.size} ` +
          'bib entr' +
          (bibkeysUsed.size === 1 ? 'y' : 'ies') +
          '.'

    return {
      success: true,
      artifactId,
      operations: ops,
      bibAdditions,
      citationsAdded: ops.length,
      summary,
    }
  },
}

// ─── Patch applier ─────────────────────────────────────────────────────
//
// Apply the proposed ops + bib additions. Called from the review card's
// Approve handler. Insertions are applied right-to-left per file so earlier
// offsets remain valid.

export function applyLatexCitationOps(
  sessionId: string,
  output: SuccessOutput,
): void {
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) return
  const artifact = session.artifacts[output.artifactId]
  if (!artifact || artifact.kind !== 'latex-document') return
  const payload = artifact.payload as LatexDocumentPayload

  // Group ops by file, sort descending so earlier offsets aren't invalidated
  // by later inserts.
  const byFile = new Map<string, LatexCitationOp[]>()
  for (const op of output.operations) {
    const arr = byFile.get(op.file) ?? []
    arr.push(op)
    byFile.set(op.file, arr)
  }
  for (const [, arr] of byFile) arr.sort((a, b) => b.insertAt - a.insertAt)

  const nextFiles = payload.files.map((f) => {
    const ops = byFile.get(f.path)
    if (!ops || ops.length === 0) return f
    let content = f.content
    for (const op of ops) {
      content = content.slice(0, op.insertAt) + op.text + content.slice(op.insertAt)
    }
    return { ...f, content }
  })

  // Bibliography file: append new entries to `refs.bib` if present; create
  // it at the root if missing. Demo uses `\bibliography{refs}` so `refs.bib`
  // is the conventional location.
  if (output.bibAdditions.trim()) {
    const existingIdx = nextFiles.findIndex((f) => f.path === 'refs.bib')
    if (existingIdx >= 0) {
      const existing = nextFiles[existingIdx]
      const glue = existing.content.endsWith('\n') ? '' : '\n'
      nextFiles[existingIdx] = {
        ...existing,
        content: existing.content + glue + '\n' + output.bibAdditions + '\n',
      }
    } else {
      nextFiles.push({
        path: 'refs.bib',
        kind: 'bib',
        content: output.bibAdditions + '\n',
      })
    }
  }

  store.patchArtifact(sessionId, artifact.id, {
    payload: { ...payload, files: nextFiles },
  } as never)
}
