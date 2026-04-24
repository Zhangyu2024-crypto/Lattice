// XRD phase identification pipeline — element subset expansion + peak
// match retrieval + LLM adjudication. Ported from
// lattice-cli/workflow/xrd-phase-id-standalone/src/identifier.py.
//
// Two callsites share this pipeline so their behavior stays identical:
//   1. The agent tool `xrd_search_phases` (src/lib/agent-tools/…).
//   2. The Inspector's "Search Phase DB" button
//      (src/components/canvas/artifacts/pro/modules/xrd/index.tsx).
//
// Retrieval is delegated to the worker — `localProXrd.search()` now
// expects elements and does subset expansion server-side — so this
// module owns only the LLM side of the flow plus some shaping on the
// returned candidates.

import { localProXrd } from './local-pro-xrd'
import { sendLlmChat } from './llm-chat'
import { useLLMConfigStore } from '../stores/llm-config-store'
import type {
  ProWorkbenchSpectrum,
  XrdProCandidate,
  XrdProIdentification,
  XrdProPeak,
} from '../types/artifact'

const MAX_LLM_CANDIDATES = 30

const SYSTEM_PROMPT = `You are an expert in X-ray diffraction (XRD) phase identification.
Your task is to identify which crystalline phase(s) are present in the experimental XRD pattern.

Given:
1. Experimental XRD peaks (2θ angles and relative intensities)
2. A list of candidate phases with their standard diffraction patterns

Analyze the peak positions and intensities to determine the best matching phase(s).

Key considerations:
- Peak positions may have small shifts (±0.2°) due to instrument calibration or sample displacement.
- Relative intensities may vary due to preferred orientation effects.
- Strong peaks (intensity > 50%) are more reliable for identification.
- The sample may contain multiple phases (mixture); their peaks will overlap.

Respond with a JSON object (no markdown code blocks):
{
  "predicted_phases": ["material_id_1", "material_id_2"],
  "confidence": 0.85,
  "reasoning": "Brief explanation of why these phases were selected"
}

Rules:
- predicted_phases: list of material IDs that best match the experimental pattern.
- confidence: a number between 0 and 1.
- Only include phases that clearly match; don't guess if uncertain.
- For single-phase samples, return exactly one phase.
- For multi-phase samples, return all identified phases.`

export interface IdentifyPhasesArgs {
  sessionId: string | null
  spectrum: ProWorkbenchSpectrum | null
  peaks: ReadonlyArray<XrdProPeak>
  elements: ReadonlyArray<string>
  tolerance?: number
  topK?: number
  wavelength?: string
  /** Abort the in-flight LLM call. Honored on a best-effort basis — the
   *  worker search itself is fast enough that cancellation there isn't
   *  worth the complexity. */
  signal?: AbortSignal
}

export type IdentifyPhasesResult =
  | {
      success: true
      candidates: XrdProCandidate[]
      identification: XrdProIdentification
      /** Source tag returned by the worker (``mp_db`` | ``dara`` | …).
       *  Useful for telemetry and the run-history row. */
      source: string
    }
  | { success: false; error: string }

function normalizeElements(elements: ReadonlyArray<string>): string[] {
  const out: string[] = []
  for (const raw of elements) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    out.push(trimmed)
  }
  return out
}

function formatCandidatesForLlm(candidates: XrdProCandidate[]): string {
  return candidates
    .slice(0, MAX_LLM_CANDIDATES)
    .map((c, i) => {
      const id = c.material_id ?? '?'
      const formula = c.formula ?? c.name ?? '—'
      const space = c.space_group ?? '—'
      const score =
        typeof c.score === 'number' ? c.score.toFixed(3) : '—'
      const peaksStr =
        c.refPeaks && c.refPeaks.length > 0
          ? ` | Peaks: ${c.refPeaks
              .slice(0, 5)
              .map((p) => `${p.twoTheta.toFixed(1)}°(${Math.round(p.relIntensity)})`)
              .join(', ')}`
          : ''
      return `${i + 1}. ${id} — ${formula} | ${space} | score=${score}${peaksStr}`
    })
    .join('\n')
}

function formatPeaksForLlm(peaks: ReadonlyArray<XrdProPeak>): string {
  const sorted = [...peaks].sort(
    (a, b) => (b.intensity ?? 0) - (a.intensity ?? 0),
  )
  // Normalize intensities to 0-100% relative scale so LLM can compare
  // with reference peak intensities (also 0-100).
  const maxI = Math.max(...sorted.map((p) => Math.abs(p.intensity ?? 0)), 1)
  return sorted
    .map(
      (p) =>
        `  2θ = ${(p.position ?? 0).toFixed(2)}°, I = ${(
          ((p.intensity ?? 0) / maxI) * 100
        ).toFixed(1)}%`,
    )
    .join('\n')
}

interface LlmVerdict {
  predictedPhases: string[]
  confidence: number
  reasoning: string
}

