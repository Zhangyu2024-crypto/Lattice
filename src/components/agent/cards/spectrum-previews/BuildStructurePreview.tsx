// Preview resolver for `build_structure`. Extracted from
// `register-spectrum-previews.tsx` with zero behavior change — the
// registration itself stays in the sibling register-* file so the
// side-effect order is preserved.

import type { ToolPreviewResolver } from '../preview-registry'

interface BuildStructureOutput {
  success?: boolean
  formula?: string
  spaceGroup?: string
  cellVolume?: number
  artifactId?: string
  /** Slug the compute runner uses as the ACTIVE_CIFS key. The LLM
   *  should mention this in follow-up turns when chaining into a
   *  LAMMPS / CP2K script. */
  loadKey?: string
  summary?: string
  error?: string
}

export const buildStructurePreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as BuildStructureOutput
  if (out.success === false) {
    return {
      oneLiner: out.error ? `failed · ${out.error.slice(0, 60)}` : 'failed',
    }
  }
  const parts: string[] = []
  if (out.formula) parts.push(out.formula)
  if (out.spaceGroup) parts.push(out.spaceGroup)
  if (typeof out.cellVolume === 'number' && Number.isFinite(out.cellVolume)) {
    parts.push(`V=${out.cellVolume.toFixed(1)} Å³`)
  }
  if (out.loadKey) parts.push(`key: ${out.loadKey}`)
  return {
    oneLiner: parts.join(' · ') || out.summary || 'structure built',
  }
}
