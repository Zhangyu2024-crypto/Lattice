// `research_draft_section` — step 2 of the Manus-style research flow.
//
// Given a research-report artifact id + section id, ask the LLM to draft
// that one section's markdown body and any citations it wants to cite. The
// artifact is then patched (not replaced) so only the target section
// transitions from 'empty' to 'done', while sibling sections keep whatever
// content they have (empty or finished).
//
// The LLM call is scoped to this section only — no cross-section context
// beyond the outline and any upstream sections that are already done — so
// each call is small, predictable, and cheap. If the user steers the flow
// mid-run (Phase B), only subsequent draft calls pick up the new direction.

import { useRuntimeStore } from '../../stores/runtime-store'
import type { Artifact } from '../../types/artifact'
import { sendLlmChat } from '../llm-chat'
import {
  clampInt,
  mergeCitations,
  parseJsonObject,
  researchReportBasename,
  schema,
  slugify,
  truncate,
  type Citation,
  type LocalTool,
  type ReportSection,
  type ResearchReportPayload,
} from './research-shared'
import { extractKeywords } from './research/paper-helpers'

interface DraftInput {
  artifactId: string
  sectionId: string
  /** Extra notes from the user or the orchestrator for just this section.
   *  Optional; omit for normal flow. */
  notes?: string
  /** Approximate word budget for this section body. Clamped [120, 1400]. */
  targetWords?: number
}

interface DraftOutput {
  ok: true
  artifactId: string
  sectionId: string
  heading: string
  wordCount: number
  addedCitations: number
  /** The NEXT sectionId in outline order that still needs drafting, or null
   *  if this was the last one. The orchestrator uses it to decide whether
   *  to call draft_section again or move on to finalize. */
  nextSectionId: string | null
}

const MIN_WORDS = 120
const MAX_WORDS = 1400

