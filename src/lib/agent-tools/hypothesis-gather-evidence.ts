// `hypothesis_gather_evidence` — auto-retrieval of evidence for hypotheses.
//
// Searches three sources in parallel (session artifacts, paper library RAG,
// web search), then uses an inner LLM call to evaluate each piece of
// evidence against the target hypotheses.
//
// Key design decisions:
//   - `Promise.allSettled` for all three retrieval paths — any one can fail
//     without blocking the others.
//   - Per-source timeouts prevent slow web requests from stalling the tool.
//   - Evidence notes are capped at 200 chars to control downstream token
//     budget when the tool output is fed back to the orchestrator.
//   - `cardMode: 'review'` — the user approves/rejects evidence before the
//     LLM sees it as a tool_result, but no custom editor is needed.

import type { LocalTool } from '../../types/agent-tool'
import type {
  Artifact,
  HypEvidence,
  Hypothesis,
  HypothesisPayload,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { callWorker } from '../worker-client'
import { sendLlmChat } from '../llm-chat'
import {
  loadHypothesisPayload,
  genEvidenceId,
  parseJsonObject,
  schema,
  isAnalysisArtifact,
  summarizeArtifactForEvidence,
  truncate,
} from './hypothesis-shared'

// ── Types ────────────────────────────────────────────────────────────────

interface Input {
  artifactId: string
  /** Gather for a single hypothesis. Omit to gather for all 'open' ones. */
  hypothesisId?: string
}

interface SourceDiagnostic {
  status: 'ok' | 'skipped' | 'error'
  count: number
  error?: string
}

interface GatheredSummary {
  hypothesisId: string
  statement: string
  newEvidenceCount: number
}

interface Output {
  ok: true
  artifactId: string
  gathered: GatheredSummary[]
  totalNewEvidence: number
  diagnostics: {
    artifacts: SourceDiagnostic
    papers: SourceDiagnostic
    web: SourceDiagnostic
  }
  nextSteps: string
}

// ── Constants ────────────────────────────────────────────────────────────

const ARTIFACT_TIMEOUT_MS = 5_000
const RAG_TIMEOUT_MS = 15_000
const WEB_TIMEOUT_MS = 10_000
const MAX_RAG_CHUNKS = 4
const MAX_WEB_RESULTS = 3
const EVIDENCE_NOTE_LIMIT = 200
const RAG_CHUNK_PREVIEW_LIMIT = 200
const WEB_SNIPPET_LIMIT = 150

// ── Tool ─────────────────────────────────────────────────────────────────

export const hypothesisGatherEvidenceTool: LocalTool<Input, Output> = {
  name: 'hypothesis_gather_evidence',
  description:
    'Auto-retrieval: given a hypothesis artifact (and optionally a specific hypothesis id), '
    + 'search for evidence across session artifacts (XRD/XPS/Raman results), papers in the '
    + 'library (via RAG), and web search. Evaluates each piece of evidence '
    + '(supports/refutes, strength) and appends to the hypothesis. The user reviews and '
    + 'approves gathered evidence before it is committed.',
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
          'Specific hypothesis id to gather evidence for. Omit to gather for all open hypotheses.',
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

    // ── Determine target hypotheses ───────────────────────────────
    let targets: Hypothesis[]
    if (typeof input.hypothesisId === 'string' && input.hypothesisId.trim()) {
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
      targets = payload.hypotheses.filter((h) => h.status === 'open')
      if (targets.length === 0) {
        throw new Error(
          'No open hypotheses to gather evidence for. '
          + 'Specify a hypothesisId to target a specific hypothesis.',
        )
      }
    }

    ctx.reportProgress?.({
      kind: 'status',
      message: `Gathering evidence for ${targets.length} hypothesis(es)...`,
    })

    // ── Three-source parallel retrieval ───────────────────────────
    const [artifactResult, ragResult, webResult] = await Promise.allSettled([
      gatherFromArtifacts(ctx.sessionId, ctx.signal),
      gatherFromPapers(payload.topic, targets, ctx.signal),
      gatherFromWeb(payload.topic, targets, ctx.signal),
    ])

    const artifactContext = settledValue(artifactResult, '')
    const ragContext = settledValue(ragResult, '')
    const webContext = settledValue(webResult, '')

    const diagnostics: Output['diagnostics'] = {
      artifacts: settledDiagnostic(artifactResult, artifactContext),
      papers: settledDiagnostic(ragResult, ragContext),
      web: settledDiagnostic(webResult, webContext),
    }

    ctx.reportProgress?.({
      kind: 'status',
      message: 'Evaluating evidence relevance with LLM...',
    })

    // ── Per-hypothesis LLM evaluation ─────────────────────────────
    if (ctx.signal.aborted) throw new Error('Aborted before LLM evaluation')

    const gathered: GatheredSummary[] = []
    const updatedHypotheses = [...payload.hypotheses]
    let totalNewEvidence = 0

    for (const target of targets) {
      if (ctx.signal.aborted) throw new Error('Aborted during evaluation loop')

      const newEvidence = await evaluateEvidenceForHypothesis(
        target,
        payload.topic,
        artifactContext,
        ragContext,
        webContext,
        ctx.sessionId,
        ctx.signal,
      )

      // Deduplicate against existing evidence
      const existingKeys = new Set(
        target.evidence.map((e) => `${e.sourceType ?? ''}:${e.note.slice(0, 50)}`),
      )
      const deduped = newEvidence.filter(
        (e) => !existingKeys.has(`${e.sourceType ?? ''}:${e.note.slice(0, 50)}`),
      )

      if (deduped.length > 0) {
        // Update the hypothesis in-place within our copy
        const idx = updatedHypotheses.findIndex((h) => h.id === target.id)
        if (idx >= 0) {
          const currentVersion = updatedHypotheses[idx].evidenceVersion ?? 0
          updatedHypotheses[idx] = {
            ...updatedHypotheses[idx],
            evidence: [...updatedHypotheses[idx].evidence, ...deduped],
            evidenceVersion: currentVersion + 1,
            updatedAt: Date.now(),
          }
        }
      }

      totalNewEvidence += deduped.length
      gathered.push({
        hypothesisId: target.id,
        statement: truncate(target.statement, 80),
        newEvidenceCount: deduped.length,
      })
    }

    // ── Patch artifact ────────────────────────────────────────────
    if (totalNewEvidence > 0) {
      const store = useRuntimeStore.getState()
      store.patchArtifact(ctx.sessionId, artifactId, {
        payload: { ...payload, hypotheses: updatedHypotheses } as never,
        updatedAt: Date.now(),
      })
    }

    return {
      ok: true,
      artifactId,
      gathered,
      totalNewEvidence,
      diagnostics,
      nextSteps: totalNewEvidence > 0
        ? `Found ${totalNewEvidence} new evidence items. `
          + `Call hypothesis_evaluate(artifactId="${artifactId}") to update hypothesis statuses.`
        : 'No new evidence found. Consider refining hypotheses or adding more data sources.',
    }
  },
}

