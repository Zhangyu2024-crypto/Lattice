// Pure helpers used by the XPS technique module. Kept free of React and
// closure state so they stay unit-testable in isolation.

import type { XpsSubState } from '@/types/artifact'

/**
 * Pull `{name, area}` pairs out of whatever shape the workbench has on
 * hand for the most recent fit. The lattice-cli backend used to inline
 * these into `fitResult.data.components` or `fitResult.components`; the
 * local worker (P4-γ) emits them in the same place but we tolerate
 * either route + ignore anything we can't read so the quantify call
 * still attempts whatever it can.
 */
export function extractFitComponents(
  source: unknown,
): Array<{ name: string; area: number }> {
  if (!source) return []
  const raw = (source as { components?: unknown }).components ?? source
  if (!Array.isArray(raw)) return []
  const out: Array<{ name: string; area: number }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === 'string' ? e.name : null
    const area =
      typeof e.area === 'number'
        ? e.area
        : typeof e.area_eV === 'number'
          ? (e.area_eV as number)
          : null
    if (!name || area == null || !Number.isFinite(area) || area <= 0) continue
    out.push({ name, area })
  }
  return out
}

/** Heuristic element extraction from a peak label (e.g. "C1s_sp3" → "C",
 *  "Fe2p3/2_oxide" → "Fe"). Returns the input unchanged when it can't
 *  spot a leading element token; the worker's `xps.quantify` will then
 *  flag it as missing-RSF rather than guessing. */
export function extractElementFromName(name: string): string {
  const match = name.match(/^([A-Z][a-z]?)/)
  return match ? match[1] : name
}

/** Extract the orbital line from a peak label (e.g. "C1s" → "1s",
 *  "Fe2p3/2_oxide" → "2p3/2"). Returns undefined when no line marker
 *  is present so the worker falls back to the element-only RSF lookup. */
export function extractLineFromName(name: string): string | undefined {
  const match = name.match(/[0-9][spdf](?:[0-9]\/[0-9])?/i)
  return match ? match[0] : undefined
}

export function buildXpsReport(sub: XpsSubState): string {
  const lines: string[] = []
  lines.push('# XPS Fit Report')
  lines.push('')
  if (sub.chargeCorrection) {
    lines.push(
      `- Charge correction: ${sub.chargeCorrection.shiftEV.toFixed(2)} eV`,
    )
  }
  lines.push(`- Detected peaks: ${sub.detectedPeaks.length}`)
  lines.push(`- Fit peaks: ${sub.peakDefinitions.length}`)
  lines.push('')
  lines.push('## Peak Definitions')
  for (const d of sub.peakDefinitions) {
    lines.push(
      `- ${d.label} (${d.type}): pos=${d.position} int=${d.intensity} fwhm=${d.fwhm}`,
    )
  }
  if (sub.fitResult?.quantification) {
    lines.push('')
    lines.push('## Quantification')
    lines.push('| Element | at% |')
    lines.push('| --- | --- |')
    for (const q of sub.fitResult.quantification) {
      lines.push(`| ${q.element} | ${q.atomic_percent.toFixed(1)} |`)
    }
  }
  return lines.join('\n')
}
