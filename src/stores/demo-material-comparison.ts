interface CompMaterial {
  id: string
  name: string
  formula: string
  paperRef?: string
}

interface CompProperty {
  key: string
  label: string
  unit?: string
  higherIsBetter?: boolean
}

interface MaterialComparisonPayload {
  materials: CompMaterial[]
  properties: CompProperty[]
  values: (number | null)[][]
  timeline?: { materialId: string; year: number }[]
}

const MATERIALS: CompMaterial[] = [
  { id: 'mat-batio3', name: 'Barium Titanate', formula: 'BaTiO3', paperRef: 'Megaw 1945' },
  { id: 'mat-srtio3', name: 'Strontium Titanate', formula: 'SrTiO3', paperRef: 'Lytle 1964' },
  { id: 'mat-pbtio3', name: 'Lead Titanate', formula: 'PbTiO3', paperRef: 'Shirane 1951' },
  { id: 'mat-catio3', name: 'Calcium Titanate (Perovskite)', formula: 'CaTiO3', paperRef: 'Rose 1839' },
  { id: 'mat-knbo3', name: 'Potassium Niobate', formula: 'KNbO3', paperRef: 'Matthias 1960' },
  { id: 'mat-linbo3', name: 'Lithium Niobate', formula: 'LiNbO3', paperRef: 'Weis 1985' },
]

const PROPERTIES: CompProperty[] = [
  { key: 'bandgap_eV', label: 'Bandgap', unit: 'eV', higherIsBetter: false },
  { key: 'tc_K', label: 'Curie T', unit: 'K', higherIsBetter: true },
  { key: 'dielectric_constant', label: 'Dielectric ε', higherIsBetter: true },
  { key: 'density_g_cm3', label: 'Density', unit: 'g/cm³' },
  { key: 'refractive_index', label: 'Refractive Index' },
  { key: 'piezoelectric_d33_pCN', label: 'd33', unit: 'pC/N', higherIsBetter: true },
  { key: 'lattice_a_angstrom', label: 'Lattice a', unit: 'Å' },
  { key: 'thermal_expansion', label: 'TEC', unit: '10⁻⁶/K' },
]

// Rows aligned with MATERIALS order, columns aligned with PROPERTIES order.
const VALUES: (number | null)[][] = [
  // BaTiO3
  [3.4, 393, 1500, 6.08, 2.40, 190, 3.994, 10.7],
  // SrTiO3  — cubic above ~105K, no d33
  [3.2, 105, 300, 5.12, 2.41, null, 3.905, 9.4],
  // PbTiO3
  [3.6, 763, 210, 7.97, 2.71, 117, 3.904, 6.8],
  // CaTiO3  — no ferroelectric Tc, no d33
  [3.5, null, 150, 3.98, 2.38, null, 3.826, 11.2],
  // KNbO3
  [3.3, 708, 700, 4.62, 2.28, 98, 3.971, 8.9],
  // LiNbO3
  [3.78, 1483, 85, 4.65, 2.29, 6, 5.148, 14.1],
]

const TIMELINE: { materialId: string; year: number }[] = [
  { materialId: 'mat-batio3', year: 1943 },
  { materialId: 'mat-srtio3', year: 1953 },
  { materialId: 'mat-pbtio3', year: 1950 },
  { materialId: 'mat-catio3', year: 1839 },
  { materialId: 'mat-knbo3', year: 1960 },
  { materialId: 'mat-linbo3', year: 1965 },
]

export const DEMO_MATERIAL_COMPARISON: MaterialComparisonPayload = {
  materials: MATERIALS,
  properties: PROPERTIES,
  values: VALUES,
  timeline: TIMELINE,
}
