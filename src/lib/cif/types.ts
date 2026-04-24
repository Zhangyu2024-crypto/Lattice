/**
 * Public types for the CIF parser / writer / transforms.
 *
 * Kept in a separate module so consumers can `import type` these
 * interfaces without pulling any runtime code through the barrel.
 */

export interface LatticeParams {
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
}

export interface CifSite {
  label: string
  element: string
  fx: number
  fy: number
  fz: number
  occ: number
}

export interface ParsedCif {
  dataBlock: string
  lattice: LatticeParams
  spaceGroup: string | null
  sites: CifSite[]
}
