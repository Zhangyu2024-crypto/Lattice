// Pro Workbench capability registry.
//
// Some Pro-mode features exist in the UI but aren't powered by this build's
// bundled Python worker (or are intentionally out of scope for the offline
// port). We used to signal this by letting users click the button and then
// firing `toast.warn("deferred in offline v1")` — awful UX, reads like a
// bug. Instead, every "maybe not available" action asks this registry
// whether it's available, and the UI disables the control with a clear
// tooltip when it isn't.
//
// Policy:
//   - available: true  → full interaction
//   - available: false → disabled widget + `reason` shown as tooltip;
//                        command-palette entry hidden (not just disabled)
//                        so the user can't trip the same wall from Ctrl+K.

export type ProCapability =
  /** Export the Rietveld-refined phase back as a CIF file. Requires a true
   *  refinement engine (BGMN/dara); the offline worker's approximate
   *  whole-pattern fit doesn't emit structure updates. */
  | 'xrd-cif-export'
  /** Match FTIR peaks against a mineral/compound database. No bundled
   *  FTIR reference DB in this build (Raman DB is 80 minerals; FTIR would
   *  need its own table). */
  | 'ftir-identify'

interface CapabilityStatus {
  available: boolean
  reason: string
}

const STATUS: Record<ProCapability, CapabilityStatus> = {
  'xrd-cif-export': {
    available: true,
    reason: '',
  },
  'ftir-identify': {
    available: false,
    reason: 'FTIR database lookup requires a mineral reference table that is not bundled in this build.',
  },
}

export function getCapability(cap: ProCapability): CapabilityStatus {
  return STATUS[cap]
}

export function isCapabilityAvailable(cap: ProCapability): boolean {
  return STATUS[cap].available
}
