// Shared helpers for the hypothesis tool family
// (`hypothesis_create`, `hypothesis_gather_evidence`, `hypothesis_evaluate`).
//
// These three tools cooperate on a single hypothesis artifact that is
// created once and patched incrementally — evidence accumulates, then the
// evaluate tool reviews all evidence and updates statuses/confidence.
//
// Design decisions:
//   - Types are re-exported from `src/types/artifact.ts` — the artifact type
//     system is the single source of truth.
//   - Payload reads go through `loadHypothesisPayload` which validates the
//     artifact kind, so tools fail early with a clear error.
//   - Session context is summarized to a compact string to keep inner LLM
//     calls token-efficient (≤ 30 artifact lines, one-liner per artifact).

import type { ToolInputSchema } from '../../types/agent-tool'
import type {
  Artifact,
  HypothesisPayload,
  HypEvidence,
  Hypothesis,
} from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { parseJsonObject } from './research-shared'

// Re-export hypothesis types for convenient imports by the three tools.
export type {
  HypothesisPayload,
  HypEvidence,
  Hypothesis,
  HypothesisStatus,
  EvidenceStrength,
} from '../../types/artifact'

// ── Payload access ──────────────────────────────────────────────────────

/** Load a hypothesis artifact from the session store.
 *  Throws with a clear message if the artifact doesn't exist or has the
 *  wrong kind. */
export function loadHypothesisPayload(
  sessionId: string,
  artifactId: string,
): { artifact: Artifact; payload: HypothesisPayload } {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const artifact = session.artifacts[artifactId]
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
  if (artifact.kind !== 'hypothesis') {
    throw new Error(
      `Artifact ${artifactId} is kind="${artifact.kind}", expected "hypothesis"`,
    )
  }
  return {
    artifact,
    payload: artifact.payload as unknown as HypothesisPayload,
  }
}

// ── ID generation ───────────────────────────────────────────────────────

const random4 = () => Math.random().toString(36).slice(2, 6)

export function genHypothesisId(): string {
  return `hyp_${Date.now().toString(36)}_${random4()}`
}

export function genEvidenceId(): string {
  return `ev_${Date.now().toString(36)}_${random4()}`
}

// ── JSON parsing (reuse research-shared.parseJsonObject) ────────────────

export { parseJsonObject }

// ── Schema builder ──────────────────────────────────────────────────────

export function schema(
  properties: Record<string, { type: string; description?: string }>,
  required?: string[],
): ToolInputSchema {
  return { type: 'object', properties, required }
}

// ── Session context summary ─────────────────────────────────────────────

/** Build a compact one-liner-per-artifact summary of the session.
 *  Capped at 30 entries to keep inner LLM prompts token-efficient. */
export function buildSessionContextSummary(sessionId: string): string {
  const session = useRuntimeStore.getState().sessions[sessionId]
  if (!session) return '(no session context available)'
  const order = session.artifactOrder ?? []
  const lines: string[] = []
  for (const id of order) {
    if (lines.length >= 30) break
    const a = session.artifacts[id]
    if (!a) continue
    lines.push(`- [${a.kind}] "${a.title ?? '(untitled)'}"`)
  }
  return lines.length > 0
    ? lines.join('\n')
    : '(no artifacts in session)'
}

// ── Artifact evidence summaries ─────────────────────────────────────────
//
// Each summarizer extracts a compact string from a specific artifact kind's
// payload. The string is injected into the LLM prompt for evidence
// evaluation. Returns null for unsupported kinds.

const ANALYSIS_KINDS = new Set([
  'xrd-pro',
  'xps-pro',
  'raman-pro',
  'spectrum-pro',
  'xrd-analysis',
  'xps-analysis',
  'raman-id',
  'peak-fit',
  'structure',
])

export function isAnalysisArtifact(a: Artifact): boolean {
  return ANALYSIS_KINDS.has(a.kind)
}

/** Produce a compact evidence summary for an analysis artifact.
 *  Returns null for unsupported kinds — callers should skip those. */
export function summarizeArtifactForEvidence(artifact: Artifact): string | null {
  const p = artifact.payload as Record<string, unknown>
  if (!p) return null

  switch (artifact.kind) {
    case 'xrd-pro':
      return summarizeXrdPro(p)
    case 'xps-pro':
      return summarizeXpsPro(p)
    case 'raman-pro':
      return summarizeRamanPro(p)
    case 'spectrum-pro':
      return summarizeSpectrumPro(p)
    case 'structure':
      return summarizeStructure(p)
    case 'xrd-analysis':
    case 'xps-analysis':
    case 'raman-id':
    case 'peak-fit':
      return summarizeGenericAnalysis(artifact)
    default:
      return null
  }
}

function summarizeXrdPro(p: Record<string, unknown>): string {
  const candidates = p.candidates as
    | Array<{ selected?: boolean; formula?: string; name?: string; score?: number }>
    | undefined
  const phases = (candidates ?? [])
    .filter((c) => c.selected)
    .map((c) => `${c.formula ?? c.name ?? '?'} (score ${c.score?.toFixed(2) ?? '?'})`)
    .join(', ')
  const refine = p.refineResult as { rwp?: number } | undefined
  const rwp = refine?.rwp != null ? `Rwp=${refine.rwp.toFixed(1)}%` : 'no refinement'
  return `XRD phases: ${phases || 'none identified'}; ${rwp}`
}

function summarizeXpsPro(p: Record<string, unknown>): string {
  const peaks = p.detectedPeaks as Array<{ label?: string }> | undefined
  const elements = (peaks ?? [])
    .map((pk) => pk.label)
    .filter(Boolean)
    .join(', ')
  const fit = p.fitResult as { quantification?: Array<{ element: string; atomic_percent: number }> } | undefined
  const quant = fit?.quantification
    ?.map((q) => `${q.element}: ${q.atomic_percent.toFixed(1)}at%`)
    .join(', ')
  return `XPS elements: ${elements || 'none'}; quantification: ${quant || 'not done'}`
}

function summarizeRamanPro(p: Record<string, unknown>): string {
  const matches = p.matches as Array<{ name: string; score?: number }> | undefined
  const items = (matches ?? [])
    .map((m) => `${m.name} (score ${m.score?.toFixed(2) ?? '?'})`)
    .join(', ')
  return `Raman matches: ${items || 'none'}`
}

function summarizeSpectrumPro(p: Record<string, unknown>): string {
  const peaks = p.peaks as Array<{ position?: number }> | undefined
  const count = peaks?.length ?? 0
  const positions = (peaks ?? [])
    .slice(0, 5)
    .map((pk) => pk.position?.toFixed(1))
    .filter(Boolean)
    .join(', ')
  return `Spectrum: ${count} peaks detected${positions ? ` at ${positions}` : ''}`
}

function summarizeStructure(p: Record<string, unknown>): string {
  const formula = p.formula as string | undefined
  const spaceGroup = p.spaceGroup as string | undefined
  return `Structure: ${formula ?? '?'}, space group ${spaceGroup ?? '?'}`
}

function summarizeGenericAnalysis(artifact: Artifact): string {
  return `[${artifact.kind}] "${artifact.title ?? '(untitled)'}"`
}

// ── Output truncation helpers ───────────────────────────────────────────

/** Truncate a string to `maxLen` characters, appending '...' if clipped. */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}
