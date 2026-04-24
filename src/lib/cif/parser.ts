/**
 * CIF text → `ParsedCif`. Single-pass, line-oriented.
 *
 * Scope (same as the top-level module docstring):
 *   - P1-expanded CIFs with an explicit `loop_` of `_atom_site_*` columns.
 *   - Column order is detected from the headers.
 *   - Non-atom loops are tolerated but not preserved.
 *   - Comments and blank lines are stripped before parsing.
 */

import type { CifSite, LatticeParams, ParsedCif } from './types'
import {
  indexOfCol,
  parseNumberField,
  parseStringField,
  stripStdDev,
  tokenizeCifRow,
} from './helpers'

export function parseCif(text: string): ParsedCif {
  const rawLines = text.split(/\r?\n/)
  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))

  let dataBlock = 'structure'
  const lattice: Partial<LatticeParams> = {}
  let spaceGroup: string | null = null
  const sites: CifSite[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('data_')) {
      dataBlock = line.slice(5) || 'structure'
      i++
      continue
    }

    if (line.startsWith('_cell_length_a')) {
      lattice.a = parseNumberField(line, '_cell_length_a')
      i++
      continue
    }
    if (line.startsWith('_cell_length_b')) {
      lattice.b = parseNumberField(line, '_cell_length_b')
      i++
      continue
    }
    if (line.startsWith('_cell_length_c')) {
      lattice.c = parseNumberField(line, '_cell_length_c')
      i++
      continue
    }
    if (line.startsWith('_cell_angle_alpha')) {
      lattice.alpha = parseNumberField(line, '_cell_angle_alpha')
      i++
      continue
    }
    if (line.startsWith('_cell_angle_beta')) {
      lattice.beta = parseNumberField(line, '_cell_angle_beta')
      i++
      continue
    }
    if (line.startsWith('_cell_angle_gamma')) {
      lattice.gamma = parseNumberField(line, '_cell_angle_gamma')
      i++
      continue
    }
    if (
      line.startsWith('_symmetry_space_group_name_H-M') ||
      line.startsWith('_space_group_name_H-M_alt')
    ) {
      spaceGroup = parseStringField(line)
      i++
      continue
    }

    if (line === 'loop_') {
      const { sites: loopSites, nextIndex } = parseLoop(lines, i + 1)
      sites.push(...loopSites)
      i = nextIndex
      continue
    }

    i++
  }

  if (
    lattice.a === undefined ||
    lattice.b === undefined ||
    lattice.c === undefined ||
    lattice.alpha === undefined ||
    lattice.beta === undefined ||
    lattice.gamma === undefined
  ) {
    throw new Error('CIF missing one or more cell parameters')
  }
  if (sites.length === 0) {
    throw new Error('CIF has no atom sites (need a loop_ with _atom_site_* columns)')
  }

  return {
    dataBlock,
    lattice: lattice as LatticeParams,
    spaceGroup,
    sites,
  }
}

interface LoopResult {
  sites: CifSite[]
  nextIndex: number
}

function parseLoop(lines: string[], startIdx: number): LoopResult {
  const headers: string[] = []
  let i = startIdx
  while (i < lines.length && lines[i].startsWith('_')) {
    headers.push(lines[i])
    i++
  }

  // Is this the atom-site loop? We need at least label/type/fract_x/y/z.
  const colIdx = {
    label: indexOfCol(headers, '_atom_site_label'),
    element: indexOfCol(headers, '_atom_site_type_symbol'),
    fx: indexOfCol(headers, '_atom_site_fract_x'),
    fy: indexOfCol(headers, '_atom_site_fract_y'),
    fz: indexOfCol(headers, '_atom_site_fract_z'),
    occ: indexOfCol(headers, '_atom_site_occupancy'),
  }
  const isAtomLoop =
    colIdx.fx >= 0 && colIdx.fy >= 0 && colIdx.fz >= 0 && colIdx.element >= 0

  const sites: CifSite[] = []
  const ncol = headers.length
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('_') || line === 'loop_' || line.startsWith('data_')) {
      break
    }
    if (isAtomLoop) {
      const tokens = tokenizeCifRow(line)
      if (tokens.length >= ncol) {
        const row = tokens.slice(0, ncol)
        sites.push({
          label: colIdx.label >= 0 ? row[colIdx.label] : row[colIdx.element] + sites.length,
          element: row[colIdx.element],
          fx: stripStdDev(row[colIdx.fx]),
          fy: stripStdDev(row[colIdx.fy]),
          fz: stripStdDev(row[colIdx.fz]),
          occ: colIdx.occ >= 0 ? stripStdDev(row[colIdx.occ]) : 1,
        })
      }
    }
    i++
  }
  return { sites, nextIndex: i }
}
