// Pure helpers used by the XRD technique module. Kept free of React and
// closure state so they stay unit-testable in isolation.

import type { XrdProPeak, XrdProRefineResult } from '@/types/artifact'

/**
 * Serialise a peak list to the CSV shape the workbench's `export peaks`
 * command downloads. Trailing commas after the numeric fields are
 * intentional — blank cells keep the column alignment stable for
 * downstream spreadsheet importers even when `fwhm` / `snr` are absent.
 */
export function buildPeaksCsv(peaks: readonly XrdProPeak[]): string {
  const header = 'index,position,intensity,fwhm,snr\n'
  const rows = peaks
    .map(
      (p, i) =>
        `${i + 1},${p.position},${p.intensity},${p.fwhm ?? ''},${p.snr ?? ''}`,
    )
    .join('\n')
  return header + rows
}

export function buildRefineReportCsv(result: XrdProRefineResult): string {
  const lines: string[] = []
  lines.push('# XRD Refinement Report')
  lines.push(`Rwp,${result.rwp ?? ''}`)
  if (result.rexp != null) lines.push(`Rexp,${result.rexp}`)
  lines.push(`GoF,${result.gof ?? ''}`)
  lines.push(`Converged,${result.converged ?? ''}`)
  if (result.quality_flags?.length) {
    lines.push(`Quality flags,"${result.quality_flags.join('; ')}"`)
  }
  lines.push('')
  lines.push('# Phases')
  lines.push('phase_name,formula,space_group,weight_pct,a,b,c,alpha,beta,gamma')
  for (const ph of result.phases) {
    lines.push([
      ph.phase_name ?? '',
      ph.formula ?? '',
      ph.hermann_mauguin ?? '',
      ph.weight_pct ?? '',
      ph.a ?? '',
      ph.b ?? '',
      ph.c ?? '',
      ph.alpha ?? '',
      ph.beta ?? '',
      ph.gamma ?? '',
    ].join(','))
  }
  return lines.join('\n')
}

export function buildRefinedCif(
  phase: XrdProRefineResult['phases'][number],
  rwp?: number,
): string {
  const name = phase.phase_name ?? phase.formula ?? 'refined_phase'
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const f = (v: number | undefined, dp = 5) => v != null ? v.toFixed(dp) : '?'
  const lines: string[] = [
    `data_${safe}`,
    '',
    `_cell_length_a                    ${f(phase.a)}`,
    `_cell_length_b                    ${f(phase.b)}`,
    `_cell_length_c                    ${f(phase.c)}`,
    `_cell_angle_alpha                 ${f(phase.alpha, 3)}`,
    `_cell_angle_beta                  ${f(phase.beta, 3)}`,
    `_cell_angle_gamma                 ${f(phase.gamma, 3)}`,
  ]
  if (phase.hermann_mauguin) {
    lines.push(`_symmetry_space_group_name_H-M    '${phase.hermann_mauguin}'`)
  }
  if (phase.weight_pct != null) {
    lines.push(`_pd_phase_mass_%                  ${phase.weight_pct.toFixed(2)}`)
  }
  if (rwp != null) {
    lines.push(`_refine_ls_R_factor_obs           ${rwp.toFixed(4)}`)
  }
  const rphase = phase.rphase as number | undefined
  if (rphase != null) {
    lines.push(`_refine_ls_R_factor_all           ${rphase.toFixed(4)}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function buildRefineCurveCsv(result: XrdProRefineResult): string {
  if (!result.x?.length) return ''
  const header = 'two_theta,observed,calculated,difference'
  const rows = result.x.map((x, i) =>
    [
      x,
      result.y_obs?.[i] ?? '',
      result.y_calc?.[i] ?? '',
      result.y_diff?.[i] ?? '',
    ].join(','),
  )
  return header + '\n' + rows.join('\n')
}