// ── Source A: Session artifacts ──────────────────────────────────────────

async function gatherFromArtifacts(
  sessionId: string,
  signal: AbortSignal,
): Promise<string> {
  return withTimeout(ARTIFACT_TIMEOUT_MS, signal, async () => {
    const session = useRuntimeStore.getState().sessions[sessionId]
    if (!session) return ''
    const order = session.artifactOrder ?? []
    const lines: string[] = []
    for (const id of order) {
      if (lines.length >= 15) break
      const a = session.artifacts[id]
      if (!a || !isAnalysisArtifact(a)) continue
      const summary = summarizeArtifactForEvidence(a)
      if (summary) {
        lines.push(`[artifact:${id}] ${a.title ?? '(untitled)'}: ${summary}`)
      }
    }
    return lines.join('\n')
  })
}

// ── Source B: Paper library RAG ─────────────────────────────────────────

async function gatherFromPapers(
  topic: string,
  targets: Hypothesis[],
  signal: AbortSignal,
): Promise<string> {
  return withTimeout(RAG_TIMEOUT_MS, signal, async () => {
    // Check if worker is available
    const statusResult = await callWorker<{ ready: boolean }>('system.echo', {
      msg: 'ping',
    })
    if (!statusResult.ok) return ''

    // Build a combined query from topic + hypothesis statements
    const query = [
      topic,
      ...targets.slice(0, 3).map((t) => t.statement),
    ].join('. ')

    // We need documents for RAG. Try to get papers with PDF text via the
    // library IPC, but if that's unavailable (no Electron, no papers),
    // skip gracefully.
    const electronApi = (window as unknown as Record<string, unknown>).electronAPI as
      | { libraryListPapers?: (q: Record<string, unknown>) => Promise<Record<string, unknown>> }
      | undefined
    if (!electronApi?.libraryListPapers) return ''

    const listResult = await electronApi.libraryListPapers({ limit: 10 })
    const papers = (listResult?.papers ?? []) as Array<{
      id: number
      title?: string
      pdf_path?: string
    }>
    if (papers.length === 0) return ''

    // Read papers and build documents for RAG
    const documents: Array<{ id: number | string; text: string; title?: string }> = []
    for (const paper of papers.slice(0, 5)) {
      if (!paper.pdf_path) continue
      const readResult = await callWorker<{
        success: boolean
        full_text?: string
      }>('paper.read_pdf', { path: paper.pdf_path, paper_id: paper.id })
      if (readResult.ok && readResult.value.success && readResult.value.full_text) {
        documents.push({
          id: paper.id,
          title: paper.title,
          text: readResult.value.full_text,
        })
      }
    }
    if (documents.length === 0) return ''

    // Run RAG retrieval
    const ragResult = await callWorker<{
      success: boolean
      chunks?: Array<{
        doc_id: number | string
        doc_title: string | null
        text: string
        score: number
      }>
    }>('rag.retrieve', {
      question: query,
      documents,
      top_k: MAX_RAG_CHUNKS,
    })

    if (!ragResult.ok || !ragResult.value.success) return ''

    const chunks = ragResult.value.chunks ?? []
    return chunks
      .slice(0, MAX_RAG_CHUNKS)
      .map(
        (c) =>
          `[paper:${c.doc_id}] ${c.doc_title ?? '(unknown paper)'} `
          + `(relevance ${c.score.toFixed(2)}): ${truncate(c.text, RAG_CHUNK_PREVIEW_LIMIT)}`,
      )
      .join('\n')
  })
}

