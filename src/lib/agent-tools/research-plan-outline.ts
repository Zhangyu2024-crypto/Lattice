// `research_plan_outline` — step 1 of the Manus-style research flow.
//
// Creates a new research-report artifact in the active session with:
//   - topic / mode / style / citations=[]
//   - sections: one empty ReportSection per outline step, each status='empty'
//   - status: 'planning' (so the card renders a skeleton)
//
// The section list is planned by a small LLM call keyed to the user's
// topic + optional focus. The mode/style templates are now only soft
// fallbacks: they define rough breadth expectations and rescue malformed
// model output, but they should not lock every brief/survey into the same
// canned "Snapshot / Methods / Follow-up" shape.

import {
  useRuntimeStore,
  genArtifactId,
} from '../../stores/runtime-store'
import type { Artifact } from '../../types/artifact'
import { sendLlmChat } from '../llm-chat'
import {
  SECTION_TEMPLATES,
  mergeCitations,
  parseJsonObject,
  researchReportBasename,
  schema,
  slugify,
  type Citation,
  type ResearchInterviewMeta,
  type LocalTool,
  type ReportSection,
  type ResearchMode,
  type ResearchReportPayload,
  type ResearchStyle,
} from './research-shared'
import {
  paperToCitation,
  searchPapersForResearch,
} from './research/paper-helpers'

interface PlanInput {
  topic: string
  mode: ResearchMode
  style?: ResearchStyle
  focus?: string
}

interface PlanOutput {
  ok: true
  artifactId: string
  title: string
  mode: ResearchMode
  style: ResearchStyle
  sectionIds: string[]
  /** For the orchestrator's next turn — a reminder of what tools to call
   *  for each outline item. Cheap redundancy that keeps the model on plan. */
  nextSteps: string
}

export const RESEARCH_OUTLINE_DRAFT_LIMITS: Readonly<
  Record<ResearchStyle, number>
> = {
  concise: 8,
  comprehensive: 18,
}

