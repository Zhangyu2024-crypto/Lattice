// Format emitters for spectrum data.
//
// Port of `lattice-cli/src/lattice_cli/convert.py`:
//   - `toXy`    — tab-separated two-column text (no header), mirrors _write_xy
//   - `toCsv`   — CSV with header row, mirrors _write_csv
//   - `toJcamp` — JCAMP-DX 5.01 with minimal header block, mirrors _write_jcamp
//
// These consume a parsed spectrum (`{x, y, xLabel, yLabel, ...}`) and
// return the serialised file as a string. All are deterministic and have
// no side effects — callers write the string to disk (or propose a write
// via the workspace IPC) separately.

import type { ParsedSpectrum } from './parsers/types'

export type SpectrumExportFormat = 'xy' | 'csv' | 'jcamp'

export const SPECTRUM_EXPORT_FORMATS: readonly SpectrumExportFormat[] = [
  'xy',
  'csv',
  'jcamp',
]

const EXTENSION_BY_FORMAT: Record<SpectrumExportFormat, string> = {
  xy: '.xy',
  csv: '.csv',
  jcamp: '.jdx',
}

/** File extension (with leading dot) for a given export format. */
export function extensionForFormat(format: SpectrumExportFormat): string {
  return EXTENSION_BY_FORMAT[format]
}

/** Number format that preserves the x/y precision lattice-cli ships: no
 *  rounding for integers, full-precision default JS number for floats. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? n.toString() : n.toString()
}

/** CSV quoting: wrap in double quotes and double any existing quotes if
 *  the value contains a comma, quote, or newline. Plain ASCII strings and
 *  numbers pass through untouched. */
function csvCell(value: string): string {
  if (value === '') return ''
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** Two-column XY (tab-separated, no header). Matches lattice-cli _write_xy. */
export function toXy(spectrum: ParsedSpectrum): string {
  const { x, y } = spectrum
  const n = Math.min(x.length, y.length)
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    lines.push(`${fmt(x[i])}\t${fmt(y[i])}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** CSV with header row taken from the parsed spectrum's axis labels (falls
 *  back to `x` / `y` when labels are empty). Matches lattice-cli _write_csv
 *  but uses the semantic labels instead of literal `x`/`y` so downstream
 *  tools (Origin, Excel) can read units directly. */
export function toCsv(spectrum: ParsedSpectrum): string {
  const { x, y } = spectrum
  const xHeader = csvCell(spectrum.xLabel?.trim() || 'x')
  const yHeader = csvCell(spectrum.yLabel?.trim() || 'y')
  const n = Math.min(x.length, y.length)
  const lines: string[] = [`${xHeader},${yHeader}`]
  for (let i = 0; i < n; i++) {
    lines.push(`${fmt(x[i])},${fmt(y[i])}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** JCAMP-DX 5.01 minimal block. Writes the X/Y pairs in the AFFN-style
 *  `(X++(Y..Y))` layout with one point per line — the most widely
 *  interoperable subset. Includes title, axis units, bounds, and point
 *  count so downstream tools (ChemAxon, OpenChrom, JCAMP viewers) can
 *  auto-configure. */
export function toJcamp(
  spectrum: ParsedSpectrum,
  opts?: { title?: string },
): string {
  const { x, y } = spectrum
  const n = Math.min(x.length, y.length)
  const title = opts?.title?.trim() || spectrum.metadata.sampleName || 'Spectrum'
  const xUnits = spectrum.xLabel?.trim() || ''
  const yUnits = spectrum.yLabel?.trim() || ''
  const firstX = n > 0 ? x[0] : 0
  const lastX = n > 0 ? x[n - 1] : 0

  const lines: string[] = []
  lines.push(`##TITLE=${title}`)
  lines.push('##JCAMP-DX=5.01')
  lines.push('##DATA TYPE=SPECTRUM')
  lines.push(`##XUNITS=${xUnits}`)
  lines.push(`##YUNITS=${yUnits}`)
  lines.push(`##FIRSTX=${fmt(firstX)}`)
  lines.push(`##LASTX=${fmt(lastX)}`)
  lines.push(`##NPOINTS=${n}`)
  lines.push('##XYDATA=(X++(Y..Y))')
  for (let i = 0; i < n; i++) {
    lines.push(`${fmt(x[i])} ${fmt(y[i])}`)
  }
  lines.push('##END=')
  lines.push('')
  return lines.join('\n')
}

export function emitSpectrum(
  spectrum: ParsedSpectrum,
  format: SpectrumExportFormat,
  opts?: { title?: string },
): string {
  switch (format) {
    case 'xy':
      return toXy(spectrum)
    case 'csv':
      return toCsv(spectrum)
    case 'jcamp':
      return toJcamp(spectrum, opts)
    default: {
      const never: never = format
      throw new Error(`Unsupported export format: ${never as string}`)
    }
  }
}

/** Derive an output path when the caller didn't supply one. Replaces the
 *  source extension with the target format's suffix. Matches
 *  lattice-cli's `resolve_single_output_path(output=None)` behaviour. */
export function deriveOutputPath(
  sourceRelPath: string,
  format: SpectrumExportFormat,
): string {
  const dot = sourceRelPath.lastIndexOf('.')
  const slash = Math.max(
    sourceRelPath.lastIndexOf('/'),
    sourceRelPath.lastIndexOf('\\'),
  )
  const stem = dot > slash ? sourceRelPath.slice(0, dot) : sourceRelPath
  return stem + EXTENSION_BY_FORMAT[format]
}
