// Types for the Library modal browser and the Paper artifact. Kept in the
// demo file so the feature stays self-contained until the Artifact union
// in src/types/artifact.ts is extended in the integration pass.

export interface LibraryPaper {
  id: string
  title: string
  authors: string[]
  year: number
  venue: string
  doi?: string
  abstract: string
  tags: string[]
  collectionId?: string
  pdfUrl?: string
  addedAt: number
}

export interface LibraryCollection {
  id: string
  name: string
  paperCount: number
}

export interface LibraryData {
  papers: LibraryPaper[]
  collections: LibraryCollection[]
  tags: string[]
}

export interface PaperAnnotation {
  id: string
  page: number
  note: string
  createdAt: number
}

export interface PaperExtraction {
  key: string
  value: string
  unit?: string
  page?: number
}

export interface PaperArtifactMetadata {
  title: string
  authors: string[]
  year: number
  venue: string
  doi?: string
  abstract: string
}

export interface PaperArtifactPayload {
  paperId: string
  metadata: PaperArtifactMetadata
  pdfUrl?: string
  annotations: PaperAnnotation[]
  extractions: PaperExtraction[]
}

// Deterministic timestamps so ordering is stable across demo reloads.
const EPOCH = 1_700_000_000_000
const day = (n: number) => EPOCH + n * 86_400_000

const COLLECTIONS: LibraryCollection[] = [
  { id: 'col-photocat', name: 'Photocatalysis', paperCount: 5 },
  { id: 'col-ferro', name: 'Ferroelectrics', paperCount: 3 },
  { id: 'col-dft', name: 'DFT Studies', paperCount: 4 },
]

