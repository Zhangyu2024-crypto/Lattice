// `hypothesis_create` — create a new hypothesis artifact or append hypotheses
// to an existing one.
//
// Uses an inner LLM call to generate testable scientific hypotheses from the
// user's topic, session context (spectra, structures, papers), and optional
// extra context. The LLM is explicitly called without tools to prevent
// recursive tool invocations.
//
// Follows the same artifact-creation pattern as `research_plan_outline`:
//   1. Build context  →  2. Inner LLM call  →  3. Parse JSON
//   4. upsertArtifact  →  5. appendArtifactCardMessage

import type { LocalTool } from '../../types/agent-tool'
import type { Artifact, HypothesisPayload, Hypothesis } from '../../types/artifact'
import {
  useRuntimeStore,
  genArtifactId,
} from '../../stores/runtime-store'
import { sendLlmChat } from '../llm-chat'
import {
  genHypothesisId,
  buildSessionContextSummary,
  parseJsonObject,
  schema,
} from './hypothesis-shared'

// ── Types ────────────────────────────────────────────────────────────────

interface Input {
  topic: string
  /** Optional: append to an existing hypothesis artifact. */
  artifactId?: string
  /** Optional: extra observations or constraints to steer generation. */
  context?: string
  /** Number of hypotheses to generate. Default 3, max 6. */
  count?: number
}

interface Output {
  ok: true
  artifactId: string
  title: string
  hypothesisIds: string[]
  nextSteps: string
}

// ── Tool ─────────────────────────────────────────────────────────────────

