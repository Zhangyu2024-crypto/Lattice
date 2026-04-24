interface SimilarityMatrixPayload {
  sources: Array<{ id: string; label: string }>
  metric: 'pearson' | 'cosine'
  matrix: number[][]
  computedAt: number
}

// A symmetric 6×6 similarity matrix across 6 perovskite XRD patterns.
// Diagonal = 1.0; off-diagonal values chosen to reflect plausible
// lattice-parameter similarity between these related perovskites.
const SOURCES = [
  { id: 'src_batio3', label: 'BaTiO3' },
  { id: 'src_srtio3', label: 'SrTiO3' },
  { id: 'src_pbtio3', label: 'PbTiO3' },
  { id: 'src_catio3', label: 'CaTiO3' },
  { id: 'src_tio2_anatase', label: 'TiO2 anatase' },
  { id: 'src_tio2_rutile', label: 'TiO2 rutile' },
]

const SYM_MATRIX: number[][] = [
  [1.00, 0.88, 0.93, 0.81, 0.42, 0.38],
  [0.88, 1.00, 0.86, 0.84, 0.45, 0.40],
  [0.93, 0.86, 1.00, 0.78, 0.39, 0.36],
  [0.81, 0.84, 0.78, 1.00, 0.48, 0.44],
  [0.42, 0.45, 0.39, 0.48, 1.00, 0.72],
  [0.38, 0.40, 0.36, 0.44, 0.72, 1.00],
]

export const DEMO_SIMILARITY_MATRIX: SimilarityMatrixPayload = {
  sources: SOURCES,
  metric: 'pearson',
  matrix: SYM_MATRIX,
  computedAt: Date.now() - 45_000,
}
