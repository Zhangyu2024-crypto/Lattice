/**
 * Element data for crystal structure rendering.
 *
 * CPK colors (hex strings), covalent radii (Angstrom), and van-der-Waals
 * radii for ~50 common elements in materials science. Pure data, zero
 * imports. Missing elements fall back to `DEFAULT_*` constants.
 */

export interface ElementDatum {
  /** CPK-style hex color, e.g. '#FF0000'. */
  color: string
  /** Covalent radius in Angstrom. */
  covalent: number
  /** Van-der-Waals radius in Angstrom. */
  vdw: number
}

/** Fallback color for unknown elements. */
export const DEFAULT_COLOR = '#C88033'

/** Fallback covalent radius (Angstrom). */
export const DEFAULT_COVALENT = 1.5

/** Fallback vdW radius (Angstrom). */
export const DEFAULT_VDW = 2.0

/**
 * Lookup table keyed by standard element symbol (case-sensitive).
 * Data sources: Jmol CPK palette, Cordero covalent radii, Bondi vdW.
 */
export const ELEMENT_DATA: Record<string, ElementDatum> = {
  H:  { color: '#FFFFFF', covalent: 0.31, vdw: 1.20 },
  He: { color: '#D9FFFF', covalent: 0.28, vdw: 1.40 },
  Li: { color: '#CC80FF', covalent: 1.28, vdw: 1.82 },
  Be: { color: '#C2FF00', covalent: 0.96, vdw: 1.53 },
  B:  { color: '#FFB5B5', covalent: 0.84, vdw: 1.92 },
  C:  { color: '#909090', covalent: 0.76, vdw: 1.70 },
  N:  { color: '#3050F8', covalent: 0.71, vdw: 1.55 },
  O:  { color: '#FF0D0D', covalent: 0.66, vdw: 1.52 },
  F:  { color: '#90E050', covalent: 0.57, vdw: 1.47 },
  Ne: { color: '#B3E3F5', covalent: 0.58, vdw: 1.54 },
  Na: { color: '#AB5CF2', covalent: 1.66, vdw: 2.27 },
  Mg: { color: '#8AFF00', covalent: 1.41, vdw: 1.73 },
  Al: { color: '#BFA6A6', covalent: 1.21, vdw: 1.84 },
  Si: { color: '#F0C8A0', covalent: 1.11, vdw: 2.10 },
  P:  { color: '#FF8000', covalent: 1.07, vdw: 1.80 },
  S:  { color: '#FFFF30', covalent: 1.05, vdw: 1.80 },
  Cl: { color: '#1FF01F', covalent: 1.02, vdw: 1.75 },
  Ar: { color: '#80D1E3', covalent: 1.06, vdw: 1.88 },
  K:  { color: '#8F40D4', covalent: 2.03, vdw: 2.75 },
  Ca: { color: '#3DFF00', covalent: 1.76, vdw: 2.31 },
  Sc: { color: '#E6E6E6', covalent: 1.70, vdw: 2.15 },
  Ti: { color: '#BFC2C7', covalent: 1.60, vdw: 2.11 },
  V:  { color: '#A6A6AB', covalent: 1.53, vdw: 2.07 },
  Cr: { color: '#8A99C7', covalent: 1.39, vdw: 2.06 },
  Mn: { color: '#9C7AC7', covalent: 1.39, vdw: 2.05 },
  Fe: { color: '#E06633', covalent: 1.32, vdw: 2.04 },
  Co: { color: '#F090A0', covalent: 1.26, vdw: 2.00 },
  Ni: { color: '#50D050', covalent: 1.24, vdw: 1.97 },
  Cu: { color: '#C88033', covalent: 1.32, vdw: 1.96 },
  Zn: { color: '#7D80B0', covalent: 1.22, vdw: 2.01 },
  Ga: { color: '#C28F8F', covalent: 1.22, vdw: 1.87 },
  Ge: { color: '#668F8F', covalent: 1.20, vdw: 2.11 },
  As: { color: '#BD80E3', covalent: 1.19, vdw: 1.85 },
  Se: { color: '#FFA100', covalent: 1.20, vdw: 1.90 },
  Br: { color: '#A62929', covalent: 1.20, vdw: 1.85 },
  Kr: { color: '#5CB8D1', covalent: 1.16, vdw: 2.02 },
  Rb: { color: '#702EB0', covalent: 2.20, vdw: 3.03 },
  Sr: { color: '#00FF00', covalent: 1.95, vdw: 2.49 },
  Y:  { color: '#94FFFF', covalent: 1.90, vdw: 2.19 },
  Zr: { color: '#94E0E0', covalent: 1.75, vdw: 2.23 },
  Nb: { color: '#73C2C9', covalent: 1.64, vdw: 2.18 },
  Mo: { color: '#54B5B5', covalent: 1.54, vdw: 2.17 },
  Ru: { color: '#248F8F', covalent: 1.46, vdw: 2.13 },
  Rh: { color: '#0A7D8C', covalent: 1.42, vdw: 2.10 },
  Pd: { color: '#006985', covalent: 1.39, vdw: 2.10 },
  Ag: { color: '#C0C0C0', covalent: 1.45, vdw: 2.11 },
  Cd: { color: '#FFD98F', covalent: 1.44, vdw: 2.18 },
  In: { color: '#A67573', covalent: 1.42, vdw: 1.93 },
  Sn: { color: '#668080', covalent: 1.39, vdw: 2.17 },
  Sb: { color: '#9E63B5', covalent: 1.39, vdw: 2.06 },
  Te: { color: '#D47A00', covalent: 1.38, vdw: 2.06 },
  I:  { color: '#940094', covalent: 1.39, vdw: 1.98 },
  Xe: { color: '#429EB0', covalent: 1.40, vdw: 2.16 },
  Cs: { color: '#57178F', covalent: 2.44, vdw: 3.43 },
  Ba: { color: '#00C900', covalent: 2.15, vdw: 2.68 },
  La: { color: '#70D4FF', covalent: 2.07, vdw: 2.43 },
  Ce: { color: '#FFFFC7', covalent: 2.04, vdw: 2.42 },
  Nd: { color: '#C7FFC7', covalent: 2.01, vdw: 2.39 },
  Sm: { color: '#8FFFC7', covalent: 1.98, vdw: 2.36 },
  Gd: { color: '#45FFC7', covalent: 1.96, vdw: 2.34 },
  Dy: { color: '#1FFFC7', covalent: 1.92, vdw: 2.31 },
  Er: { color: '#00E675', covalent: 1.89, vdw: 2.29 },
  Yb: { color: '#00BF38', covalent: 1.87, vdw: 2.26 },
  Lu: { color: '#00AB24', covalent: 1.87, vdw: 2.24 },
  Hf: { color: '#4DC2FF', covalent: 1.75, vdw: 2.23 },
  Ta: { color: '#4DA6FF', covalent: 1.70, vdw: 2.22 },
  W:  { color: '#2194D6', covalent: 1.62, vdw: 2.18 },
  Re: { color: '#267DAB', covalent: 1.51, vdw: 2.16 },
  Os: { color: '#266696', covalent: 1.44, vdw: 2.16 },
  Ir: { color: '#175487', covalent: 1.41, vdw: 2.13 },
  Pt: { color: '#D0D0E0', covalent: 1.36, vdw: 2.13 },
  Au: { color: '#FFD123', covalent: 1.36, vdw: 2.14 },
  Hg: { color: '#B8B8D0', covalent: 1.32, vdw: 2.23 },
  Tl: { color: '#A6544D', covalent: 1.45, vdw: 1.96 },
  Pb: { color: '#575961', covalent: 1.46, vdw: 2.02 },
  Bi: { color: '#9E4FB5', covalent: 1.48, vdw: 2.07 },
  U:  { color: '#008FFF', covalent: 1.96, vdw: 2.41 },
}

/** Safely retrieve the color for a given element symbol. */
export function elementColor(symbol: string): string {
  return ELEMENT_DATA[symbol]?.color ?? DEFAULT_COLOR
}

/** Safely retrieve the covalent radius for a given element symbol. */
export function elementCovalentRadius(symbol: string): number {
  return ELEMENT_DATA[symbol]?.covalent ?? DEFAULT_COVALENT
}

/** Safely retrieve the vdW radius for a given element symbol. */
export function elementVdwRadius(symbol: string): number {
  return ELEMENT_DATA[symbol]?.vdw ?? DEFAULT_VDW
}
