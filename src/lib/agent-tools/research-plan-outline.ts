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
  type LocalTool,
  type ReportSection,
  type ResearchMode,
  type ResearchReportPayload,
  type ResearchStyle,
} from './research-shared'
import {
  paperToCitation,
  paperSummaryLine,
  searchPapers,
  type Paper,
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

export const researchPlanOutlineTool: LocalTool<PlanInput, PlanOutput> = {
  name: 'research_plan_outline',
  description:
    "Step 1 of a research flow. Creates a new research-report artifact in the current session with an outline (empty section stubs) and status='planning'. Returns the new artifactId and sectionIds. After calling this, draft each section in order via research_draft_section, then call research_finalize_report. mode='research' for a focused brief, 'survey' for a literature landscape.",
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

    // Kick off literature retrieval in parallel with any outline LLM call —
    // both can take several seconds and they're independent. We re-await
    // `papersPromise` below so a slow search doesn't block the user seeing
    // the outline skeleton appear on the canvas.
    const papersPromise: Promise<Paper[]> = searchPapers(
      `${topic}${focus ? ` ${focus}` : ''}`,
      40,
    )

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
    const headings =
      generated && generated.length > 0 ? generated : fallbackHeadings
    if (ctx.signal.aborted) throw new Error('Aborted before artifact create')

    const sections: ReportSection[] = headings.map((heading, idx) => {
      const numbered = heading.match(/^\d+\.\s/)
        ? heading.trim()
        : `${idx + 1}. ${heading.trim()}`
      return {
        id: slugify(heading, `section-${idx + 1}`),
        heading: numbered,
        level: 1,
        markdown: '',
        citationIds: [],
        status: 'empty',
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

    // Harvest literature. `searchPapers` never throws — a silent empty list
    // just means the draft prompts fall back to un-grounded output.
    const papers = await papersPromise
    const citations: Citation[] = papers.map(paperToCitation)
    // Keep `paperSummaryLine` referenced so downstream tools can lazy-import
    // it without a dead-code lint; the plan prompt doesn't itself need the
    // summary (it just attaches the verified citations). Drafts use it.
    void paperSummaryLine

    const now = Date.now()
    const payload: ResearchReportPayload = {
      topic,
      mode,
      style,
      sections,
      citations,
      generatedAt: now,
      status: 'planning',
      currentSectionId: null,
    }

    const artifactId = genArtifactId()
    const title =
      mode === 'survey'
        ? `Literature Survey — ${topic}`
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
        const relPath = await ctx.orchestrator.emitArtifact(
          'research-report',
          payload,
          {
            basename: researchReportBasename(topic, artifactId),
            id: artifactId,
            meta: { title, artifactId, sessionId: ctx.sessionId },
          },
        )
        if (relPath) ctx.orchestrator.openFile(relPath)
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
        `Draft each section in turn via research_draft_section(artifactId="${artifactId}", sectionId=<id>). ` +
        `Then call research_finalize_report(artifactId="${artifactId}").`,
    }
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function outlineSectionRange(
  style: ResearchStyle,
): { min: number; max: number } {
  return style === 'comprehensive'
    ? { min: 4, max: 6 }
    : { min: 3, max: 4 }
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
}): Promise<string[] | null> {
  if (args.signal.aborted) return null

  const { min, max } = outlineSectionRange(args.style)
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
    '- Section headings should be short, concrete, and mutually distinct.',
    '- Prefer headings that surface the real dimensions, debates, mechanisms, cases, or comparisons implied by the topic.',
    '',
    'Fallback examples if you are unsure. Treat them only as a last resort, not a structure to copy:',
    args.fallbackHeadings.map((h, i) => `  ${i + 1}. ${h}`).join('\n'),
    '',
    'Return the outline as topic-specific section headings.',
    'Return ONE JSON object, no prose, no code fences:',
    '{ "headings": string[] }',
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
  const raw = (parsed as { headings?: unknown }).headings
  if (!Array.isArray(raw)) return null
  const headings = raw
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((h) => h.trim())
  if (headings.length === 0) return null
  // Guard against the model going wild on section count. We allow a small
  // dynamic range keyed to `style`, then clamp/pad within that range.
  if (headings.length > max) {
    return headings.slice(0, max)
  }
  while (headings.length < min) {
    headings.push(
      args.fallbackHeadings[headings.length] ?? `Section ${headings.length + 1}`,
    )
  }
  return headings
}

// Re-exported so the finalize tool can share dedup behaviour across the
// family without importing research-shared separately.
export { mergeCitations }