export const hypothesisCreateTool: LocalTool<Input, Output> = {
  name: 'hypothesis_create',
  description:
    'Create a new hypothesis artifact (or add to an existing one). Uses the LLM to generate '
    + 'testable scientific hypotheses from a topic, the session\'s artifacts (spectra, '
    + 'structures, papers), and conversation context. Returns hypothesisIds for use with '
    + 'hypothesis_gather_evidence.',
  cardMode: 'info',
  trustLevel: 'localWrite',
  contextParams: ['artifactId'],
  inputSchema: schema(
    {
      topic: {
        type: 'string',
        description: 'Research question or topic to generate hypotheses for.',
      },
      artifactId: {
        type: 'string',
        description: 'Optional: existing hypothesis artifact id to append to.',
      },
      context: {
        type: 'string',
        description:
          'Optional extra context (observations, constraints) to steer hypothesis generation.',
      },
      count: {
        type: 'number',
        description: 'Number of hypotheses to generate (1-6). Default 3.',
      },
    },
    ['topic'],
  ),

  async execute(input, ctx) {
    if (ctx.signal.aborted) throw new Error('Aborted before start')

    // ── Validate input ────────────────────────────────────────────
    const topic = typeof input?.topic === 'string' ? input.topic.trim() : ''
    if (!topic) throw new Error('topic is required')

    const count = Math.max(1, Math.min(6, typeof input.count === 'number' ? input.count : 3))
    const extraContext =
      typeof input.context === 'string' && input.context.trim().length > 0
        ? input.context.trim()
        : null

    // ── Load existing artifact (if appending) ─────────────────────
    let existingPayload: HypothesisPayload | null = null
    let existingArtifactId: string | null = null

    if (typeof input.artifactId === 'string' && input.artifactId.trim()) {
      const session = useRuntimeStore.getState().sessions[ctx.sessionId]
      if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)
      const art = session.artifacts[input.artifactId]
      if (!art) throw new Error(`Artifact not found: ${input.artifactId}`)
      if (art.kind !== 'hypothesis') {
        throw new Error(
          `Artifact ${input.artifactId} is kind="${art.kind}", expected "hypothesis"`,
        )
      }
      existingPayload = art.payload as unknown as HypothesisPayload
      existingArtifactId = input.artifactId
    }

    // ── Build session context ─────────────────────────────────────
    const sessionSummary = buildSessionContextSummary(ctx.sessionId)

    // ── Build existing hypotheses context ─────────────────────────
    let existingHypContext = ''
    if (existingPayload && existingPayload.hypotheses.length > 0) {
      existingHypContext = '\n\nExisting hypotheses (do NOT duplicate these):\n'
        + existingPayload.hypotheses
          .map((h) => `- "${h.statement}" (${h.status}, confidence ${h.confidence.toFixed(2)})`)
          .join('\n')
    }

    // ── Inner LLM call ────────────────────────────────────────────
    if (ctx.signal.aborted) throw new Error('Aborted before LLM call')

    const prompt = [
      'You are a materials science research assistant specializing in spectroscopy',
      'and crystallography.',
      '',
      'The user\'s session contains these artifacts:',
      sessionSummary,
      existingHypContext,
      '',
      `Generate exactly ${count} testable scientific hypotheses about:`,
      `Topic: ${topic}`,
      ...(extraContext ? [`Additional context: ${extraContext}`] : []),
      '',
      'Requirements for each hypothesis:',
      '1. Write a clear, falsifiable statement grounded in the session\'s data',
      '2. Assign initial confidence (0.3-0.7, reflecting prior plausibility)',
      '3. Suggest 2-3 tags (material, technique, property keywords)',
      '4. Propose 1-2 initial next-tests that could confirm or refute it',
      '5. Avoid vague or un-testable statements',
      '',
      'Return ONE JSON object, no prose, no code fences:',
      '{',
      '  "hypotheses": [',
      '    {',
      '      "statement": "...",',
      '      "confidence": 0.5,',
      '      "tags": ["TiO2", "XRD", "phase-transition"],',
      '      "nextTests": ["Measure XRD at elevated temperature", "Check Raman for anatase/rutile bands"]',
      '    }',
      '  ]',
      '}',
    ].join('\n')

    const result = await sendLlmChat({
      mode: 'agent',
      userMessage: prompt,
      transcript: [],
      sessionId: ctx.sessionId,
      // Explicitly no tools — prevent inner tool loop.
      tools: undefined,
    })

    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error ?? 'unknown error'}`)
    }

    // ── Parse response ────────────────────────────────────────────
    const parsed = parseJsonObject(result.content)
    if (!parsed) {
      throw new Error(
        'Failed to parse LLM response as JSON. Raw content (truncated): '
        + result.content.slice(0, 200),
      )
    }

    const rawHypotheses = (parsed as { hypotheses?: unknown[] }).hypotheses
    if (!Array.isArray(rawHypotheses) || rawHypotheses.length === 0) {
      throw new Error('LLM returned no hypotheses')
    }

    // ── Map to typed Hypothesis objects ───────────────────────────
    const now = Date.now()
    const newHypotheses: Hypothesis[] = rawHypotheses
      .slice(0, count)
      .reduce<Hypothesis[]>((acc, raw) => {
        const r = raw as Record<string, unknown>
        const statement =
          typeof r.statement === 'string' ? r.statement.trim() : ''
        if (!statement) return acc

        const confidence = typeof r.confidence === 'number'
          ? Math.max(0, Math.min(1, r.confidence))
          : 0.5

        const tags = Array.isArray(r.tags)
          ? (r.tags as unknown[])
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => t.trim())
          : []

        const nextTests = Array.isArray(r.nextTests)
          ? (r.nextTests as unknown[])
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => t.trim())
          : []

        const hyp: Hypothesis = {
          id: genHypothesisId(),
          statement,
          status: 'open',
          confidence,
          createdAt: now,
          updatedAt: now,
          evidence: [],
          nextTests,
          tags,
          evidenceVersion: 0,
          statusSource: 'auto',
          lastEvaluatedVersion: 0,
        }
        acc.push(hyp)
        return acc
      }, [])

    if (newHypotheses.length === 0) {
      throw new Error('All hypotheses from LLM were invalid (empty statements)')
    }

    // ── Create or update artifact ─────────────────────────────────
    if (ctx.signal.aborted) throw new Error('Aborted before artifact write')

    const store = useRuntimeStore.getState()
    let artifactId: string
    let title: string

    if (existingArtifactId && existingPayload) {
      // Append to existing
      artifactId = existingArtifactId
      title = store.sessions[ctx.sessionId]?.artifacts[artifactId]?.title ?? `Hypotheses — ${topic}`
      const mergedHypotheses = [...existingPayload.hypotheses, ...newHypotheses]
      store.patchArtifact(ctx.sessionId, artifactId, {
        payload: {
          ...existingPayload,
          hypotheses: mergedHypotheses,
        } as never,
        updatedAt: now,
      })
    } else {
      // Create new artifact
      artifactId = genArtifactId()
      title = `Hypotheses — ${topic}`
      const payload: HypothesisPayload = {
        topic,
        hypotheses: newHypotheses,
      }
      const artifact: Artifact = {
        id: artifactId,
        kind: 'hypothesis',
        title,
        createdAt: now,
        updatedAt: now,
        payload: payload as never,
      } as Artifact
      store.upsertArtifact(ctx.sessionId, artifact)
      store.appendArtifactCardMessage(ctx.sessionId, artifactId)
    }

    // ── Workspace emit (Phase 7c) ─────────────────────────────────
    if (ctx.orchestrator?.fs) {
      try {
        const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        await ctx.orchestrator.emitArtifact(
          'hypothesis',
          { topic, hypotheses: newHypotheses },
          {
            basename: `hypothesis-${slug}-${artifactId}.json`,
            id: artifactId,
            meta: { title, artifactId, sessionId: ctx.sessionId },
          },
        )
      } catch (err) {
        console.warn('[hypothesis_create] workspace emit failed', err)
      }
    }

    // ── Return ────────────────────────────────────────────────────
    return {
      ok: true,
      artifactId,
      title,
      hypothesisIds: newHypotheses.map((h) => h.id),
      nextSteps:
        `Created ${newHypotheses.length} hypotheses. `
        + `Call hypothesis_gather_evidence(artifactId="${artifactId}") to search for evidence, `
        + `then hypothesis_evaluate(artifactId="${artifactId}") to update statuses.`,
    }
  },
}
