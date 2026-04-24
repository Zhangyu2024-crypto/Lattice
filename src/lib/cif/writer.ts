/**
 * `ParsedCif` → CIF text.
 *
 * Emits a P1-style block with an explicit `_atom_site_*` loop and the
 * same field ordering/spacing every time so that parsing our own output
 * is a stable round-trip invariant (exercised by the dev helper in the
 * parent `cif.ts` entry point).
 */

import type { ParsedCif } from './types'
import { fmtFloat, fmtFrac } from './helpers'

export function writeCif(parsed: ParsedCif, dataBlock?: string): string {
  const block = dataBlock ?? parsed.dataBlock ?? 'structure'
  const l = parsed.lattice
  const sg = parsed.spaceGroup ?? 'P 1'
  const lines: string[] = []
  lines.push(`data_${block}`)
  lines.push(`_cell_length_a    ${fmtFloat(l.a, 5)}`)
  lines.push(`_cell_length_b    ${fmtFloat(l.b, 5)}`)
  lines.push(`_cell_length_c    ${fmtFloat(l.c, 5)}`)
  lines.push(`_cell_angle_alpha ${fmtFloat(l.alpha, 3)}`)
  lines.push(`_cell_angle_beta  ${fmtFloat(l.beta, 3)}`)
  lines.push(`_cell_angle_gamma ${fmtFloat(l.gamma, 3)}`)
  lines.push(`_symmetry_space_group_name_H-M '${sg}'`)
  lines.push('loop_')
  lines.push('_atom_site_label')
  lines.push('_atom_site_type_symbol')
  lines.push('_atom_site_fract_x')
  lines.push('_atom_site_fract_y')
  lines.push('_atom_site_fract_z')
  lines.push('_atom_site_occupancy')
  for (const s of parsed.sites) {
    lines.push(
      `${s.label.padEnd(6)} ${s.element.padEnd(3)} ${fmtFrac(s.fx)} ${fmtFrac(s.fy)} ${fmtFrac(s.fz)} ${fmtFloat(s.occ, 3)}`,
    )
  }
  lines.push('')
  return lines.join('\n')
}
