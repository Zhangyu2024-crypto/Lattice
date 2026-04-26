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
import { useRuntimeStore } from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'
import {
  parseJsonObject,
  researchReportBasename,
  schema,
  type Citation,
  type LocalTool,
  type ResearchAssemblyMeta,
  type ResearchExportMeta,
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
    "Step 3 (final) of a research flow. Runs the Assembly phase, matching lattice-cli's research pipeline: dedups and validates citations, generates abstract/keywords/methodology/quality-audit metadata, and sets status='complete'. Returns unresolved cite tokens or sections that weren't drafted.",
  trustLevel: 'localWrite',
  cardMode: 'info',
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

    const draftPayload: ResearchReportPayload = {
      ...payload,
      sections: nextSections,
      citations: keptCitations,
      stage: 'Assembly',
      status: 'drafting',
      currentSectionId: null,
    }
    useRuntimeStore.getState().patchArtifact(ctx.sessionId, artifactId, {
      updatedAt: Date.now(),
      payload: draftPayload as never,
    })

    const assembly = await buildAssemblyMeta({
      payload: draftPayload,
      emptySections,
      unresolvedTokens,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    })

    const finalPayload: ResearchReportPayload = {
      ...draftPayload,
      assembly,
      export: buildExportMeta(draftPayload, emptySections, unresolvedTokens),
      stage: 'Complete',
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


function buildExportMeta(
  payload: ResearchReportPayload,
  emptySections: string[],
  unresolvedTokens: string[],
): ResearchExportMeta {
  const notes: string[] = []
  if (emptySections.length > 0) notes.push('PDF export should wait until all sections are drafted.')
  if (unresolvedTokens.length > 0) notes.push('PDF export should wait until citation tokens resolve.')
  if (payload.citations.some((citation) => citation.unverified)) {
    notes.push('Some references are unverified; check them before LaTeX/PDF publication.')
  }
  return {
    markdownReady: true,
    latexReady: emptySections.length === 0 && unresolvedTokens.length === 0,
    pdfPipeline:
      'Use the research report export surface to generate Markdown now; LaTeX/PDF export can consume the same normalized sections, references, abstract, methodology, and audit metadata.',
    notes,
  }
}

async function buildAssemblyMeta(args: {
  payload: ResearchReportPayload
  emptySections: string[]
  unresolvedTokens: string[]
  sessionId: string
  signal: AbortSignal
}): Promise<ResearchAssemblyMeta> {
  if (args.signal.aborted) throw new Error('Aborted before assembly')
  const body = args.payload.sections
    .map((section) => `## ${section.heading}\n\n${section.markdown}`)
    .join('\n\n')
    .slice(0, 50000)
  const references = args.payload.citations
    .slice(0, 120)
    .map((citation, index) => {
      const authors = citation.authors.join(', ')
      const venue = citation.venue ? ` ${citation.venue}.` : ''
      return `[${index + 1}] ${authors} (${citation.year}). ${citation.title}.${venue}`
    })
    .join('\n')
  const retrieval = args.payload.retrieval
  const prompt = [
    'Assemble final research-report metadata in the same spirit as lattice-cli /research, including citation verification, synthesis-depth audit, and self-audit.',
    `Topic: ${args.payload.topic}`,
    `Mode: ${args.payload.mode}`,
    '',
    'Retrieval metadata:',
    retrieval
      ? JSON.stringify({
          queries: retrieval.queries,
          papersUsed: retrieval.papersUsed,
          yearRange: retrieval.yearRange,
          sourcesUsed: retrieval.sourcesUsed,
        })
      : 'No retrieval metadata available.',
    '',
    'Draft report body:',
    body || '(empty)',
    '',
    'References:',
    references || '(none)',
    '',
    'Return ONE JSON object, no prose, no code fences:',
    '{ "abstract": string, "keywords": string[], "methodology": string, "qualityAudit": { "summary": string, "warnings": string[] } }',
    '',
    'Quality audit must comment on: evidence coverage, citation density, unresolved disagreements, and whether the report is analytical rather than merely descriptive.',
  ].join('\n')
  try {
    const result = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: args.sessionId,
      tools: undefined,
    })
    if (!result.success || args.signal.aborted) return fallbackAssembly(args)
    const parsed = parseJsonObject(result.content)
    if (!parsed) return fallbackAssembly(args)
    const abstract = typeof parsed.abstract === 'string' ? parsed.abstract.trim() : ''
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 12)
      : []
    const methodology =
      typeof parsed.methodology === 'string' ? parsed.methodology.trim() : ''
    const rawAudit = parsed.qualityAudit
    const auditObj = rawAudit && typeof rawAudit === 'object' && !Array.isArray(rawAudit)
      ? rawAudit as Record<string, unknown>
      : {}
    const warnings = Array.isArray(auditObj.warnings)
      ? auditObj.warnings
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      : []
    if (args.emptySections.length > 0) {
      warnings.push(`Undrafted sections: ${args.emptySections.join(', ')}`)
    }
    if (args.unresolvedTokens.length > 0) {
      warnings.push(`Unresolved citation tokens: ${args.unresolvedTokens.join(', ')}`)
    }
    return {
      abstract,
      keywords,
      methodology,
      qualityAudit: {
        summary:
          typeof auditObj.summary === 'string' && auditObj.summary.trim()
            ? auditObj.summary.trim()
            : 'Assembly completed; review citation density and section completeness before export.',
        warnings,
      },
    }
  } catch {
    return fallbackAssembly(args)
  }
}

function fallbackAssembly(args: {
  payload: ResearchReportPayload
  emptySections: string[]
  unresolvedTokens: string[]
}): ResearchAssemblyMeta {
  const warnings: string[] = []
  if (args.emptySections.length > 0) {
    warnings.push(`Undrafted sections: ${args.emptySections.join(', ')}`)
  }
  if (args.unresolvedTokens.length > 0) {
    warnings.push(`Unresolved citation tokens: ${args.unresolvedTokens.join(', ')}`)
  }
  return {
    methodology: args.payload.retrieval
      ? `Searched ${args.payload.retrieval.sourcesUsed.join(', ') || 'available literature sources'} with ${args.payload.retrieval.queries.length} queries across online and local Library sources; retained ${args.payload.retrieval.papersUsed} papers from ${args.payload.retrieval.totalRetrieved} retrieved candidates.`
      : undefined,
    qualityAudit: {
      summary: 'Assembly completed without an additional LLM audit.',
      warnings,
    },
  }
}