const PAPERS: LibraryPaper[] = [
  {
    id: 'pap-001',
    title: 'Oxygen vacancy engineering in SrTiO3 for visible-light CO2 reduction',
    authors: ['L. Chen', 'M. Reyes', 'K. Watanabe'],
    year: 2023, venue: 'Nature Energy', doi: '10.1038/s41560-023-01234-5',
    abstract: 'A defect-engineered SrTiO3 photocatalyst with a tunable density of oxygen vacancies produces an 18% CO2-to-CO conversion under AM1.5G illumination. DFT calculations link the active site to a mid-gap state at 1.9 eV. Stability was maintained over 120 hours.',
    tags: ['perovskite', 'photocatalysis', 'CO2 reduction', 'oxygen vacancy'],
    collectionId: 'col-photocat', addedAt: day(12),
  },
  {
    id: 'pap-002',
    title: 'Room-temperature ferroelectricity in BaTiO3 thin films grown by pulsed laser deposition',
    authors: ['A. Ferrari', 'S. Park', 'J. Dupont'],
    year: 2022, venue: 'Chem. Mater.', doi: '10.1021/acs.chemmater.2c00789',
    abstract: 'Epitaxial BaTiO3 thin films on SrRuO3-buffered SrTiO3 exhibit a remanent polarization of 26 uC/cm^2 at 300 K. XRD confirms tetragonal P4mm with c/a = 1.011. Ferroelectric domains were imaged by piezoresponse force microscopy.',
    tags: ['perovskite', 'ferroelectric', 'thin film', 'XRD'],
    collectionId: 'col-ferro', addedAt: day(20),
  },
  {
    id: 'pap-003',
    title: 'First-principles study of polaron hopping in hematite alpha-Fe2O3',
    authors: ['R. Kumar', 'Y. Tanaka'],
    year: 2024, venue: 'Phys. Rev. B', doi: '10.1103/PhysRevB.109.045112',
    abstract: 'DFT with Hubbard U reveals a small-polaron hopping barrier of 0.27 eV in hematite, in agreement with transient absorption data. The anisotropy of the electron mobility is traced to distorted FeO6 octahedra along the c-axis.',
    tags: ['DFT', 'hematite', 'polaron', 'photocatalysis'],
    collectionId: 'col-dft', addedAt: day(36),
  },
  {
    id: 'pap-004',
    title: 'High-surface-area TiO2 nanosheets for enhanced photocatalytic hydrogen evolution',
    authors: ['H. Ikeda', 'C. Liu', 'P. Schneider'],
    year: 2021, venue: 'ACS Nano', doi: '10.1021/acsnano.1c05678',
    abstract: 'Exfoliated TiO2 nanosheets with a BET surface area of 217 m^2/g achieve an H2 rate of 4.2 mmol/g/h under UV. XPS and XRD confirm the dominance of the anatase (001) facet over a 48 h stability window.',
    tags: ['TiO2', 'photocatalysis', 'hydrogen', 'BET'],
    collectionId: 'col-photocat', addedAt: day(48),
  },
  {
    id: 'pap-005',
    title: 'Lead-free (K,Na)NbO3 piezoceramics with enhanced d33 via A-site engineering',
    authors: ['T. Nakamura', 'E. Alvarez'],
    year: 2020, venue: 'J. Mater. Chem. A', doi: '10.1039/D0TA03456F',
    abstract: 'Li+ and Sb5+ substitution in (K,Na)NbO3 raises the piezoelectric coefficient d33 to 425 pC/N while retaining a Curie temperature above 350 C. Rietveld refinement confirms a polymorphic phase boundary near room temperature.',
    tags: ['perovskite', 'ferroelectric', 'piezoelectric', 'Rietveld'],
    collectionId: 'col-ferro', addedAt: day(60),
  },
  {
    id: 'pap-006',
    title: 'Mechanistic insights into Z-scheme g-C3N4/BiVO4 heterojunctions for water oxidation',
    authors: ['D. Okafor', 'N. Volkov', 'S. Mehta'],
    year: 2024, venue: 'J. Mater. Chem. A', doi: '10.1039/D4TA01234K',
    abstract: 'A direct Z-scheme g-C3N4/BiVO4 heterojunction achieves an O2 evolution rate of 1.8 mmol/g/h. Transient absorption and DFT identify an interfacial charge-transfer pathway mediated by oxygen vacancies, doubling the charge-separation lifetime.',
    tags: ['photocatalysis', 'heterojunction', 'DFT', 'water splitting'],
    collectionId: 'col-photocat', addedAt: day(72),
  },
  {
    id: 'pap-007',
    title: 'Machine-learning-accelerated screening of halide double perovskites',
    authors: ['F. Rossi', 'Q. Zhang', 'I. Petrov'],
    year: 2023, venue: 'npj Comput. Mater.', doi: '10.1038/s41524-023-01100-9',
    abstract: 'A graph neural network trained on 18,000 DFT-computed halide double perovskites identifies 42 stable candidates with direct bandgaps between 1.2 and 2.0 eV. Ten were synthesized and four showed photoluminescence at the predicted wavelengths.',
    tags: ['DFT', 'perovskite', 'machine learning', 'bandgap'],
    collectionId: 'col-dft', addedAt: day(84),
  },
  {
    id: 'pap-008',
    title: 'XPS analysis of the Ni 2p line shape in layered LiNiO2 cathodes',
    authors: ['G. Baumann', 'V. Ortega'],
    year: 2022, venue: 'Chem. Mater.', doi: '10.1021/acs.chemmater.2c01890',
    abstract: 'High-resolution Ni 2p XPS of LiNiO2 at various states of charge reveals a continuous shift of the Ni(III)/Ni(IV) ratio. A Tougaard background with three Voigt components resolves the surface reduction layer, whose thickness correlates with capacity fade.',
    tags: ['XPS', 'battery', 'cathode', 'nickel'],
    addedAt: day(96),
  },
  {
    id: 'pap-009',
    title: 'Rietveld refinement of phase coexistence in PbZr0.52Ti0.48O3 near the MPB',
    authors: ['M. Hassan', 'R. Dubois'],
    year: 2021, venue: 'J. Appl. Cryst.', doi: '10.1107/S1600576721005678',
    abstract: 'Synchrotron XRD and Rietveld refinement reveal coexistence of tetragonal P4mm and rhombohedral R3m phases at the morphotropic boundary of PZT-52/48. Refined weight fractions correlate with the macroscopic piezoelectric response.',
    tags: ['Rietveld', 'XRD', 'ferroelectric', 'PZT'],
    collectionId: 'col-ferro', addedAt: day(108),
  },
  {
    id: 'pap-010',
    title: 'DFT+U study of the magnetic ground state of double perovskite Sr2FeMoO6',
    authors: ['U. Okonkwo', 'B. Iyer'],
    year: 2025, venue: 'Phys. Rev. B', doi: '10.1103/PhysRevB.111.094433',
    abstract: 'Spin-polarized DFT+U predicts a half-metallic ferrimagnetic ground state for Sr2FeMoO6 with a total moment of 4.0 uB per formula unit. The Mo 4d / Fe 3d hybridization gap at the Fermi level matches ARPES within 80 meV.',
    tags: ['DFT', 'double perovskite', 'magnetism', 'half-metal'],
    collectionId: 'col-dft', addedAt: day(120),
  },
  {
    id: 'pap-011',
    title: 'In-situ Raman study of phase transitions in BiFeO3 under high pressure',
    authors: ['K. Leblanc', 'T. Suzuki'],
    year: 2024, venue: 'ACS Nano', doi: '10.1021/acsnano.4c04567',
    abstract: 'Diamond-anvil-cell Raman identifies a reversible R3c -> Pnma transition in BiFeO3 at 5.2 GPa, accompanied by the collapse of the cycloidal magnetic order. DFT supports the structural pathway.',
    tags: ['BiFeO3', 'Raman', 'high pressure', 'DFT'],
    collectionId: 'col-dft', addedAt: day(132),
  },
  {
    id: 'pap-012',
    title: 'Facet-dependent CO2 photoreduction on single-crystal TiO2 supported Au nanoparticles',
    authors: ['N. Papadopoulos', 'J. Wu'],
    year: 2023, venue: 'J. Mater. Chem. A', doi: '10.1039/D3TA02345B',
    abstract: 'Au nanoparticles on TiO2 (101) facets show a 3.7x higher CO2-to-CH4 turnover frequency than those on (001), attributed to enhanced charge transfer identified by XPS and DFT. The BET surface area is 42 m^2/g.',
    tags: ['photocatalysis', 'CO2 reduction', 'TiO2', 'XPS'],
    collectionId: 'col-photocat', addedAt: day(144),
  },
]