export const researchDraftSectionTool: LocalTool<DraftInput, DraftOutput> = {
  name: 'research_draft_section',
  description:
    "Step 2 of a research flow. Drafts the body of a single outlined section on an existing research-report artifact (created by research_plan_outline). Call once per section in outline order. The tool returns the NEXT section id that still needs drafting (or null when the last one is done) — use it to sequence subsequent calls. When null is returned, call research_finalize_report.",
  trustLevel: 'localWrite',
  cardMode: 'info',
  inputSchema: schema(
    {
      artifactId: {
        type: 'string',
        description:
          'The research-report artifact to patch — the one you got back from research_plan_outline.',
      },
      sectionId: {
        type: 'string',
        description:
          'The section to draft. Must be one of the ids returned in sectionIds by research_plan_outline.',
      },
      notes: {
        type: 'string',
        description:
          'Optional short guidance for this one section (e.g. "focus on oxygen-vacancy mechanism"). Omit unless the user steered recently.',
      },
      targetWords: {
        type: 'number',
        description:
          `Target body length for this section. Clamped to [${MIN_WORDS}, ${MAX_WORDS}]. Defaults by style: concise → 300, comprehensive → 850.`,
      },
    },
    ['artifactId', 'sectionId'],
  ),

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')
    const sectionId =
      typeof input?.sectionId === 'string' ? input.sectionId.trim() : ''
    if (!sectionId) throw new Error('sectionId is required')

    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)
    const artifact = session.artifacts[artifactId]
    if (!artifact || artifact.kind !== 'research-report') {
      throw new Error(`research-report artifact not found: ${artifactId}`)
    }
    const payload = artifact.payload as unknown as ResearchReportPayload
    const sectionIdx = payload.sections.findIndex((s) => s.id === sectionId)
    if (sectionIdx < 0) {
      throw new Error(
        `sectionId not found on artifact ${artifactId}: ${sectionId}`,
      )
    }
    const section = payload.sections[sectionIdx]

    const targetWords = clampInt(
      typeof input.targetWords === 'number'
        ? input.targetWords
        : payload.style === 'comprehensive'
          ? defaultDeepWordBudget(section)
          : 300,
      MIN_WORDS,
      MAX_WORDS,
    )

    // Mark section as drafting BEFORE the LLM call so the card immediately
    // shows the pulse. If the LLM call fails we revert; see the catch below.
    patchSection(ctx.sessionId, artifactId, sectionIdx, { status: 'drafting' }, {
      stage: 'Writing',
      status: 'drafting',
      currentSectionId: sectionId,
    })

    try {
      const priorSections = payload.sections
        .slice(0, sectionIdx)
        .filter((s) => s.status === 'done')
      // Grounded citations: payload.citations was populated at plan-time
      // by research_plan_outline (if Electron + literature-search were
      // available). Filter down to the ones most relevant to this
      // section's heading, then project to prompt-sized lines.
      const groundedCitations = selectRelevantCitations(
        payload.citations,
        section.heading,
      )
      const prompt = buildPrompt({
        payload,
        section,
        sectionIdx,
        priorSections,
        notes:
          typeof input.notes === 'string' && input.notes.trim().length > 0
            ? input.notes.trim()
            : null,
        targetWords,
        groundedCitations,
      })

      const llm = await sendLlmChat({
        mode: 'agent',
        userMessage: prompt,
        transcript: [],
        sessionId: ctx.sessionId,
        tools: undefined,
      })
      if (!llm.success) throw new Error(llm.error ?? 'LLM call failed')
      if (ctx.signal.aborted) throw new Error('Aborted after LLM call')

      let parsed = parseJsonObject(llm.content)
      if (!parsed) {
        // Retry once with a stricter reformat instruction. Some models (esp.
        // smaller ones) ignore "no prose, no code fences" the first time.
        const retry = await sendLlmChat({
          mode: 'agent',
          userMessage:
            'The previous response could not be parsed as JSON. Re-emit the section draft as ONE raw JSON object matching the schema I gave you — no prose, no code fences, starts with `{` and ends with `}`.\n\nPrevious response:\n' +
            llm.content,
          transcript: [],
          sessionId: ctx.sessionId,
          tools: undefined,
        })
        if (retry.success && !ctx.signal.aborted) {
          parsed = parseJsonObject(retry.content)
        }
      }
      if (!parsed) {
        throw new Error(
          'Could not parse section draft JSON from LLM response.',
        )
      }

      const markdown =
        typeof parsed.markdown === 'string' ? parsed.markdown.trim() : ''
      if (!markdown) throw new Error('LLM draft was empty.')

      const citationIds = Array.isArray(parsed.citationIds)
        ? (parsed.citationIds as unknown[]).filter(
            (v): v is string => typeof v === 'string' && v.trim().length > 0,
          )
        : []

      const newCitations = normaliseCitations(parsed.citations)

      // Compute the merged citations list and write everything in a single
      // patch so the card re-renders once with a consistent state.
      const mergedCitations = mergeCitations(payload.citations, newCitations)
      const nextSectionId = findNextSectionId(payload.sections, sectionIdx)

      const nextSections = payload.sections.map((s, i) => {
        if (i !== sectionIdx) return s
        return {
          ...s,
          markdown,
          citationIds,
          status: 'done' as const,
        }
      })

      const nextPayload: ResearchReportPayload = {
        ...payload,
        sections: nextSections,
        citations: mergedCitations,
        stage: 'Writing',
        status: 'drafting',
        currentSectionId: nextSectionId,
      }
      useRuntimeStore.getState().patchArtifact(ctx.sessionId, artifactId, {
        updatedAt: Date.now(),
        payload: nextPayload as never,
      })

      // Phase 7c — re-emit the updated payload to the same workspace file.
      // Stable `id` + basename mean writeEnvelope overwrites the prior copy,
      // so this is an envelope-level "patch in place" from Explorer's view.
      if (ctx.orchestrator?.fs) {
        try {
          await ctx.orchestrator.emitArtifact(
            'research-report',
            nextPayload,
            {
              basename: researchReportBasename(nextPayload.topic, artifactId),
              id: artifactId,
              meta: {
                title: artifact.title,
                artifactId,
                sessionId: ctx.sessionId,
              },
            },
          )
        } catch (err) {
          console.warn('[research_draft_section] workspace emit failed', err)
        }
      }

      const wordCount = markdown.split(/\s+/).filter(Boolean).length
      return {
        ok: true,
        artifactId,
        sectionId,
        heading: section.heading,
        wordCount,
        addedCitations: newCitations.length,
        nextSectionId,
      }
    } catch (err) {
      // Revert the section to 'empty' so a retry doesn't see a stuck
      // 'drafting' state. `currentSectionId` stays pointing at this section
      // so the UI can show an "error on §N — retry?" affordance later.
      patchSection(ctx.sessionId, artifactId, sectionIdx, { status: 'empty' })
      throw err
    }
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────