export const researchPlanOutlineTool: LocalTool<PlanInput, PlanOutput> = {
  name: 'research_plan_outline',
  description:
    "Step 1 of a research flow. Creates a new research-report artifact in the current session with an outline (empty section stubs) and status='planning'. Returns the new artifactId and sectionIds. After calling this, prefer research_continue_report(artifactId) so long reports draft/refine/finalize inside one resumable tool call. Use research_draft_section only for manual section-by-section control. mode='research' for a focused brief, 'survey' for a literature landscape.",
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: schema(
    {
      topic: {
        type: 'string',
        description:
          'What the report is about. A concrete material, property, technique, or question works best.',
      },
      mode: {
        type: 'string',
        description:
          "'research' for a focused brief; 'survey' for a broader literature review.",
      },
      style: {
        type: 'string',
        description:
          "'concise' (default) for a shorter report, or 'comprehensive' for a broader one.",
      },
      focus: {
        type: 'string',
        description:
          'Optional user-supplied angle (e.g. "band-gap engineering") to steer the outline toward a specific emphasis.',
      },
    },
    ['topic', 'mode'],
  ),

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const topic =
      typeof input?.topic === 'string' ? input.topic.trim() : ''
    if (!topic) throw new Error('topic is required')
    const mode: ResearchMode = input.mode === 'survey' ? 'survey' : 'research'
    const style: ResearchStyle =
      input.style === 'comprehensive' ? 'comprehensive' : 'concise'
    const focus =
      typeof input.focus === 'string' && input.focus.trim().length > 0
        ? input.focus.trim()
        : null

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)

    const interview = await buildInterviewMeta({
      topic,
      mode,
      style,
      focus,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    })

    // CLI parity: run Interview, Retrieval and Outline as explicit phases. Retrieval uses
    // the same shape as lattice-cli's run_survey_pipeline: topic query,
    // review/survey query, LLM-generated variants, and a recency query.
    const variantsPromise = generateSearchVariants({
      topic,
      focus,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    })

    // Outline generation is topic-first now: always ask the model to plan
    // the actual section structure, then fall back to the legacy template
    // only if the response is unusable.
    const fallbackHeadings = [...SECTION_TEMPLATES[mode][style]]
    const generated = await generateOutline({
      topic,
      mode,
      style,
      focus,
      fallbackHeadings,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    })
    const headingSpecs =
      generated && generated.length > 0
        ? generated
        : fallbackHeadings.map((heading) => ({ heading, subsections: [] }))
    const draftableHeadingSpecs = limitOutlineToDraftBudget(
      headingSpecs,
      style,
    )
    if (ctx.signal.aborted) throw new Error('Aborted before artifact create')

    const sections: ReportSection[] = []
    draftableHeadingSpecs.forEach((spec, idx) => {
      const heading = spec.heading.trim()
      const numbered = heading.match(/^\d+\.\s/)
        ? heading
        : `${idx + 1}. ${heading}`
      sections.push({
        id: slugify(heading, `section-${idx + 1}`),
        heading: numbered,
        level: 1,
        markdown: '',
        citationIds: [],
        status: 'empty',
      })
      for (const [subIdx, sub] of spec.subsections.entries()) {
        const clean = sub.trim()
        if (!clean) continue
        sections.push({
          id: slugify(`${heading}-${clean}`, `section-${idx + 1}-${subIdx + 1}`),
          heading: `${idx + 1}.${subIdx + 1} ${clean.replace(/^\d+(?:\.\d+)?\s*/, '')}`,
          level: 2,
          markdown: '',
          citationIds: [],
          status: 'empty',
        })
      }
    })

    // Ensure ids are unique even if slugify collides (e.g. repeated words).
    const seen = new Set<string>()
    for (let i = 0; i < sections.length; i++) {
      let id = sections[i].id
      let suffix = 2
      while (seen.has(id)) id = `${sections[i].id}-${suffix++}`
      sections[i].id = id
      seen.add(id)
    }

    // Harvest literature. `searchPapersForResearch` never throws — a silent
    // empty list just means the draft prompts fall back to un-grounded output.
    const variantQueries = await variantsPromise
    const { papers, meta: retrieval } = await searchPapersForResearch({
      topic,
      focus,
      variantQueries,
      limitPerQuery: style === 'comprehensive' ? 70 : 35,
      maxQueries: style === 'comprehensive' ? 9 : 6,
    })
    const citations: Citation[] = papers.map(paperToCitation)

    const now = Date.now()
    const payload: ResearchReportPayload = {
      topic,
      mode,
      style,
      sections,
      citations,
      generatedAt: now,
      status: 'planning',
      stage: 'Outline',
      interview,
      currentSectionId: null,
      retrieval,
    }

    const artifactId = genArtifactId()
    const title =
      mode === 'survey'
        ? `Literature Research — ${topic}`
        : `Research Brief — ${topic}`

    const artifact: Artifact = {
      id: artifactId,
      kind: 'research-report',
      title,
      createdAt: now,
      updatedAt: now,
      payload: payload as never,
    } as Artifact

    const store = useRuntimeStore.getState()
    store.upsertArtifact(ctx.sessionId, artifact)
    store.appendArtifactCardMessage(ctx.sessionId, artifactId)

    // Phase 7c — mirror the artifact into the workspace so Explorer / file
    // watchers observe it; session-store remains the in-memory authority
    // for chain-consuming tools until Phase 7d cuts the read path over.
    if (ctx.orchestrator?.fs) {
      try {
        await ctx.orchestrator.emitArtifact(
          'research-report',
          payload,
          {
            basename: researchReportBasename(topic, artifactId),
            id: artifactId,
            meta: { title, artifactId, sessionId: ctx.sessionId },
          },
        )
      } catch (err) {
        console.warn('[research_plan_outline] workspace emit failed', err)
      }
    }

    return {
      ok: true,
      artifactId,
      title,
      mode,
      style,
      sectionIds: sections.map((s) => s.id),
      nextSteps:
        `Call research_continue_report(artifactId="${artifactId}") to draft remaining sections, refine, and finalize in one resumable workflow. ` +
        'Use research_draft_section only if the user asks for manual section-by-section control.',
    }
  },
}

