// Technique → TechniqueModule map consumed by UnifiedProWorkbench.
//
// Pure data: every supported `SpectrumTechnique` resolves to exactly one
// module instance. FTIR intentionally reuses the Raman module — the two
// techniques share 100% of the feature surface and `sub.params.mode`
// differentiates them at runtime. Phase 4 keybindings and the technique
// switcher iterate this table in a fixed order so the UI stays stable.

import type { SpectrumTechnique } from '@/types/artifact'
import type { ModuleRegistry, TechniqueModule } from './types'
import XrdModule from './xrd'
import XpsModule from './xps'
import RamanModule from './raman'
import CurveModule from './curve'

// The module interface is declared with per-technique `Sub` generics so the
// hooks / builders inside each module get tight types. The registry is a
// technique-agnostic table, so we widen the entries to
// `TechniqueModule<unknown>` — the unified workbench is the only caller
// and it hands each module its own ctx back, so no information is lost.
export const moduleRegistry: ModuleRegistry = {
  xrd: XrdModule as unknown as TechniqueModule<unknown>,
  xps: XpsModule as unknown as TechniqueModule<unknown>,
  raman: RamanModule as unknown as TechniqueModule<unknown>,
  ftir: RamanModule as unknown as TechniqueModule<unknown>,
  curve: CurveModule as unknown as TechniqueModule<unknown>,
}

/** Look up the module for a technique. Always returns a module —
 *  `SpectrumTechnique` is exhaustive and every entry is populated. */
export function getModuleForTechnique(
  t: SpectrumTechnique,
): TechniqueModule<unknown> {
  return moduleRegistry[t]
}