// ── Source C: Web search ────────────────────────────────────────────────

async function gatherFromWeb(
  topic: string,
  targets: Hypothesis[],
  signal: AbortSignal,
): Promise<string> {
  return withTimeout(WEB_TIMEOUT_MS, signal, async () => {
    const query = `${topic} ${targets[0]?.statement ?? ''}`
    const result = await callWorker<{
      success: boolean
      results?: Array<{
        title: string
        url: string
        snippet?: string
      }>
    }>('web.search', { query, max_results: MAX_WEB_RESULTS })

    if (!result.ok || !result.value.success) return ''

    const items = result.value.results ?? []
    return items
      .slice(0, MAX_WEB_RESULTS)
      .map(
        (r) =>
          `[web] ${r.title}: ${truncate(r.snippet ?? '', WEB_SNIPPET_LIMIT)} (${r.url})`,
      )
      .join('\n')
  })
}

// ── LLM evidence evaluation ─────────────────────────────────────────────

async function evaluateEvidenceForHypothesis(
  hypothesis: Hypothesis,
  topic: string,
  artifactContext: string,
  ragContext: string,
  webContext: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<HypEvidence[]> {
  // If no context from any source, skip the LLM call
  if (!artifactContext && !ragContext && !webContext) return []

  const prompt = [
    'You are evaluating evidence for a scientific hypothesis in materials science.',
    '',
    `Hypothesis: "${hypothesis.statement}"`,
    `Topic: "${topic}"`,
    `Current confidence: ${hypothesis.confidence}`,
    '',
    'Below are potential evidence sources. For EACH piece that is relevant,',
    'determine:',
    '1. direction: "supports" or "refutes"',
    '2. strength: "strong" (direct measurement/proof), "moderate" (indirect or',
    '   partial), or "weak" (suggestive/circumstantial)',
    '3. note: 1-2 sentence explanation of why this evidence is relevant',
    '4. sourceType: "artifact", "paper", or "web"',
    '5. sourceId: the bracket-prefixed id (e.g. "art_xxx" or paper id) or null',
    '',
    ...(artifactContext
      ? ['=== SESSION ARTIFACTS ===', artifactContext, '']
      : []),
    ...(ragContext
      ? ['=== PAPER LIBRARY (RAG) ===', ragContext, '']
      : []),
    ...(webContext
      ? ['=== WEB SEARCH ===', webContext, '']
      : []),
    'Return ONE JSON object:',
    '{',
    '  "evidence": [',
    '    {',
    '      "sourceType": "artifact" | "paper" | "web",',
    '      "sourceId": "art_xxx or paper_id or null",',
    '      "note": "1-2 sentence explanation...",',
    '      "direction": "supports",',
    '      "strength": "strong"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Only include genuinely relevant evidence. Do NOT force weak connections.',
    '- If no relevant evidence is found, return {"evidence": []}.',
    '- Keep each note under 200 characters.',
    '- Be precise about what the evidence shows vs. what it implies.',
  ].join('\n')

  const result = await sendLlmChat({
    mode: 'agent',
    userMessage: prompt,
    transcript: [],
    sessionId,
    tools: undefined,
  })

  if (!result.success) return []

  const parsed = parseJsonObject(result.content)
  if (!parsed) return []

  const rawEvidence = (parsed as { evidence?: unknown[] }).evidence
  if (!Array.isArray(rawEvidence)) return []

  const now = Date.now()
  return rawEvidence
    .filter((e): e is Record<string, unknown> => e != null && typeof e === 'object')
    .map((e): HypEvidence | null => {
      const note = typeof e.note === 'string' ? truncate(e.note.trim(), EVIDENCE_NOTE_LIMIT) : ''
      if (!note) return null

      const direction = e.direction === 'refutes' ? 'refutes' as const : 'supports' as const
      const strength =
        e.strength === 'strong'
          ? 'strong' as const
          : e.strength === 'weak'
            ? 'weak' as const
            : 'moderate' as const

      const sourceType =
        e.sourceType === 'paper'
          ? 'paper' as const
          : e.sourceType === 'web'
            ? 'web' as const
            : 'artifact' as const

      const artifactId =
        typeof e.sourceId === 'string' && e.sourceId.trim()
          ? e.sourceId.trim()
          : undefined

      return {
        id: genEvidenceId(),
        artifactId,
        sourceType,
        note,
        strength,
        direction,
        createdAt: now,
      }
    })
    .filter((e): e is HypEvidence => e !== null)
}

// ── Utility helpers ─────────────────────────────────────────────────────

function withTimeout<T>(
  ms: number,
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Retrieval timeout')), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    if (signal.aborted) {
      clearTimeout(timer)
      reject(new Error('Aborted'))
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    fn()
      .then((v) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      })
      .catch((err) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  return result.status === 'fulfilled' ? result.value : fallback
}

function settledDiagnostic(
  result: PromiseSettledResult<string>,
  context: string,
): SourceDiagnostic {
  if (result.status === 'rejected') {
    return {
      status: 'error',
      count: 0,
      error: result.reason instanceof Error
        ? result.reason.message
        : String(result.reason),
    }
  }
  if (!context) {
    return { status: 'skipped', count: 0 }
  }
  return { status: 'ok', count: context.split('\n').filter(Boolean).length }
}
