// Sensitivity presets for the unified peak-detection UI. The XRD and XPS
// panels both used to expose `prominenceMult` as a raw 0.1–10 slider — far
// too much surface for casual users. We collapse that to a 3-step enum
// (`low` / `medium` / `high`) that maps to sensible prominence multipliers.
//
// Advanced users can still reach the raw number through the Advanced
// disclosure inside each panel; the Sensitivity select always reflects the
// current raw value via `prominenceToSensitivity`.

export type PeakSensitivity = 'low' | 'medium' | 'high'

export interface PeakSensitivityPreset {
  prominenceMult: number
  label: string
  hint: string
}

export const PEAK_SENSITIVITY_PRESETS: Record<PeakSensitivity, PeakSensitivityPreset> = {
  low: {
    prominenceMult: 3.0,
    label: 'Low — strong peaks only',
    hint: 'Few, tall peaks. Use for clean single-phase patterns.',
  },
  medium: {
    prominenceMult: 1.0,
    label: 'Medium — balanced',
    hint: 'Recommended default.',
  },
  high: {
    prominenceMult: 0.3,
    label: 'High — include weak shoulders',
    hint: 'Finds weak peaks; may include noise.',
  },
}

export const PEAK_SENSITIVITY_OPTIONS = (
  Object.entries(PEAK_SENSITIVITY_PRESETS) as Array<[PeakSensitivity, PeakSensitivityPreset]>
).map(([value, preset]) => ({ value, label: preset.label }))

/**
 * Bucket a raw prominenceMult into one of the three sensitivity tiers so
 * the Sensitivity select stays in sync when power users tweak the raw
 * value through the Advanced disclosure.
 */
export function prominenceToSensitivity(prominenceMult: number): PeakSensitivity {
  if (!Number.isFinite(prominenceMult)) return 'medium'
  if (prominenceMult >= 2.0) return 'low'
  if (prominenceMult >= 0.6) return 'medium'
  return 'high'
}
