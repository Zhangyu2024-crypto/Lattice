interface Citation {
  id: string
  doi?: string
  title: string
  authors: string[]
  year: number
  venue?: string
  url?: string
}
interface ReportSection {
  id: string
  heading: string
  level: 1 | 2 | 3
  markdown: string
  citationIds: string[]
}
interface ResearchReportPayload {
  topic: string
  mode: 'research' | 'survey'
  style: 'concise' | 'comprehensive'
  sections: ReportSection[]
  citations: Citation[]
  generatedAt: number
}

const CITATIONS: Citation[] = [
  {
    id: 'c1',
    title: 'Photocatalytic water splitting on perovskite oxides: principles and progress',
    authors: ['R. Abe', 'K. Maeda'],
    year: 2022,
    venue: 'Nature Energy',
    doi: '10.1038/s41560-022-01001-2',
  },
  {
    id: 'c2',
    title: 'Band engineering of BaTiO3 for visible-light photocatalysis',
    authors: ['J. Chen', 'Y. Wang', 'S. Li'],
    year: 2023,
    venue: 'Chemistry of Materials',
    doi: '10.1021/acs.chemmater.3b00412',
  },
  {
    id: 'c3',
    title: 'Ferroelectric polarization enhanced charge separation in BaTiO3 nanocrystals',
    authors: ['M. Tanaka', 'H. Kato'],
    year: 2021,
    venue: 'Journal of the American Chemical Society',
    doi: '10.1021/jacs.1c05678',
  },
  {
    id: 'c4',
    title: 'Nitrogen doping of SrTiO3 for solar hydrogen production',
    authors: ['P. Kumar', 'S. Das', 'A. Roy'],
    year: 2020,
    venue: 'Journal of Materials Chemistry A',
    doi: '10.1039/d0ta04523c',
  },
  {
    id: 'c5',
    title: 'Oxygen vacancy engineering in perovskite photocatalysts',
    authors: ['L. Zhang', 'W. Liu'],
    year: 2023,
    venue: 'Applied Physics Letters',
    doi: '10.1063/5.0145012',
  },
  {
    id: 'c6',
    title: 'Cocatalyst loading strategies for perovskite water splitting systems',
    authors: ['E. Miller', 'T. Jaramillo'],
    year: 2022,
    venue: 'ACS Catalysis',
    doi: '10.1021/acscatal.2c03322',
  },
  {
    id: 'c7',
    title: 'Aliovalent doping of BaTiO3: bandgap narrowing and defect physics',
    authors: ['N. Park', 'J. Kim', 'B. Lee'],
    year: 2024,
    venue: 'Chemistry of Materials',
    doi: '10.1021/acs.chemmater.4b00287',
  },
  {
    id: 'c8',
    title: 'Recent advances in SrTiO3-based photocatalysts for overall water splitting',
    authors: ['T. Takata', 'K. Domen'],
    year: 2023,
    venue: 'Nature Energy',
    doi: '10.1038/s41560-023-01234-6',
  },
  {
    id: 'c9',
    title: 'Surface facet engineering in perovskite photocatalysis',
    authors: ['F. Garcia', 'D. Ramos'],
    year: 2024,
    venue: 'Journal of Materials Chemistry A',
    doi: '10.1039/d3ta07891f',
  },
  {
    id: 'c10',
    title: 'Scalable synthesis of high-purity BaTiO3 for energy applications',
    authors: ['H. Suzuki', 'M. Yamamoto'],
    year: 2025,
    venue: 'Chemistry of Materials',
    doi: '10.1021/acs.chemmater.5b00118',
  },
]

