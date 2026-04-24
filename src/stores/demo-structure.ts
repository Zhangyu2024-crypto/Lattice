interface LatticeParams {
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
}

interface StructureTransform {
  id: string
  kind: 'supercell' | 'dope' | 'surface' | 'defect'
  params: Record<string, unknown>
  appliedAt: number
  note?: string
}

interface StructureArtifactPayload {
  cif: string
  formula: string
  spaceGroup: string
  latticeParams: LatticeParams
  transforms: StructureTransform[]
  computedFromArtifactId?: string
}

const BATIO3_CIF = `data_BaTiO3
_symmetry_space_group_name_H-M 'P 4 m m'
_cell_length_a 3.99400
_cell_length_b 3.99400
_cell_length_c 4.03800
_cell_angle_alpha 90.00
_cell_angle_beta 90.00
_cell_angle_gamma 90.00
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ba1 Ba 0.00000 0.00000 0.00000
Ti1 Ti 0.50000 0.50000 0.51200
O1  O  0.50000 0.50000 0.01800
O2  O  0.50000 0.00000 0.48600
O3  O  0.00000 0.50000 0.48600
`

const NOW = Date.now()
const FIVE_MIN = 5 * 60 * 1000
const THREE_MIN = 3 * 60 * 1000

function buildPayload(): StructureArtifactPayload {
  return {
    cif: BATIO3_CIF,
    formula: 'BaTiO3',
    spaceGroup: 'P4mm',
    latticeParams: {
      a: 3.994,
      b: 3.994,
      c: 4.038,
      alpha: 90,
      beta: 90,
      gamma: 90,
    },
    transforms: [
      {
        id: 'tr-supercell-1',
        kind: 'supercell',
        params: { nx: 2, ny: 2, nz: 2 },
        appliedAt: NOW - THREE_MIN,
        note: '2x2x2 cell',
      },
    ],
    computedFromArtifactId: 'xrd-analysis-batio3',
  }
}

export const DEMO_STRUCTURE: StructureArtifactPayload = buildPayload()