function defaultDeepWordBudget(section: ReportSection): number {
  if (section.level >= 2) return 650
  return 900
}

function findNextSectionId(
  sections: ReportSection[],
  justDraftedIdx: number,
): string | null {
  for (let i = justDraftedIdx + 1; i < sections.length; i++) {
    if (sections[i].status !== 'done') return sections[i].id
  }
  // Nothing after; check if any earlier section is still empty (e.g. user
  // skipped one). If yes, return it; otherwise we're done.
  for (let i = 0; i < justDraftedIdx; i++) {
    if (sections[i].status === 'empty') return sections[i].id
  }
  return null
}

/** Shallow-patch a single section AND optionally overwrite payload-level
 *  fields in the same store update. Splitting this out keeps the "mark
 *  drafting" pre-call and the "revert to empty" post-failure paths short. */
function patchSection(
  sessionId: string,
  artifactId: string,
  sectionIdx: number,
  sectionPatch: Partial<ReportSection>,
  payloadPatch?: Partial<ResearchReportPayload>,
): void {
  const store = useRuntimeStore.getState()
  const artifact = store.sessions[sessionId]?.artifacts[artifactId]
  if (!artifact || artifact.kind !== 'research-report') return
  const payload = artifact.payload as unknown as ResearchReportPayload
  const nextSections = payload.sections.map((s, i) =>
    i === sectionIdx ? { ...s, ...sectionPatch } : s,
  )
  store.patchArtifact(sessionId, artifactId, {
    payload: {
      ...payload,
      ...payloadPatch,
      sections: nextSections,
    } as never,
  })
}

/** Per-section relevance filter over a payload's already-verified citation
 *  pool. Uses the same CJK-aware keyword heuristic the CLI uses inside
 *  `_select_relevant_papers` so the surface is consistent across tools. */
function selectRelevantCitations(
  citations: Citation[],
  sectionHeading: string,
  limit = 14,
): Citation[] {
  if (citations.length === 0) return []
  const keywords = extractKeywords(sectionHeading)
  const scored = citations.map((c) => {
    const haystack =
      `${c.title} ${c.venue ?? ''} ${(c.authors ?? []).join(' ')}`.toLowerCase()
    let score = 0
    for (const kw of keywords) {
      if (haystack.includes(kw)) score += 1
    }
    return { c, score }
  })
  scored.sort((a, b) => b.score - a.score || b.c.year - a.c.year)
  // Always keep the 3 newest citations as a baseline in case no keyword hit —
  // cheap insurance against a section heading that happens to share zero
  // tokens with any title.
  const shortlist = scored.slice(0, limit).map((s) => s.c)
  if (shortlist.length < limit) {
    const byYear = [...citations].sort((a, b) => b.year - a.year)
    for (const c of byYear) {
      if (shortlist.length >= limit) break
      if (!shortlist.find((x) => x.id === c.id)) shortlist.push(c)
    }
  }
  return shortlist
}

