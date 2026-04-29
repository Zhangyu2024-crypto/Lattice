// `research_continue_report` — long-running umbrella tool that drafts
// every remaining empty section of a research-report artifact in
// outline order, then runs refine, then finalize. The orchestrator
// surfaces this as one tool call so the LLM doesn't need to manage a
// per-section dispatch loop.
//
// Implementation deliberately reuses the per-step tools rather than
// duplicating their logic: it imports each LocalTool's `execute`
// closure and calls them in sequence, threading the same execution
// context. This keeps the behaviour bit-exact with the manual
// path (the only difference is who initiates the next call) and any
// fix to a per-step tool flows through automatically.

import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'
import type { ResearchReportPayload } from './research-shared'
import { researchDraftSectionTool } from './research-draft-section'
import { researchRefineReportTool } from './research-refine-report'
import { researchFinalizeReportTool } from './research-finalize-report'

interface Input {
  artifactId: string
  /** Optional cap on draft iterations to prevent runaway loops if
   *  draft_section ever stops advancing. Defaults to the section
   *  count + 4. */
  maxDraftLoops?: number
}

interface SectionResult {
  sectionId: string
  heading: string
  wordCount: number
  ok: boolean
  error?: string
}

interface Output {
  ok: true
  artifactId: string
  draftedSections: SectionResult[]
  refined: boolean
  finalized: boolean
  unresolvedCiteTokens: string[]
  emptySections: string[]
  warnings: string[]
}

const DEFAULT_TARGET_WORDS_BY_STYLE: Record<string, number> = {
  concise: 300,
  comprehensive: 850,
}

export const researchContinueReportTool: LocalTool<Input, Output> = {
  name: 'research_continue_report',
  description:
    'Long-running umbrella tool: drafts every remaining empty section of a research-report artifact in outline order, then refines and finalizes. Resumable — call again on the same artifactId after a partial run and it picks up where the prior call left off. Use research_draft_section only if you need section-by-section control.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description:
          'research-report artifact id returned by research_plan_outline.',
      },
      maxDraftLoops: {
        type: 'number',
        description:
          'Safety cap on draft iterations. Defaults to section count + 4.',
      },
    },
    required: ['artifactId'],
  },

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')
    const artifactId =
      typeof input?.artifactId === 'string' ? input.artifactId.trim() : ''
    if (!artifactId) throw new Error('artifactId is required')

    const initialPayload = readPayload(ctx.sessionId, artifactId)
    if (!initialPayload) {
      throw new Error(`research-report artifact not found: ${artifactId}`)
    }

    const sectionCount = initialPayload.sections.length
    const cap = clampLoopCap(input?.maxDraftLoops, sectionCount)
    const targetWords =
      DEFAULT_TARGET_WORDS_BY_STYLE[initialPayload.style] ?? 600

    const draftedSections: SectionResult[] = []
    const warnings: string[] = []

    for (let i = 0; i < cap; i++) {
      if (ctx.signal.aborted) break
      const payload = readPayload(ctx.sessionId, artifactId)
      if (!payload) break
      const next = payload.sections.find((s) => s.status === 'empty')
      if (!next) break

      try {
        const result = await researchDraftSectionTool.execute(
          {
            artifactId,
            sectionId: next.id,
            targetWords,
          },
          ctx,
        )
        draftedSections.push({
          sectionId: result.sectionId,
          heading: result.heading,
          wordCount: result.wordCount,
          ok: true,
        })
        if (!result.nextSectionId) break
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        draftedSections.push({
          sectionId: next.id,
          heading: next.heading,
          wordCount: 0,
          ok: false,
          error: msg,
        })
        warnings.push(`draft '${next.heading}' failed: ${msg}`)
        // Bail out of the loop on first hard error — rerunning the
        // umbrella tool will let the caller decide whether to skip the
        // bad section or fix the underlying issue.
        break
      }
    }

    let refined = false
    if (!ctx.signal.aborted && noEmpty(ctx.sessionId, artifactId)) {
      try {
        await researchRefineReportTool.execute({ artifactId }, ctx)
        refined = true
      } catch (err) {
        warnings.push(
          `refine pass failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    } else if (!noEmpty(ctx.sessionId, artifactId)) {
      warnings.push('skipped refine — some sections still empty')
    }

    let finalized = false
    let unresolvedCiteTokens: string[] = []
    let emptySections: string[] = []
    if (!ctx.signal.aborted) {
      try {
        const fin = await researchFinalizeReportTool.execute(
          { artifactId },
          ctx,
        )
        finalized = fin.clean
        unresolvedCiteTokens = fin.unresolvedTokens ?? []
        emptySections = fin.emptySections ?? []
        if (!fin.clean) {
          warnings.push('finalize completed with unresolved citations or empty sections')
        }
      } catch (err) {
        warnings.push(
          `finalize failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    return {
      ok: true,
      artifactId,
      draftedSections,
      refined,
      finalized,
      unresolvedCiteTokens,
      emptySections,
      warnings,
    }
  },
}

function readPayload(
  sessionId: string,
  artifactId: string,
): ResearchReportPayload | null {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const artifact = session?.artifacts[artifactId]
  if (!artifact || artifact.kind !== 'research-report') return null
  return artifact.payload as unknown as ResearchReportPayload
}

function noEmpty(sessionId: string, artifactId: string): boolean {
  const p = readPayload(sessionId, artifactId)
  if (!p) return false
  return p.sections.every((s) => s.status !== 'empty')
}

function clampLoopCap(value: unknown, sectionCount: number): number {
  const def = sectionCount + 4
  if (typeof value !== 'number' || !Number.isFinite(value)) return def
  return Math.max(1, Math.min(64, Math.floor(value)))
}
