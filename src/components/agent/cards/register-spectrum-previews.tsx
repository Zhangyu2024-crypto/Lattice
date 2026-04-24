// Phase ζ.1 — preview resolvers for the spectrum / XRD / XPS / Raman
// tools. Imported once (for its side effects) so every entry below is
// available to the AgentCard lookup. Companion file for the compute +
// structure teammate will live alongside this one.
//
// Each resolver reads `step.output` (the LocalTool's typed return value)
// and returns the three preview slots — `oneLiner` (next to the title),
// `compact` (always visible in the body) and optional `expanded`. Keep
// the compact slot small; anything bigger goes in `expanded`.
//
// Implementation split (2026-04-20): the bespoke resolvers with non-
// trivial markup (assess_spectrum_quality, detect_spectrum_type,
// xrd_search_phases, xrd_refine, xps_fit_peaks, raman_identify,
// build_structure) and the shared `confidenceBar` helper were moved into
// `./spectrum-previews/`. This file is now registrations-only: it wires
// each resolver into the shared registry in the original order so the
// side-effect import in AgentCard fires exactly one registration per tool.

import { registerToolPreview } from './preview-registry'
import { assessSpectrumQualityPreview } from './spectrum-previews/AssessSpectrumQualityPreview'
import { detectSpectrumTypePreview } from './spectrum-previews/DetectSpectrumTypePreview'
import { xrdSearchPhasesPreview } from './spectrum-previews/XrdSearchPhasesPreview'
import { xrdRefinePreview } from './spectrum-previews/XrdRefinePreview'
import { xpsFitPeaksPreview } from './spectrum-previews/XpsFitPeaksPreview'
import { ramanIdentifyPreview } from './spectrum-previews/RamanIdentifyPreview'
import { buildStructurePreview } from './spectrum-previews/BuildStructurePreview'

// ─── smooth_spectrum ──────────────────────────────────────────────────

interface SmoothOutput {
  method?: string
  nPoints?: number
  window?: number
  order?: number
  sigma?: number
}

registerToolPreview('smooth_spectrum', (step) => {
  const out = (step.output ?? {}) as SmoothOutput
  const parts: string[] = []
  if (out.method) parts.push(out.method)
  if (out.window != null) parts.push(`win=${out.window}`)
  if (out.order != null) parts.push(`order=${out.order}`)
  if (out.sigma != null) parts.push(`σ=${out.sigma}`)
  if (out.nPoints != null) parts.push(`${out.nPoints} pts`)
  return { oneLiner: parts.join(' · ') || undefined }
})

// ─── correct_baseline ─────────────────────────────────────────────────

interface BaselineOutput {
  method?: string
  nPoints?: number
  order?: number
  iterations?: number
}

registerToolPreview('correct_baseline', (step) => {
  const out = (step.output ?? {}) as BaselineOutput
  const parts: string[] = []
  if (out.method) parts.push(out.method)
  if (out.order != null) parts.push(`deg=${out.order}`)
  if (out.iterations != null) parts.push(`iters=${out.iterations}`)
  if (out.nPoints != null) parts.push(`${out.nPoints} pts`)
  return { oneLiner: parts.join(' · ') || undefined }
})

// ─── assess_spectrum_quality ──────────────────────────────────────────

registerToolPreview('assess_spectrum_quality', assessSpectrumQualityPreview)

// ─── detect_spectrum_type ─────────────────────────────────────────────

registerToolPreview('detect_spectrum_type', detectSpectrumTypePreview)

// ─── xrd_search_phases ────────────────────────────────────────────────

registerToolPreview('xrd_search_phases', xrdSearchPhasesPreview)

// ─── xrd_refine ───────────────────────────────────────────────────────

registerToolPreview('xrd_refine', xrdRefinePreview)

// ─── xps_fit_peaks ────────────────────────────────────────────────────

registerToolPreview('xps_fit_peaks', xpsFitPeaksPreview)

// ─── xps_charge_correct ───────────────────────────────────────────────

interface XpsChargeOutput {
  shiftEV?: number
  c1sFoundEV?: number
}

registerToolPreview('xps_charge_correct', (step) => {
  const out = (step.output ?? {}) as XpsChargeOutput
  const parts: string[] = []
  if (out.shiftEV != null) parts.push(`shift ${out.shiftEV.toFixed(2)} eV`)
  if (out.c1sFoundEV != null)
    parts.push(`C 1s @ ${out.c1sFoundEV.toFixed(2)} eV`)
  else parts.push('no C 1s ref')
  return { oneLiner: parts.join(' · ') || undefined }
})

// ─── raman_identify ───────────────────────────────────────────────────

registerToolPreview('raman_identify', ramanIdentifyPreview)

// ─── detect_peaks (preview only — editor is already registered) ───────

interface DetectPeaksOutput {
  peaks?: unknown[]
  summary?: string
}

registerToolPreview('detect_peaks', (step) => {
  const out = (step.output ?? {}) as DetectPeaksOutput
  const n = out.peaks?.length ?? 0
  return {
    oneLiner: `${n} peak${n === 1 ? '' : 's'}${
      out.summary && out.summary !== `${n} peaks` ? ` · ${out.summary}` : ''
    }`,
  }
})

// ─── build_structure ──────────────────────────────────────────────────

registerToolPreview('build_structure', buildStructurePreview)