async function buildInterviewMeta(args: {
  topic: string
  mode: ResearchMode
  style: ResearchStyle
  focus: string | null
  sessionId: string
  signal: AbortSignal
}): Promise<ResearchInterviewMeta> {
  const questions = [
    'What exact scope should the report prioritize?',
    'Which audience and depth should the writing target?',
    'Are there must-include papers, methods, datasets, or constraints?',
  ]
  const assumptions = [
    args.focus
      ? `Use the supplied focus: ${args.focus}.`
      : 'No extra focus was supplied; infer scope from the topic wording.',
    args.mode === 'survey'
      ? 'Treat the topic as a broad literature landscape.'
      : 'Treat the topic as a focused research brief.',
    args.style === 'comprehensive'
      ? 'Use a broader outline with subsection-level coverage.'
      : 'Keep the outline concise but still evidence-grounded.',
  ]
  return {
    questions,
    answers: [],
    assumptions,
  }
}

export interface OutlineSpec {
  heading: string
  subsections: string[]
}

async function generateSearchVariants(args: {
  topic: string
  focus: string | null
  sessionId: string
  signal: AbortSignal
}): Promise<string[]> {
  if (args.signal.aborted) return []
  const prompt = [
    'Generate 3 alternative academic literature search queries for this topic.',
    `Topic: ${args.topic}`,
    ...(args.focus ? [`User emphasis: ${args.focus}`] : []),
    '',
    'Rules:',
    '- Each query must preserve the topic; do not drift to adjacent fields.',
    '- Prefer concise keyword queries suitable for OpenAlex/arXiv.',
    '- Return ONE JSON object, no prose, no code fences:',
    '{ "queries": string[] }',
  ].join('\n')
  try {
    const result = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: args.sessionId,
      tools: undefined,
    })
    if (!result.success || args.signal.aborted) return []
    const parsed = parseJsonObject(result.content)
    const raw = parsed?.queries
    if (!Array.isArray(raw)) return []
    const topicKeywords = new Set(args.topic.toLowerCase().match(/[a-z][a-z0-9]{1,}/g) ?? [])
    return raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 5)
      .filter((value) => {
        if (topicKeywords.size === 0) return true
        const q = value.toLowerCase()
        for (const keyword of topicKeywords) if (q.includes(keyword)) return true
        return false
      })
      .slice(0, 3)
  } catch {
    return []
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function outlineSectionRange(
  style: ResearchStyle,
): { min: number; max: number } {
  return style === 'comprehensive'
    ? { min: 6, max: 8 }
    : { min: 4, max: 5 }
}

/** Ask the model to build a topic-specific outline. Returns null on any
 *  failure so callers can fall back to the mode/style defaults. */
async function generateOutline(args: {
  topic: string
  mode: ResearchMode
  style: ResearchStyle
  focus: string | null
  fallbackHeadings: readonly string[]
  sessionId: string
  signal: AbortSignal
}): Promise<OutlineSpec[] | null> {
  if (args.signal.aborted) return null

  const { min, max } = outlineSectionRange(args.style)
  const draftLimit = RESEARCH_OUTLINE_DRAFT_LIMITS[args.style]
  const modeIntent =
    args.mode === 'survey'
      ? 'a neutral, comparative literature survey'
      : 'a focused, decision-oriented research brief'
  const prompt = [
    `Plan the top-level outline for ${modeIntent}.`,
    '',
    `Topic: ${args.topic}`,
    `Mode: ${args.mode}`,
    `Breadth: ${args.style}`,
    ...(args.focus ? [`User emphasis: ${args.focus}`] : []),
    '',
    'Requirements:',
    '- Build the outline around the actual topic and user intent, not a canned universal template.',
    '- The domain may be scientific, historical, policy, geopolitical, or something else; use domain-appropriate headings.',
    '- Do NOT default to generic labels like Snapshot / Methods / Follow-up unless they genuinely fit this topic.',
    `- Use ${min}-${max} top-level sections.`,
    `- Keep the total number of draftable items (top-level sections plus subsections) at or below ${draftLimit}.`,
    '- Section headings should be short, concrete, and mutually distinct.',
    '- For comprehensive reports, create enough subsection headings to support a deep literature review: theory, representative methods, empirical evidence, disagreements, limitations, and open problems where relevant.',
    '- Prefer headings that surface the real dimensions, debates, mechanisms, cases, comparisons, evaluation criteria, and historical shifts implied by the topic.',
    '',
    'Fallback examples if you are unsure. Treat them only as a last resort, not a structure to copy:',
    args.fallbackHeadings.map((h, i) => `  ${i + 1}. ${h}`).join('\n'),
    '',
    'Return the outline as topic-specific section headings.',
    'Return ONE JSON object, no prose, no code fences:',
    '{ "sections": [{ "heading": string, "subsections": string[] }] }',
  ].join('\n')

  const result = await sendLlmChat({
    mode: 'agent',
    userMessage: prompt,
    transcript: [],
    sessionId: args.sessionId,
    // No tools on this inner call — we don't want the model to wander off
    // into list_artifacts / get_artifact when we only asked for an outline.
    tools: undefined,
  })
  if (!result.success) return null

  const parsed = parseJsonObject(result.content)
  if (!parsed) return null
  const rawSections = (parsed as { sections?: unknown; headings?: unknown }).sections
  const legacyHeadings = (parsed as { headings?: unknown }).headings
  const raw = Array.isArray(rawSections) ? rawSections : legacyHeadings
  if (!Array.isArray(raw)) return null
  const headings: OutlineSpec[] = raw
    .map((value): OutlineSpec | null => {
      if (typeof value === 'string' && value.trim()) {
        return { heading: value.trim(), subsections: [] }
      }
      if (!value || typeof value !== 'object') return null
      const item = value as Record<string, unknown>
      const heading = typeof item.heading === 'string' ? item.heading.trim() : ''
      if (!heading) return null
      const subsections = Array.isArray(item.subsections)
        ? item.subsections
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean)
            .slice(0, 4)
        : []
      return { heading, subsections }
    })
    .filter((value): value is OutlineSpec => value !== null)
  if (headings.length === 0) return null
  // Guard against the model going wild on section count. We allow a small
  // dynamic range keyed to `style`, then clamp/pad within that range.
  if (headings.length > max) {
    return headings.slice(0, max)
  }
  while (headings.length < min) {
    headings.push({
      heading: args.fallbackHeadings[headings.length] ?? `Section ${headings.length + 1}`,
      subsections: [],
    })
  }
  return headings
}

export function limitOutlineToDraftBudget(
  headings: readonly OutlineSpec[],
  style: ResearchStyle,
): OutlineSpec[] {
  const draftLimit = RESEARCH_OUTLINE_DRAFT_LIMITS[style]
  const base = headings
    .slice(0, draftLimit)
    .map((spec) => ({
      heading: spec.heading,
      subsections: style === 'comprehensive' ? [...spec.subsections] : [],
    }))
  let remainingSubsectionSlots = draftLimit - base.length
  if (remainingSubsectionSlots <= 0) {
    return base.map((spec) => ({ ...spec, subsections: [] }))
  }

  const counts = base.map(() => 0)
  for (let pass = 0; pass < 3 && remainingSubsectionSlots > 0; pass++) {
    for (let i = 0; i < base.length && remainingSubsectionSlots > 0; i++) {
      if (base[i].subsections.length <= counts[i]) continue
      counts[i] += 1
      remainingSubsectionSlots -= 1
    }
  }

  return base.map((spec, idx) => ({
    ...spec,
    subsections: spec.subsections.slice(0, counts[idx]),
  }))
}

// Re-exported so the finalize tool can share dedup behaviour across the
// family without importing research-shared separately.
export { mergeCitations }
