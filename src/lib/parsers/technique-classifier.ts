// Shared technique classifier + default-label map for the text-format
// parsers. Both `csv-parser.ts` (via `guessTechnique`) and `jdx-parser.ts`
// (via `detectTechnique` + `guessLabels`) used to carry near-identical
// regex tables; the duplication drifted over time — FTIR matched
// slightly different keywords in each parser, Raman priority flipped
// between the two. Consolidating here means adding a new keyword or
// adjusting priority only touches one file.
//
// Rules are applied in priority order: XRD → XPS → Raman → FTIR →
// fallback. Specificity drives the ordering — XRD's "2-theta" token is
// the most distinctive in practice, while FTIR's "cm-1" also appears in
// Raman ("Raman shift cm-1"), which is why Raman must be checked
// before the bare-wavenumber fall-through to FTIR.

import type { SpectroscopyTechnique } from './types'

interface TechniqueRule {
  technique: SpectroscopyTechnique
  pattern: RegExp
}

const TECHNIQUE_RULES: readonly TechniqueRule[] = [
  { technique: 'XRD', pattern: /2.?theta|2th|xrd|diffract/ },
  { technique: 'XPS', pattern: /xps|esca|binding.?energy/ },
  { technique: 'Raman', pattern: /raman|shift.*cm|cm-1.*shift/ },
  { technique: 'FTIR', pattern: /wavenumber|ftir|infrared|transmit|absorb|ir\s|1\/cm|cm-1/ },
]

/**
 * Decide which technique a free-text corpus (header lines, filename,
 * JCAMP data-type field, etc.) most likely describes. Returns `'Curve'`
 * when nothing matches — a safe fallback that keeps the rendering path
 * working rather than crashing on an unrecognised format.
 */
export function classifyTechniqueFromText(
  corpus: string,
): SpectroscopyTechnique {
  const haystack = corpus.toLowerCase()
  for (const rule of TECHNIQUE_RULES) {
    if (rule.pattern.test(haystack)) return rule.technique
  }
  return 'Curve'
}

/**
 * Default X / Y axis labels per technique, used when the parsed file
 * doesn't carry explicit units. Matches the conventions the rest of
 * the app renders (`2θ (°)` with the Unicode theta; XPS BE in eV; etc.).
 */
export function defaultLabelsFor(
  technique: SpectroscopyTechnique,
): { xLabel: string; yLabel: string } {
  switch (technique) {
    case 'XRD':
      return { xLabel: '2\u03B8 (\u00B0)', yLabel: 'Intensity' }
    case 'XPS':
      return { xLabel: 'Binding Energy (eV)', yLabel: 'CPS' }
    case 'Raman':
      return {
        xLabel: 'Raman Shift (cm\u207B\u00B9)',
        yLabel: 'Intensity',
      }
    case 'FTIR':
      return {
        xLabel: 'Wavenumber (cm\u207B\u00B9)',
        yLabel: 'Transmittance (%)',
      }
    default:
      return { xLabel: 'X', yLabel: 'Y' }
  }
}
