// Shared types and helpers for the research-flow tool family
// (`research_plan_outline`, `research_draft_section`,
// `research_finalize_report`).
//
// These three tools cooperate on a single research-report artifact that is
// created empty and patched incrementally so the user sees the work happen
// in the canvas instead of waiting on a single opaque LLM call.
//
// Design decisions worth knowing before touching this file:
//
//   - **Mode + style live on the payload, not on each tool call.** Once the
//     plan tool writes them to the artifact, later tools read them back to
//     stay consistent. Callers never need to re-pass mode.
//
//   - **Section ids are deterministic per artifact.** The plan tool assigns
//     stable ids (slug + index); draft_section operates by id, not by
//     position, so user re-ordering or insertions don't break references.
//
//   - **Citations are merged, not replaced.** Each draft_section tool call
//     appends new citations to the existing list (dedup by id). The final
//     finalize_report tool runs a global dedup pass + validates every
//     [@cite:X] token has a matching citations[].id.

import type { LocalTool, ToolInputSchema } from '../../types/agent-tool'

export type ResearchMode = 'research' | 'survey'
export type ResearchStyle = 'concise' | 'comprehensive'
export type ResearchStage =
  | 'Interview'
  | 'Retrieval'
  | 'Outline'
  | 'Writing'
  | 'Refinement'
  | 'Assembly'
  | 'Complete'

export type ReportStatus = 'planning' | 'drafting' | 'complete'
export type SectionStatus = 'empty' | 'drafting' | 'done'

export interface ReportSection {
  id: string
  heading: string
  level: 1 | 2 | 3
  markdown: string
  citationIds: string[]
  status: SectionStatus
}

export interface Citation {
  id: string
  title: string
  authors: string[]
  year: number
  venue: string | null
  doi: string | null
  url?: string | null
  /** `true` — fabricated by the LLM (legacy path, pre-literature-search).
   *  `false` — backed by OpenAlex / arXiv / a verified source. The UI
   *  only shows the red "unverified" chip / banner when this is true. */
  unverified: boolean
}

export interface ResearchRetrievalMeta {
  queries: string[]
  localLibraryQueries?: string[]
  totalRetrieved: number
  papersUsed: number
  yearRange: string | null
  yearDistribution: Record<string, number>
  sourceDistribution: Record<string, number>
  sourcesUsed: string[]
}

export interface ResearchInterviewMeta {
  questions: string[]
  answers: string[]
  assumptions: string[]
}

export interface ResearchRefinementMeta {
  passCount: number
  changes: string[]
  unresolvedIssues: string[]
}

export interface ResearchExportMeta {
  markdownReady: boolean
  latexReady: boolean
  pdfPipeline: string
  notes: string[]
}

export interface ResearchAssemblyMeta {
  abstract?: string
  keywords?: string[]
  methodology?: string
  qualityAudit?: {
    summary: string
    warnings: string[]
  }
}

export interface ResearchReportPayload {
  topic: string
  mode: ResearchMode
  style: ResearchStyle
  sections: ReportSection[]
  citations: Citation[]
  generatedAt: number
  status: ReportStatus
  currentSectionId?: string | null
  /** CLI-compatible phase name: Interview → Retrieval → Outline → Writing → Refinement → Assembly. */
  stage?: ResearchStage
  interview?: ResearchInterviewMeta
  retrieval?: ResearchRetrievalMeta
  refinement?: ResearchRefinementMeta
  assembly?: ResearchAssemblyMeta
  export?: ResearchExportMeta
}

/** Soft fallback headings keyed by mode/style. These are no longer the
 *  default frame for every report — `research_plan_outline` asks the LLM
 *  for a topic-specific outline first, then pads/falls back with these
 *  when the response is malformed or too short. */
export const SECTION_TEMPLATES: Readonly<
  Record<ResearchMode, Readonly<Record<ResearchStyle, readonly string[]>>>
> = {
  research: {
    concise: ['Snapshot', 'Related Literature', 'Validation Plan'],
    comprehensive: [
      'Snapshot',
      'Mechanism & Structure',
      'Related Literature',
      'Open Questions',
      'Validation Plan',
    ],
  },
  survey: {
    concise: [
      'Landscape Snapshot',
      'Key Findings Across Sources',
      'Suggested Follow-up',
    ],
    comprehensive: [
      'Landscape Snapshot',
      'Representative Methods',
      'Key Findings Across Sources',
      'Gaps & Controversies',
      'Suggested Follow-up',
    ],
  },
}

// ── Parsing helpers (shared by plan + draft tools) ────────────────────────

/** Extract the first balanced JSON object from a string. Tolerates:
 *  - plain object (`{...}`)
 *  - whole-string ```json fence
 *  - fence embedded anywhere (with prose before/after)
 *  - leading/trailing prose around a raw object
 *  Returns null only if no balanced `{...}` can be recovered from the input. */
export function extractFirstJsonObject(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const candidates: string[] = []
  const fenceAnywhere = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceAnywhere) candidates.push(fenceAnywhere[1].trim())
  candidates.push(trimmed)
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    if (start < 0) continue
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return candidate.slice(start, i + 1)
      }
    }
  }
  return null
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const text = extractFirstJsonObject(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** `a`/`b` may have overlapping ids; later wins on collision. Both inputs
 *  must already be normalized to the `Citation` shape. */
export function mergeCitations(a: Citation[], b: Citation[]): Citation[] {
  const byId = new Map<string, Citation>()
  for (const c of a) byId.set(c.id, c)
  for (const c of b) byId.set(c.id, c)
  return Array.from(byId.values())
}

export function slugify(input: string, fallback: string): string {
  const slug = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
  return slug || fallback
}

/** Stable workspace basename for a `research-report` envelope. The same
 *  helper must be used by plan / draft / finalize so the workspace view
 *  keeps pointing at one file as the report evolves. */
export function researchReportBasename(
  topic: string,
  artifactId: string,
): string {
  const suffix = artifactId.trim().slice(-6) || 'report'
  return `${slugify(topic, 'report')}-${suffix}`
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo
  return Math.max(lo, Math.min(hi, Math.round(value)))
}

// ── Tool schema helper ────────────────────────────────────────────────────

/** Thin wrapper to build a `ToolInputSchema` with required field list. Just
 *  avoids repeating the same object-shape boilerplate in each tool file. */
export function schema(
  properties: ToolInputSchema['properties'],
  required: string[],
): ToolInputSchema {
  return { type: 'object', properties, required }
}

export type { LocalTool }
