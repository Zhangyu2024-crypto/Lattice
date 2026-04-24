// Pure helpers used by UnifiedProWorkbench and its normalise pipeline.
// Everything here is side-effect free so the main panel / normalise
// module can import them without tripping circular-dependency guards.

import type {
  Artifact,
  SpectrumProPayload,
  SpectrumTechnique,
} from '@/types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isSpectrumProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '@/types/artifact'
import { curveSubStateFromDefault } from '@/lib/pro-workbench'
import type { ProWorkbenchKind } from '../pro/commandRegistry'
import { SHARED_FIELDS } from './constants'

/** Reports whether the focused DOM element is an editable target we
 *  must avoid stealing keypresses from (inputs, selects, contenteditable
 *  regions). Called from the Ctrl/⌘+digit shortcut handler. */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return false
}

/** Human-readable label for a technique cursor. FTIR and Raman are
 *  spelled out to avoid lossy `.toUpperCase()`; curve follows the UI's
 *  sentence case convention. */
export function moduleLabel(t: SpectrumTechnique): string {
  if (t === 'ftir') return 'FTIR'
  if (t === 'raman') return 'Raman'
  if (t === 'curve') return 'Curve'
  return t.toUpperCase()
}

/** Pick the initial technique for a spectrum-pro whose `technique` is
 *  still `null`. Prefers a technique with existing work (non-empty
 *  peaks), falls back to `'xrd'`. */
export function resolveTechnique(artifact: Artifact): SpectrumTechnique {
  if (isSpectrumProArtifact(artifact)) {
    const t = artifact.payload.technique
    if (t != null) return t
    return pickInitialTechnique(artifact.payload)
  }
  if (isXrdProArtifact(artifact)) return 'xrd'
  if (isXpsProArtifact(artifact)) return 'xps'
  if (isRamanProArtifact(artifact)) {
    return artifact.payload.params.mode === 'ftir' ? 'ftir' : 'raman'
  }
  if (isCurveProArtifact(artifact)) return 'curve'
  return 'xrd'
}

export function pickInitialTechnique(p: SpectrumProPayload): SpectrumTechnique {
  // Priority: techniques with already-detected peaks win. Then the fixed
  // order so a brand-new spectrum-pro always lands on XRD. The `?.` on the
  // leaf `peaks` / `detectedPeaks` guards older persisted payloads where a
  // sub-state may be missing fields; the sub-state itself is required by
  // `SpectrumProPayload` and always present for well-formed artifacts.
  if (p.xrd.peaks?.length) return 'xrd'
  if (p.xps.detectedPeaks?.length) return 'xps'
  if (p.raman.peaks?.length) {
    return p.raman.params?.mode === 'ftir' ? 'ftir' : 'raman'
  }
  return 'xrd'
}

/** Pick the workbench-kind the command registry should use for this
 *  artifact. `spectrum-pro` is the unified slot; the four legacy kinds
 *  keep their pre-Phase-3 slot so scoped commands still target them. */
export function resolveRegistryKind(artifact: Artifact): ProWorkbenchKind {
  switch (artifact.kind) {
    case 'spectrum-pro':
    case 'xrd-pro':
    case 'xps-pro':
    case 'raman-pro':
    case 'curve-pro':
      return artifact.kind
    default:
      // The outer guard ensures we never hit this branch in practice.
      return 'spectrum-pro'
  }
}

/** Strip the cross-technique fields from a legacy payload so the
 *  remaining bag matches that payload's corresponding `*SubState`. The
 *  return type is widened to `unknown` on purpose — each call site
 *  re-narrows to the concrete sub-state type it expects. */
export function stripShared(record: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if ((SHARED_FIELDS as readonly string[]).includes(key)) continue
    out[key] = record[key]
  }
  return out
}

/** Read the active technique's sub-state from a unified payload. */
export function selectSub(
  p: SpectrumProPayload,
  technique: SpectrumTechnique,
): unknown {
  switch (technique) {
    case 'xrd':
      return p.xrd
    case 'xps':
      return p.xps
    case 'raman':
    case 'ftir':
      return p.raman
    case 'curve':
      return p.curve ?? curveSubStateFromDefault()
  }
}

/** Project a replacement sub-state back onto the unified payload on the
 *  correct key. `raman` and `ftir` share the `raman` slot. Exhaustive
 *  over SpectrumTechnique. */
export function writeSubToPayload(
  technique: SpectrumTechnique,
  nextSub: Record<string, unknown>,
): Partial<SpectrumProPayload> {
  switch (technique) {
    case 'xrd':
      return { xrd: nextSub as SpectrumProPayload['xrd'] }
    case 'xps':
      return { xps: nextSub as SpectrumProPayload['xps'] }
    case 'raman':
    case 'ftir':
      return { raman: nextSub as SpectrumProPayload['raman'] }
    case 'curve':
      return { curve: nextSub as SpectrumProPayload['curve'] }
  }
}