function buildPrompt(args: {
  payload: ResearchReportPayload
  section: ReportSection
  sectionIdx: number
  priorSections: ReportSection[]
  notes: string | null
  targetWords: number
  groundedCitations: Citation[]
}): string {
  const modeIntent =
    args.payload.mode === 'survey'
      ? 'a neutral, comparative literature survey'
      : 'a focused, decision-oriented research brief'
  const priorSummary =
    args.priorSections.length > 0
      ? args.priorSections
          .map(
            (s) =>
              `  - ${s.heading}:\n${indent(truncate(stripHtml(s.markdown), 400), '      ')}`,
          )
          .join('\n')
      : '  (none — this is the first section drafted)'

  const hasGrounded = args.groundedCitations.length > 0
  const groundedBlock = hasGrounded
    ? args.groundedCitations
        .map((c) => {
          const first = c.authors[0] ?? 'Unknown'
          const etAl = c.authors.length > 1 ? ' et al.' : ''
          const venue = c.venue ? ` — ${c.venue}` : ''
          const doi = c.doi ? ` (doi:${c.doi})` : ''
          return `  - [@cite:${c.id}] ${first}${etAl} (${c.year || 'n.d.'}). "${c.title}"${venue}${doi}`
        })
        .join('\n')
    : '  (none — no literature grounding available; do NOT invent citations)'

  return [
    `You are drafting section ${args.sectionIdx + 1} of ${modeIntent}.`,
    '',
    `Topic:   ${args.payload.topic}`,
    `Style:   ${args.payload.style}`,
    `Section: ${args.section.heading}`,
    args.notes ? `Notes:   ${args.notes}` : null,
    '',
    'Already-drafted sections (for continuity — do not repeat):',
    priorSummary,
    '',
    'Grounded references available for this section (prefer these; their metadata is verified against OpenAlex / arXiv / Semantic Scholar / local Library):',
    groundedBlock,
    '',
    `Write about ${args.targetWords} words for this section only. Use [@cite:<id>] tokens inline for any claim that deserves a citation. Every token must have a matching entry in the "citations" array you return OR appear in the grounded list above (in which case it's already in the artifact — still list its id in citationIds, but you may omit it from the citations array you return).`,
    'Depth requirements:',
    '- Synthesize sources instead of listing them: compare assumptions, methods, datasets, and conclusions.',
    '- Include at least one concrete example, benchmark, mechanism, or case when the topic allows it.',
    '- Explicitly note uncertainty, limitations, or competing interpretations when evidence is mixed.',
    '- Avoid generic filler; every paragraph should add a distinct analytical point.',
    '',
    'Return ONE JSON object, no prose, no code fences:',
    '{',
    '  "markdown": string,           // the section body; no heading, it already exists',
    '  "citationIds": string[],      // every distinct [@cite:X] id you used',
    '  "citations": [                // ONLY new citations NOT in the grounded list above',
    '    {',
    '      "id": string,             // ASCII letters, digits, "_" or "-" only',
    '      "title": string,',
    '      "authors": string[],',
    '      "year": number,',
    '      "venue": string | null,',
    '      "doi": string | null      // null if not confident — do NOT invent DOIs',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    hasGrounded
      ? '- PREFER grounded references above. Cite them by their [@cite:<id>] token — do NOT add duplicates with new ids.'
      : '- No grounded references were provided; it is OK to return citationIds=[] and citations=[] rather than invent sources.',
    '- Any new citations you add (beyond the grounded list) will be marked unverified in the UI.',
    "- Do NOT include section headings in `markdown` — the card renders the heading from the outline.",
    '- Never claim browsing or live search capability.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function normaliseCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id || seen.has(id)) continue
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) continue
    seen.add(id)
    out.push({
      id,
      title,
      authors: Array.isArray(item.authors)
        ? item.authors.filter(
            (v): v is string => typeof v === 'string' && v.trim().length > 0,
          )
        : [],
      year:
        typeof item.year === 'number' && Number.isFinite(item.year)
          ? Math.round(item.year)
          : new Date().getFullYear(),
      venue:
        typeof item.venue === 'string' && item.venue.trim().length > 0
          ? item.venue.trim()
          : null,
      doi:
        typeof item.doi === 'string' && item.doi.trim().length > 0
          ? item.doi.trim()
          : null,
      url:
        typeof item.url === 'string' && item.url.trim().length > 0
          ? item.url.trim()
          : null,
      unverified: true,
    })
  }
  return out
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '')
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join('\n')
}
