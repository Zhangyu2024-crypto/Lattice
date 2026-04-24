// Pure translator from the workbench's local `XpsProPeakDef` shape to the
// wire-format `XpsPeakSpec` / `XpsDoubletSpec` the Python worker expects
// (see `worker/tools/xps.py`: `_add_peak`, `_add_doublet`).
//
// Extracted from `components/canvas/artifacts/pro/modules/xps/index.tsx`
// so the per-peak-η / fixed-flag / fraction-fallback rules have a
// dedicated test surface. Keep this side-effect-free.

import type { XpsProPeakDef } from '../types/artifact'
import type { XpsDoubletSpec, XpsPeakSpec } from '../types/pro-api'

export interface BuildSpecsOptions {
  /** Workbench default η used when a peak def doesn't override it. */
  defaultVoigtEta: number
}

export interface BuiltSpecs {
  peaks: XpsPeakSpec[]
  doublets: XpsDoubletSpec[]
}

/**
 * Partition + translate definitions in one pass. Single peaks go into
 * `peaks`, doublets into `doublets`. Every spec gets a concrete `fraction`
 * so the worker doesn't fall back to its 0.5 default (the previous behaviour
 * was to pass no fraction at all, silently defeating the global η slider).
 */
export function buildXpsSpecs(
  defs: readonly XpsProPeakDef[],
  opts: BuildSpecsOptions,
): BuiltSpecs {
  const peaks: XpsPeakSpec[] = []
  const doublets: XpsDoubletSpec[] = []
  for (const p of defs) {
    const fraction = p.voigtEta ?? opts.defaultVoigtEta
    if (p.type === 'single') {
      peaks.push({
        name: p.label,
        center: p.position,
        amplitude: p.intensity,
        fwhm: p.fwhm,
        fraction,
        vary_center: p.fixedPosition ? false : undefined,
        vary_fwhm: p.fixedFwhm ? false : undefined,
      })
    } else {
      // `fixedSplit` / `fixedBranching` default to true (the historical
      // behaviour) — opt-in `false` promotes split / ratio to free
      // variables in the worker's least-squares fit.
      const fixedSplit = p.fixedSplit !== false
      const fixedBranching = p.fixedBranching !== false
      doublets.push({
        base_name: p.label,
        center: p.position,
        split: p.split ?? 5,
        area_ratio: p.branchingRatio ?? 0.5,
        amplitude: p.intensity,
        fwhm: p.fwhm,
        fraction,
        vary_center: p.fixedPosition ? false : undefined,
        vary_fwhm: p.fixedFwhm ? false : undefined,
        vary_split: fixedSplit ? undefined : true,
        vary_area_ratio: fixedBranching ? undefined : true,
      })
    }
  }
  return { peaks, doublets }
}
