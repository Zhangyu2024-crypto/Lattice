// `research_finalize_report` — step 3 (final) of the Manus-style research
// flow.
//
// Consolidates a research-report artifact after all sections have been
// drafted:
//   - verifies each section.status === 'done' (warns caller if not)
//   - dedups citations by id
//   - drops citations not referenced by any section (keeps the reference
//     list focused on what actually appears in the body)
//   - validates every [@cite:X] token in any section has a matching citation
//   - flips artifact-level status to 'complete' and clears currentSectionId
//
// Crucially there is NO LLM call here — this is pure bookkeeping. Making
// finalize cheap + deterministic means the agent can call it confidently
// without worrying about token budget.

import { useRuntimeStore } from '../../stores/runtime-store'
import {
  researchReportBasename,
  schema,
  type Citation,
  type LocalTool,
  type ResearchReportPayload,
} from './research-shared'

interface FinalizeInput {
  artifactId: string
}

interface FinalizeOutput {
  ok: true
  artifactId: string
  sectionCount: number
  citationCount: number
  droppedCitations: number
  unresolvedTokens: string[]
  emptySections: string[]
  /** True when every section was drafted and every cite token resolves. */
  clean: boolean
}

const CITE_TOKEN_RE = /\[@cite:([a-zA-Z0-9_-]+)\]/g

export const researchFinalizeReportTool: LocalTool<
  FinalizeInput,
  FinalizeOutput
> = {
  name: 'research_finalize_report',
  description:
    "Step 3 (final) of a research flow. Consolidates a research-report artifact: dedups citations, drops citations that no section cites, validates cite tokens, and sets status='complete'. No LLM call — safe to invoke any time after sections are drafted. Returns a summary including any unresolved cite tokens or sections that weren't drafted.",
  inputSchema: schema(
    {
      artifactId: {
        type: 'string',
        description:
          'The research-report artifact to finalise (from research_plan_outline).',
      },
    },
    ['artifactId'],
  ),

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')
    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')

    const store = useRuntimeStore.getState()
    const artifact = store.sessions[ctx.sessionId]?.artifacts[artifactId]
    if (!artifact || artifact.kind !== 'research-report') {
      throw new Error(`research-report artifact not found: ${artifactId}`)
    }
    const payload = artifact.payload as unknown as ResearchReportPayload

    // Collect all cite tokens actually referenced by section bodies. Treat
    // this as the source of truth rather than section.citationIds, which
    // the LLM populates separately and may drift from the markdown.
    const referencedIds = new Set<string>()
    for (const section of payload.sections) {
      CITE_TOKEN_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = CITE_TOKEN_RE.exec(section.markdown)) !== null) {
        referencedIds.add(match[1])
      }
      for (const id of section.citationIds) referencedIds.add(id)
    }

    const byId = new Map<string, Citation>()
    for (const c of payload.citations) byId.set(c.id, c)

    const keptCitations: Citation[] = []
    const droppedIds: string[] = []
    for (const [id, citation] of byId.entries()) {
      if (referencedIds.has(id)) keptCitations.push(citation)
      else droppedIds.push(id)
    }

    const unresolvedTokens = Array.from(referencedIds).filter(
      (id) => !byId.has(id),
    )

    // Re-sync each section's citationIds to the subset that actually has
    // matching citation entries — reduces `[?]` placeholders in the card.
    const nextSections = payload.sections.map((section) => {
      const filteredIds = section.citationIds.filter((id) => byId.has(id))
      // Pick up any tokens we saw in the markdown but the section didn't
      // declare in citationIds — often a model drifts here. Dedup via Set.
      const extra = new Set<string>()
      CITE_TOKEN_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = CITE_TOKEN_RE.exec(section.markdown)) !== null) {
        if (byId.has(match[1]) && !filteredIds.includes(match[1])) {
          extra.add(match[1])
        }
      }
      const mergedIds = extra.size > 0 ? [...filteredIds, ...extra] : filteredIds
      return { ...section, citationIds: mergedIds }
    })

    const emptySections = nextSections
      .filter((s) => s.status !== 'done')
      .map((s) => s.id)

    const finalPayload: ResearchReportPayload = {
      ...payload,
      sections: nextSections,
      citations: keptCitations,
      status: 'complete',
      currentSectionId: null,
    }
    useRuntimeStore.getState().patchArtifact(ctx.sessionId, artifactId, {
      updatedAt: Date.now(),
      payload: finalPayload as never,
    })

    // Phase 7c — overwrite the workspace copy with the finalised payload.
    if (ctx.orchestrator?.fs) {
      try {
        await ctx.orchestrator.emitArtifact(
          'research-report',
          finalPayload,
          {
            basename: researchReportBasename(finalPayload.topic, artifactId),
            id: artifactId,
            meta: {
              title: artifact.title,
              artifactId,
              sessionId: ctx.sessionId,
            },
          },
        )
      } catch (err) {
        console.warn('[research_finalize_report] workspace emit failed', err)
      }
    }

    return {
      ok: true,
      artifactId,
      sectionCount: nextSections.length,
      citationCount: keptCitations.length,
      droppedCitations: droppedIds.length,
      unresolvedTokens,
      emptySections,
      clean: emptySections.length === 0 && unresolvedTokens.length === 0,
    }
  },
}
