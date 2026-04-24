// Pure helpers used by the Raman/FTIR technique module. Kept free of React
// and closure state so they stay unit-testable in isolation.

import type { XrdProPeak } from '@/types/artifact'

/**
 * Build the CSV text for exporting detected peaks. Both Raman and FTIR use
 * wavenumber (cm⁻¹) on the X axis — kept as an explicit constant inside the
 * helper so it's obvious where to branch if that ever changes.
 */
export function buildPeaksCsv(peaks: ReadonlyArray<XrdProPeak>): string {
  const unit = 'cm⁻¹'
  const header = `index,${unit},intensity,fwhm\n`
  const rows = peaks
    .map(
      (p, i) => `${i + 1},${p.position},${p.intensity},${p.fwhm ?? ''}`,
    )
    .join('\n')
  return header + rows
}