const TAGS = Array.from(new Set(PAPERS.flatMap((p) => p.tags))).sort()

export const DEMO_LIBRARY: LibraryData = {
  papers: PAPERS,
  collections: COLLECTIONS,
  tags: TAGS,
}

const PROMOTED = PAPERS[11]

export const DEMO_PAPER_ARTIFACT: PaperArtifactPayload = {
  paperId: PROMOTED.id,
  metadata: {
    title: PROMOTED.title,
    authors: PROMOTED.authors,
    year: PROMOTED.year,
    venue: PROMOTED.venue,
    doi: PROMOTED.doi,
    abstract: PROMOTED.abstract,
  },
  pdfUrl: undefined,
  annotations: [
    { id: 'ann-1', page: 2, note: 'Synthesis: sol-gel route followed by calcination at 800 C in air for 4 h.', createdAt: day(145) },
    { id: 'ann-2', page: 4, note: 'Au 4f XPS shift of 0.3 eV indicates electron transfer from TiO2 to Au.', createdAt: day(146) },
    { id: 'ann-3', page: 7, note: 'TOF comparison table -- verify error bars in Fig. 5.', createdAt: day(148) },
  ],
  extractions: [
    { key: 'synthesis_temperature', value: '800', unit: 'C', page: 2 },
    { key: 'bandgap', value: '3.4', unit: 'eV', page: 3 },
    { key: 'space_group', value: 'P4mm', page: 3 },
    { key: 'bet_surface_area', value: '42', unit: 'm^2/g', page: 4 },
    { key: 'co2_conversion', value: '18', unit: '%', page: 6 },
  ],
}
