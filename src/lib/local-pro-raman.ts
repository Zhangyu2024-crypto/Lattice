// LocalProRaman — drop-in replacement for `useProApi.ramanIdentify`.
// Self-contained Port Plan §P4-δ.
//
// Routes through the repo-local Python worker (worker/tools/raman.py)
// which scores the supplied peak list against a compact mineral
// reference table and returns the top-k matches. The worker is stateless;
// the caller passes peaks explicitly so we don't need backend session
// state the way the legacy REST endpoint did.

import { callWorker } from './worker-client'
import type {
  RamanIdentifyRequest,
  RamanIdentifyResponse,
  RamanMatch,
} from '../types/pro-api'

interface WorkerMatch {
  name: string
  formula?: string | null
  score: number
  matched_peaks: number
  reference_peaks: number[]
  notes?: string | null
}

type WorkerIdentifyResult =
  | {
      success: true
      data: { matches: WorkerMatch[]; tolerance_cm1: number }
      summary: string
    }
  | { success: false; error: string }

export const localProRaman = {
  async identify(
    req: RamanIdentifyRequest,
  ): Promise<RamanIdentifyResponse> {
    const peaks = (req.peaks ?? []).map((p) => ({
      position: p.position,
      intensity: p.intensity,
    }))
    if (peaks.length === 0) {
      return {
        success: false,
        error: 'No peaks provided — detect peaks first.',
      }
    }
    const result = await callWorker<WorkerIdentifyResult>(
      'raman.identify',
      { peaks, tolerance: req.tolerance },
      { timeoutMs: 10_000 },
    )
    if (!result.ok) return { success: false, error: result.error }
    const value = result.value
    if (!value.success) return { success: false, error: value.error }
    const matches: RamanMatch[] = value.data.matches.map((m) => ({
      name: m.name,
      formula: m.formula ?? undefined,
      score: m.score,
      matched_peaks: m.matched_peaks,
      reference_peaks: m.reference_peaks,
      ...(m.notes ? { notes: m.notes } : {}),
    }))
    return {
      success: true,
      data: { matches, tolerance_cm1: value.data.tolerance_cm1 },
      summary: value.summary,
    }
  },
}
