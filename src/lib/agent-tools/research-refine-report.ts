// `research_refine_report` — continuity + self-audit pass on a drafted
// research-report artifact.
//
// Two responsibilities:
//   1. Run a single LLM audit pass that reviews every drafted section
//      jointly (cross-section consistency, missing transitions,
//      orphaned citations, claims without evidence). The auditor
//      returns a structured warning list, not a rewrite.
//   2. Stamp the artifact with `stage: 'Refinement'` and persist the
//      audit findings so finalize can consume them via the existing
//      `assembly.qualityAudit` channel.
//
// Refine is intentionally non-destructive: it never edits section
// markdown. If a section needs a real rewrite, the caller should
// re-run `research_draft_section` for that section before finalize.
// This split keeps the umbrella `research_continue_report` flow
// idempotent — a second call after a partial run only redoes work
// that was actually missing.

import { useRuntimeStore } from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'
import {
  parseJsonObject,
  type LocalTool,
  type ResearchReportPayload,
} from './research-shared'

interface Input {
  artifactId: string
}

interface RefineWarning {
  severity: 'info' | 'warning'
  scope: 'section' | 'cross-section' | 'citation'
  sectionId?: string
  message: string
}

interface Output {
  ok: true
  artifactId: string
  warnings: RefineWarning[]
  /** Section ids the auditor flagged as needing a rewrite (severity =
   *  'warning' on a single section). Caller can decide whether to
   *  redraft them. */
  sectionsToRedraft: string[]
}

const MAX_BODY_CHARS = 50_000
const MAX_WARNINGS = 20

export const researchRefineReportTool: LocalTool<Input, Output> = {
  name: 'research_refine_report',
  description:
    'Continuity + self-audit pass on a drafted research-report artifact. Runs one LLM review across all sections jointly and stamps the artifact with stage="Refinement". Non-destructive — never edits section markdown. Returns warnings + ids of sections that should be redrafted before finalize.',
  trustLevel: 'localWrite',
  cardMode: 'info',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'research-report artifact id (from research_plan_outline).',
      },
    },
    required: ['artifactId'],
  },

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

    const warnings = await runAudit({
      payload,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    })

    const sectionsToRedraft = Array.from(
      new Set(
        warnings
          .filter((w) => w.severity === 'warning' && w.scope === 'section' && w.sectionId)
          .map((w) => w.sectionId as string),
      ),
    )

    // Persist the audit findings on the artifact so finalize / the
    // user-facing card can surface them. We piggy-back on the existing
    // `assembly` slot rather than introducing a new field.
    const nextPayload: ResearchReportPayload = {
      ...payload,
      stage: 'Refinement',
      assembly: {
        ...(payload.assembly ?? {}),
        qualityAudit: {
          summary:
            warnings.length === 0
              ? 'No issues detected during the refinement pass.'
              : `${warnings.length} issue${warnings.length === 1 ? '' : 's'} flagged during refinement.`,
          warnings: warnings.map(formatWarning),
        },
      },
    }
    store.patchArtifact(ctx.sessionId, artifactId, {
      updatedAt: Date.now(),
      payload: nextPayload as never,
    })

    return {
      ok: true,
      artifactId,
      warnings,
      sectionsToRedraft,
    }
  },
}

async function runAudit(args: {
  payload: ResearchReportPayload
  sessionId: string
  signal: AbortSignal
}): Promise<RefineWarning[]> {
  if (args.signal.aborted) return []
  const drafted = args.payload.sections.filter((s) => s.status === 'done')
  if (drafted.length === 0) return []

  const body = drafted
    .map((s) => `### [${s.id}] ${s.heading}\n\n${s.markdown}`)
    .join('\n\n')
    .slice(0, MAX_BODY_CHARS)

  const citationLookup = args.payload.citations
    .slice(0, 120)
    .map((c) => `${c.id}: ${c.authors.join(', ')} (${c.year}) — ${c.title}`)
    .join('\n')

  const prompt = [
    'You are auditing a multi-section research report for continuity, citation hygiene, and analytical depth.',
    `Topic: ${args.payload.topic}`,
    `Mode: ${args.payload.mode} | Style: ${args.payload.style}`,
    '',
    'Draft sections (only sections with status=done are included):',
    body || '(empty)',
    '',
    'Available citations (id: authors year — title):',
    citationLookup || '(none)',
    '',
    'Return ONE JSON object, no prose, no code fences:',
    '{ "warnings": Array<{ "severity": "info" | "warning", "scope": "section" | "cross-section" | "citation", "sectionId"?: string, "message": string }> }',
    '',
    'Guidance:',
    '- severity="warning" means the section or report needs corrective action before finalize.',
    '- severity="info" is for minor observations the writer can choose to act on.',
    '- scope="section" requires sectionId.',
    '- Flag claims that lack a [@cite:id] reference where one is clearly needed.',
    '- Flag cross-section repetition or contradictions explicitly.',
    '- Be concise; under 20 warnings total.',
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
    if (!parsed) return []
    const raw = Array.isArray(parsed.warnings) ? parsed.warnings : []
    const out: RefineWarning[] = []
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const severity = e.severity === 'warning' ? 'warning' : 'info'
      const scope =
        e.scope === 'cross-section' || e.scope === 'citation' ? e.scope : 'section'
      const sectionId =
        typeof e.sectionId === 'string' && e.sectionId.length > 0
          ? e.sectionId
          : undefined
      const message = typeof e.message === 'string' ? e.message.trim() : ''
      if (!message) continue
      out.push({ severity, scope, sectionId, message })
      if (out.length >= MAX_WARNINGS) break
    }
    return out
  } catch {
    return []
  }
}

function formatWarning(w: RefineWarning): string {
  const where =
    w.scope === 'section' && w.sectionId
      ? `[${w.sectionId}] `
      : w.scope === 'cross-section'
      ? '[cross-section] '
      : w.scope === 'citation'
      ? '[citation] '
      : ''
  const tag = w.severity === 'warning' ? '⚠ ' : '· '
  return `${tag}${where}${w.message}`
}
