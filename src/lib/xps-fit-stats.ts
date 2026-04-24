// Small helpers for formatting XPS fit diagnostics in the Pro workbench.
//
// Centralised so the panel doesn't grow inline number-rounding decisions
// that drift between sections (the detected-peaks table, the fit-quality
// strip, exported CSV all want the same precision).

/**
 * Format reduced χ² for display. Reduced χ² is dimensionless; the
 * convention is 3 sig-figs up to 1e-2 and scientific beyond that.
 */
export function formatChiSq(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1000 || abs < 1e-2) return value.toExponential(2)
  if (abs >= 10) return value.toFixed(1)
  return value.toFixed(3)
}

/**
 * Format R². Clamped to 3 decimal places; values > 1 (happens when the
 * model outperforms the mean predictor with negative residuals in rare
 * fit pathologies) are shown verbatim so the user notices.
 */
export function formatRSquared(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(3)
}

/**
 * "Nvars / Npts" compact string. Both optional — missing values render
 * as an em-dash rather than '0' so the user isn't misled into thinking
 * the fit had zero of anything.
 */
export function formatDegreesOfFreedom(
  nVars: number | undefined,
  nPts: number | undefined,
): string {
  const v = nVars != null && Number.isFinite(nVars) ? String(nVars) : '—'
  const p = nPts != null && Number.isFinite(nPts) ? String(nPts) : '—'
  return `${v} / ${p}`
}

/**
 * Classify a reduced χ² into a rough fit-quality band. Reduced χ² near 1
 * is ideal; << 1 indicates over-fitting or over-estimated noise; >> 1
 * indicates a bad model. Used for the colour hint on the stats chip.
 */
export type FitQualityBand = 'ideal' | 'acceptable' | 'poor' | 'unknown'

export function classifyChiSq(value: number | undefined): FitQualityBand {
  if (value == null || !Number.isFinite(value)) return 'unknown'
  if (value >= 0.8 && value <= 1.5) return 'ideal'
  if (value >= 0.5 && value <= 3.0) return 'acceptable'
  return 'poor'
}