const SECTIONS: ReportSection[] = [
  {
    id: 'sec-intro',
    heading: '1. Introduction',
    level: 1,
    markdown: `Photocatalytic water splitting is one of the most promising routes to clean hydrogen production, converting solar energy directly into storable chemical fuel. Among candidate materials, **perovskite oxides** (ABO3) have attracted significant attention due to their chemical stability, tunable band structure, and ferroelectric properties [@cite:c1].

BaTiO3 and SrTiO3 are the two most-studied perovskite photocatalysts, each offering distinct advantages. While SrTiO3 has historically dominated in overall water splitting yields [@cite:c8], recent progress in BaTiO3 ferroelectric engineering has opened new pathways for charge separation [@cite:c3].

This report surveys recent advances in perovskite oxide photocatalysts with an emphasis on BaTiO3, doping strategies, comparative performance against SrTiO3, and developments reported in 2023-2025.`,
    citationIds: ['c1', 'c8', 'c3'],
  },
  {
    id: 'sec-batio3',
    heading: '2. BaTiO3: Structure and Photocatalytic Properties',
    level: 1,
    markdown: `BaTiO3 crystallizes in the tetragonal P4mm space group at room temperature, with a spontaneous polarization along the c-axis. Its native bandgap of ~3.2 eV restricts absorption to the ultraviolet region, which limits solar harvesting efficiency [@cite:c2].

The ferroelectric polarization creates an internal electric field that can spatially separate photo-generated electron-hole pairs, reducing bulk recombination. Tanaka et al. showed that domain walls in nanocrystalline BaTiO3 act as preferred channels for charge transport [@cite:c3].

Key intrinsic properties relevant to photocatalysis:

| Property | Value | Reference |
|---|---|---|
| Bandgap (Eg) | 3.20 eV | [@cite:c2] |
| Lattice (a,c) | 3.992, 4.036 A | [@cite:c3] |
| Ps (polarization) | 26 uC/cm^2 | [@cite:c3] |
| Dielectric constant | ~1700 | [@cite:c2] |

These parameters make BaTiO3 a strong candidate once its bandgap is narrowed into the visible range.`,
    citationIds: ['c2', 'c3'],
  },
  {
    id: 'sec-doping',
    heading: '3. Doping Strategies',
    level: 1,
    markdown: `Doping is the principal route to tune the electronic structure of BaTiO3. Aliovalent substitution at the A- or B-site can introduce mid-gap states or shift band edges, enabling visible-light absorption.

Park et al. demonstrated that Fe^3+ substitution at the Ti^4+ site narrows the bandgap to 2.6 eV while preserving the tetragonal symmetry [@cite:c7]. Nitrogen doping via thermal ammonolysis has also been reported to generate N 2p states above the O 2p valence band edge [@cite:c4].

> Oxygen vacancies, long treated as detrimental defects, are now recognized as active sites that mediate electron trapping and hydrogen evolution kinetics [@cite:c5].

A representative Fe-doping synthesis recipe is shown below.

\`\`\`python
# BaTi(1-x)FexO3 via sol-gel
precursor = mix(Ba_acetate, Ti_butoxide, Fe_nitrate, x=0.05)
gel = hydrolyze(precursor, ph=4.5, T=65)
powder = calcine(gel, T=900, hours=4, atmosphere="O2")
\`\`\`

Comparative performance across dopants is summarized in Section 5.`,
    citationIds: ['c4', 'c5', 'c7'],
  },
  {
    id: 'sec-comparison',
    heading: '4. Comparison with SrTiO3',
    level: 1,
    markdown: `SrTiO3 has historically produced the highest apparent quantum yields for overall water splitting, with Takata and Domen reporting an external quantum efficiency exceeding 96% at 365 nm on Al-doped SrTiO3 loaded with Rh/Cr2O3 and CoOOH cocatalysts [@cite:c8].

BaTiO3 trails SrTiO3 in absolute yield but offers stronger intrinsic polarization, which can improve charge separation without resorting to heterojunctions. Kumar et al. noted that N-doped SrTiO3 benefits less from ferroelectric effects because the cubic phase lacks spontaneous polarization [@cite:c4].

A practical comparison of state-of-the-art cocatalyst-loaded systems [@cite:c6]:

- **BaTiO3 (Fe-doped, Pt/NiOx)**: AQY ~4.5% at 420 nm
- **SrTiO3 (Al-doped, Rh-Cr2O3/CoOOH)**: AQY >96% at 365 nm
- **BaTiO3 (polarized, bare)**: AQY ~0.8% at 365 nm

BaTiO3 remains competitive only once bandgap-narrowed into the visible regime; SrTiO3 dominates under UV-only conditions.`,
    citationIds: ['c4', 'c6', 'c8'],
  },
  {
    id: 'sec-advances',
    heading: '5. Recent Advances (2023-2025)',
    level: 1,
    markdown: `Work published between 2023 and 2025 has sharpened the focus on three fronts: facet engineering, defect control, and scalable synthesis.

**Facet engineering.** Garcia and Ramos exposed {001} facets of BaTiO3 via hydrothermal routes and observed a 3.1x improvement in H2 evolution rate compared to polycrystalline references [@cite:c9]. Similar gains have been reported on SrTiO3 {100} surfaces.

**Defect control.** Zhang and Liu employed in-situ XPS and EPR to correlate oxygen vacancy concentration with photocurrent, identifying an optimal Vo density near 2.3 at% [@cite:c5].

**Scalable synthesis.** Suzuki and Yamamoto reported a continuous-flow molten-salt synthesis that produces phase-pure BaTiO3 at gram-per-hour throughput with tight particle size distributions [@cite:c10].

The combined effect of these strategies suggests that BaTiO3-based visible-light photocatalysts may soon approach the practical benchmarks established by optimized SrTiO3 systems.`,
    citationIds: ['c5', 'c9', 'c10'],
  },
  {
    id: 'sec-conclusions',
    heading: '6. Conclusions',
    level: 1,
    markdown: `Perovskite oxides remain among the most versatile platforms for photocatalytic water splitting. BaTiO3 offers a unique combination of ferroelectricity and chemical stability, and recent progress in bandgap engineering, defect control, and facet exposure is closing the performance gap with SrTiO3 [@cite:c2] [@cite:c7] [@cite:c9].

Future work should prioritize (i) stable visible-light absorption at bandgaps below 2.3 eV, (ii) cocatalyst pairings compatible with polarization-driven charge separation, and (iii) scalable synthesis suitable for panel-scale photoreactors [@cite:c6] [@cite:c10].`,
    citationIds: ['c2', 'c6', 'c7', 'c9', 'c10'],
  },
]

export const DEMO_RESEARCH_REPORT: ResearchReportPayload = {
  topic: 'Perovskite oxides for photocatalytic water splitting',
  mode: 'research',
  style: 'comprehensive',
  sections: SECTIONS,
  citations: CITATIONS,
  generatedAt: Date.now() - 300000,
}