function parseLlmVerdict(raw: string): LlmVerdict {
  // Providers occasionally wrap JSON in fences; be tolerant of both
  // bare JSON and fenced blocks. We only look at the first {…} span.
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const candidate = fenceMatch ? fenceMatch[1] : raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return {
      predictedPhases: [],
      confidence: 0,
      reasoning: `LLM response was not JSON: ${raw.slice(0, 200)}`,
    }
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      predicted_phases?: unknown
      confidence?: unknown
      reasoning?: unknown
    }
    const phasesRaw = parsed.predicted_phases
    const phases = Array.isArray(phasesRaw)
      ? phasesRaw.filter((x): x is string => typeof x === 'string')
      : typeof phasesRaw === 'string'
        ? [phasesRaw]
        : []
    const confidence =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5
    const reasoning =
      typeof parsed.reasoning === 'string' ? parsed.reasoning : ''
    return { predictedPhases: phases, confidence, reasoning }
  } catch (err) {
    return {
      predictedPhases: [],
      confidence: 0,
      reasoning: `Failed to parse LLM JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function resolvedAgentModelLabel(): string {
  const cfg = useLLMConfigStore.getState()
  const resolved = cfg.getResolvedModel('agent')
  if (!resolved) return 'unresolved'
  return `${resolved.provider.name} / ${resolved.model.label}`
}

/**
 * Full pipeline: retrieve top-K candidates from the worker (with element
 * subset expansion), ask the LLM to pick the phases that actually
 * explain the pattern, and return both the retriever's candidate list
 * and the LLM verdict.
 *
 * Returns `{ success: false }` when either stage hard-fails (no peaks,
 * LLM error, malformed verdict). Partial failures where the retriever
 * succeeded but the LLM didn't are surfaced via an identification with
 * `predictedPhases = []` and the error in `reasoning`.
 */
export async function identifyPhases(
  args: IdentifyPhasesArgs,
): Promise<IdentifyPhasesResult> {
  const elements = normalizeElements(args.elements)
  const searchRes = await localProXrd.search(args.spectrum, {
    peaks: args.peaks.map((p) => ({
      position: p.position,
      intensity: p.intensity,
      fwhm: p.fwhm,
    })),
    elements,
    tolerance: args.tolerance,
    top_k: args.topK,
    wavelength: args.wavelength,
  })
  if (!searchRes.success) {
    return { success: false, error: searchRes.error }
  }
  const candidates: XrdProCandidate[] = (searchRes.data.candidates ?? []).map(
    (c) => {
      // Worker ships snake_case `ref_peaks` — flatten to the frontend's
      // camelCase shape now so downstream chart code can stay in one
      // convention. Missing field = no overlay available for this
      // candidate; chart code already handles that gracefully.
      const refPeaksRaw = c.ref_peaks
      const refPeaks = Array.isArray(refPeaksRaw)
        ? refPeaksRaw
            .filter(
              (p) =>
                typeof p.two_theta === 'number' &&
                typeof p.rel_intensity === 'number',
            )
            .map((p) => ({
              twoTheta: p.two_theta,
              relIntensity: p.rel_intensity,
            }))
        : undefined
      return {
        material_id: c.material_id as string | undefined,
        formula: c.formula as string | undefined,
        space_group: c.space_group as string | undefined,
        name: c.name as string | undefined,
        score: c.score as number | undefined,
        selected: false,
        refPeaks,
      }
    },
  )
  if (candidates.length === 0) {
    // Retrieval empty — no point calling the LLM; return an empty
    // identification so the UI can still render "no matches".
    return {
      success: true,
      candidates,
      source: searchRes.source,
      identification: {
        predictedPhases: [],
        confidence: 0,
        reasoning:
          'Retriever returned no candidates; broaden the element set or widen the peak tolerance.',
        model: resolvedAgentModelLabel(),
        createdAt: Date.now(),
        elements,
      },
    }
  }
  const userPrompt = [
    `## Experimental Data`,
    `Elements detected: ${elements.join(', ')}`,
    ``,
    `Experimental XRD peaks (${args.peaks.length} peaks):`,
    formatPeaksForLlm(args.peaks),
    ``,
    `## Candidate Phases (${candidates.length} from retriever, showing top ${Math.min(candidates.length, MAX_LLM_CANDIDATES)})`,
    formatCandidatesForLlm(candidates),
    ``,
    `## Task`,
    `Analyze the experimental peaks and identify which phase(s) are present. Return JSON only.`,
  ].join('\n')

  const llm = await sendLlmChat({
    mode: 'dialog',
    systemPromptOverride: SYSTEM_PROMPT,
    userMessage: userPrompt,
    transcript: [],
    sessionId: args.sessionId,
  })
  if (!llm.success) {
    // Retrieval worked — give the user the candidates even though the
    // verdict failed, so they can still eyeball the list.
    return {
      success: true,
      candidates,
      source: searchRes.source,
      identification: {
        predictedPhases: [],
        confidence: 0,
        reasoning: `LLM call failed: ${llm.error ?? 'unknown error'}`,
        model: resolvedAgentModelLabel(),
        createdAt: Date.now(),
        elements,
      },
    }
  }
  const verdict = parseLlmVerdict(llm.content)
  return {
    success: true,
    candidates,
    source: searchRes.source,
    identification: {
      predictedPhases: verdict.predictedPhases,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      model: resolvedAgentModelLabel(),
      createdAt: Date.now(),
      elements,
    },
  }
}
