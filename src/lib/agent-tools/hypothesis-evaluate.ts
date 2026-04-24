// `hypothesis_evaluate` — auto-resolution of hypotheses based on
// accumulated evidence.
//
// Reviews all evidence for each target hypothesis, uses the LLM to update
// status (open → supported / refuted / inconclusive) and confidence, and
// generates a summary report and next-test recommendations.
//
// Re-evaluation policy:
//   - Specified hypothesisId → always re-evaluate.
//   - Full scan → evaluate `open` hypotheses + resolved ones with new
//     evidence (evidenceVersion > lastEvaluatedVersion). Skip `statusSource:
//     'manual'` to avoid overwriting deliberate user judgments.

import type { LocalTool } from '../../types/agent-tool'
import type {
  Hypothesis,
  HypothesisPayload,
  HypothesisStatus,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'
import {
  loadHypothesisPayload,
  parseJsonObject,
  schema,
  truncate,
} from './hypothesis-shared'

// ── Types ────────────────────────────────────────────────────────────────

interface Input {
  artifactId: string
  /** Evaluate only this hypothesis. Omit for all eligible ones. */
  hypothesisId?: string
}

interface Verdict {
  hypothesisId: string
  previousStatus: HypothesisStatus
  newStatus: HypothesisStatus
  previousConfidence: number
  newConfidence: number
  reasoning: string
  nextTests: string[]
}

interface Output {
  ok: true
  artifactId: string
  verdicts: Verdict[]
  summary: string
  statusChanges: number
}

// ── Tool ─────────────────────────────────────────────────────────────────

export const hypothesisEvaluateTool: LocalTool<Input, Output> = {
  name: 'hypothesis_evaluate',
  description:
    'Auto-resolution: reviews all accumulated evidence for hypotheses in an artifact, '
    + 'updates status (open→supported/refuted/inconclusive) and confidence scores, '
    + 'generates next-test recommendations, and produces a summary report. '
    + 'Call after hypothesis_gather_evidence has appended evidence.',
  cardMode: 'info',
  trustLevel: 'localWrite',
  contextParams: ['artifactId'],
  inputSchema: schema(
    {
      artifactId: {
        type: 'string',
        description: 'Hypothesis artifact id.',
      },
      hypothesisId: {
        type: 'string',
        description:
          'Evaluate only this hypothesis. Omit to evaluate all eligible ones.',
      },
    },
    ['artifactId'],
  ),

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    // ── Load artifact ─────────────────────────────────────────────
    const artifactId = typeof input?.artifactId === 'string'
      ? input.artifactId.trim()
      : ''
    if (!artifactId) throw new Error('artifactId is required')

    const { payload } = loadHypothesisPayload(ctx.sessionId, artifactId)

    // ── Determine evaluation targets ──────────────────────────────
    let targets: Hypothesis[]

    if (typeof input.hypothesisId === 'string' && input.hypothesisId.trim()) {
      // Explicit target — always re-evaluate
      const found = payload.hypotheses.find(
        (h) => h.id === input.hypothesisId,
      )
      if (!found) {
        throw new Error(
          `Hypothesis ${input.hypothesisId} not found in artifact ${artifactId}`,
        )
      }
      targets = [found]
    } else {
      // Full scan: open + resolved with new evidence, skip manual
      targets = payload.hypotheses.filter((h) => {
        if (h.statusSource === 'manual') return false
        if (h.status === 'open') return true
        // Re-evaluate if new evidence has been gathered since last evaluation
        const evVersion = h.evidenceVersion ?? 0
        const lastEval = h.lastEvaluatedVersion ?? 0
        return evVersion > lastEval
      })

      if (targets.length === 0) {
        throw new Error(
          'No hypotheses eligible for evaluation. '
          + 'All are either manually resolved or have no new evidence. '
          + 'Specify hypothesisId to force re-evaluation of a specific one.',
        )
      }
    }

    ctx.reportProgress?.({
      kind: 'status',
      message: `Evaluating ${targets.length} hypothesis(es)...`,
    })

    // ── Build evaluation prompt ───────────────────────────────────
    if (ctx.signal.aborted) throw new Error('Aborted before LLM call')

    const hypothesisBlocks = targets.map((h, i) => {
      const evidenceLines = h.evidence.length > 0
        ? h.evidence.map((e) =>
          `  - [${e.direction}] [${e.strength}] ${truncate(e.note, 150)}`
          + (e.sourceType ? ` (source: ${e.sourceType})` : ''),
        ).join('\n')
        : '  (no evidence gathered)'

      return [
        `### Hypothesis ${i + 1}: ${h.id}`,
        `Statement: "${h.statement}"`,
        `Current status: ${h.status}, confidence: ${h.confidence.toFixed(2)}`,
        `Evidence (${h.evidence.length} items):`,
        evidenceLines,
        `Current next tests: ${h.nextTests.length > 0 ? h.nextTests.join('; ') : '(none)'}`,
      ].join('\n')
    })

    const prompt = [
      'You are a senior materials scientist evaluating research hypotheses based on',
      'accumulated evidence.',
      '',
      `Topic: "${payload.topic}"`,
      '',
      'For each hypothesis below, you must:',
      '1. Weigh ALL evidence items, considering their strength and direction',
      '2. Determine the appropriate status:',
      '   - "supported": preponderance of strong/moderate evidence in favor,',
      '     no unaddressed strong counter-evidence',
      '   - "refuted": strong evidence directly contradicts the hypothesis',
      '   - "inconclusive": mixed/insufficient evidence, or only weak evidence',
      '   - "open": no evidence gathered yet (keep as-is)',
      '3. Assign a confidence score (0.0-1.0):',
      '   - 0.0-0.2: almost certainly false',
      '   - 0.2-0.4: likely false or very uncertain',
      '   - 0.4-0.6: genuinely uncertain / mixed evidence',
      '   - 0.6-0.8: likely true, moderate evidence',
      '   - 0.8-1.0: strong evidence in favor',
      '4. Provide 1-sentence reasoning for your verdict',
      '5. Suggest 1-3 specific next experiments/tests that would most',
      '   effectively resolve remaining uncertainty',
      '',
      '=== HYPOTHESES ===',
      '',
      hypothesisBlocks.join('\n\n'),
      '',
      'Return ONE JSON object:',
      '{',
      '  "verdicts": [',
      '    {',
      '      "hypothesisId": "hyp_xxx",',
      '      "status": "supported",',
      '      "confidence": 0.75,',
      '      "reasoning": "Strong XRD evidence confirms rutile phase; Raman corroborates.",',
      '      "nextTests": ["Temperature-dependent XRD to check phase stability"]',
      '    }',
      '  ],',
      '  "summary": "Overall 1-paragraph assessment of the hypothesis set."',
      '}',
    ].join('\n')

    const result = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: ctx.sessionId,
      tools: undefined,
    })

    if (!result.success) {
      throw new Error(`LLM evaluation failed: ${result.error ?? 'unknown error'}`)
    }

    // ── Parse response ────────────────────────────────────────────
    const parsed = parseJsonObject(result.content)
    if (!parsed) {
      throw new Error(
        'Failed to parse LLM evaluation response. Raw (truncated): '
        + result.content.slice(0, 200),
      )
    }

    const rawVerdicts = (parsed as { verdicts?: unknown[] }).verdicts
    if (!Array.isArray(rawVerdicts) || rawVerdicts.length === 0) {
      throw new Error('LLM returned no verdicts')
    }

    const summary = typeof (parsed as { summary?: unknown }).summary === 'string'
      ? ((parsed as { summary: string }).summary).trim()
      : 'Evaluation complete.'

    // ── Apply verdicts ────────────────────────────────────────────
    const now = Date.now()
    const verdicts: Verdict[] = []
    const updatedHypotheses = [...payload.hypotheses]
    let statusChanges = 0

    for (const raw of rawVerdicts) {
      if (!raw || typeof raw !== 'object') continue
      const v = raw as Record<string, unknown>

      const hypothesisId = typeof v.hypothesisId === 'string'
        ? v.hypothesisId.trim()
        : ''
      if (!hypothesisId) continue

      const idx = updatedHypotheses.findIndex((h) => h.id === hypothesisId)
      if (idx < 0) continue

      const hyp = updatedHypotheses[idx]
      const previousStatus = hyp.status
      const previousConfidence = hyp.confidence

      const newStatus = isValidStatus(v.status) ? v.status : hyp.status
      const newConfidence = typeof v.confidence === 'number'
        ? Math.max(0, Math.min(1, v.confidence))
        : hyp.confidence

      const reasoning = typeof v.reasoning === 'string'
        ? truncate(v.reasoning.trim(), 300)
        : ''

      const nextTests = Array.isArray(v.nextTests)
        ? (v.nextTests as unknown[])
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim())
            .slice(0, 3)
        : hyp.nextTests

      if (newStatus !== previousStatus) statusChanges++

      updatedHypotheses[idx] = {
        ...hyp,
        status: newStatus,
        confidence: newConfidence,
        nextTests,
        updatedAt: now,
        statusSource: 'auto',
        lastEvaluatedVersion: hyp.evidenceVersion ?? 0,
      }

      verdicts.push({
        hypothesisId,
        previousStatus,
        newStatus,
        previousConfidence,
        newConfidence,
        reasoning,
        nextTests,
      })
    }

    // ── Patch artifact ────────────────────────────────────────────
    if (verdicts.length > 0) {
      const store = useRuntimeStore.getState()
      store.patchArtifact(ctx.sessionId, artifactId, {
        payload: {
          ...payload,
          hypotheses: updatedHypotheses,
          evaluationSummary: summary,
          lastEvaluatedAt: now,
        } as never,
        updatedAt: now,
      })
    }

    return {
      ok: true,
      artifactId,
      verdicts,
      summary,
      statusChanges,
    }
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<HypothesisStatus>([
  'open',
  'supported',
  'refuted',
  'inconclusive',
])

function isValidStatus(v: unknown): v is HypothesisStatus {
  return typeof v === 'string' && VALID_STATUSES.has(v as HypothesisStatus)
}
