// Shared axis + value formatting for Pro workbench charts.
//
// Each spectroscopy technique expresses axes in different units with
// different precision conventions; centralising the formatters here keeps
// the Pro ECharts option builder technique-agnostic and guarantees
// tooltips, labels, and exported CSVs stay in sync.
//
// The formatter intentionally returns an ASCII/Unicode mix appropriate
// for the domain (e.g. `cm⁻¹` with a U+207B super-minus) rather than a
// LaTeX-style escape; ECharts renders these directly in SVG/Canvas.

export type Technique = 'xrd' | 'xps' | 'raman' | 'ftir'
export type Axis = 'x' | 'y'

export interface FormatUnitOpts {
  /** Override the default precision. */
  decimals?: number
}

/**
 * Default decimal precision for a given technique + axis.
 *
 * The values mirror what each domain's published literature typically
 * reports (e.g. 2θ at 0.001° for XRD peak finders, BE at 0.01 eV for
 * XPS). Raman / FTIR wavenumbers are usually quoted to 1 dp; intensity
 * channels default to 1 dp for all techniques.
 */
export function decimalsForTechnique(
  technique: Technique,
  axis: Axis,
): number {
  if (axis === 'y') {
    // Intensity / at% / counts — 1 dp is a sensible default for all
    // techniques. at% for XPS is explicitly `1` per convention.
    return 1
  }
  switch (technique) {
    case 'xrd':
      return 3
    case 'xps':
      return 2
    case 'raman':
    case 'ftir':
      return 1
    default:
      return 2
  }
}

/**
 * Axis label (including unit symbol) for a technique + axis.
 *
 * Returned strings are ready to drop straight into ECharts `xAxis.name`
 * or `yAxis.name`; callers that need a bare unit should trim around the
 * parentheses.
 */
export function axisLabelForTechnique(
  technique: Technique,
  axis: Axis,
): string {
  if (axis === 'x') {
    switch (technique) {
      case 'xrd':
        return '2θ (°)'
      case 'xps':
        return 'Binding Energy (eV)'
      case 'raman':
        return 'Raman Shift (cm⁻¹)'
      case 'ftir':
        return 'Wavenumber (cm⁻¹)'
      default:
        return ''
    }
  }
  // Y axis: XPS quantifies in at%, everything else is intensity.
  switch (technique) {
    case 'xps':
      return 'Intensity (a.u.)'
    case 'xrd':
    case 'raman':
    case 'ftir':
      return 'Intensity (a.u.)'
    default:
      return ''
  }
}

/**
 * Format a single numeric value for a technique + axis, applying the
 * canonical unit suffix. Non-finite values render as an em-dash.
 */
export function formatUnit(
  technique: Technique,
  axis: Axis,
  value: number,
  opts: FormatUnitOpts = {},
): string {
  if (!Number.isFinite(value)) return '—'
  const dp = opts.decimals ?? decimalsForTechnique(technique, axis)
  const rounded = value.toFixed(dp)
  if (axis === 'x') {
    switch (technique) {
      case 'xrd':
        return `${rounded}°`
      case 'xps':
        return `${rounded} eV`
      case 'raman':
      case 'ftir':
        return `${rounded} cm⁻¹`
    }
  }
  // y axis — plain intensity for all four techniques; at% requires the
  // caller to pass a dedicated axis/decimal combo when rendering a
  // quantification chart.
  return rounded
}

/** Narrow a free-form technique string (e.g. from artifact payload) to a
 *  known Technique or `null` when it doesn't match one of the domains
 *  pro-chart supports. */
export function coerceTechnique(raw?: string | null): Technique | null {
  if (!raw) return null
  const t = raw.toLowerCase()
  if (t === 'xrd' || t === 'xps' || t === 'raman' || t === 'ftir') return t
  return null
}
