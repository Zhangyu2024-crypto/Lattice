type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive'
type EvidenceStrength = 'strong' | 'moderate' | 'weak'

interface HypEvidence {
  id: string
  artifactId?: string
  note: string
  strength: EvidenceStrength
  direction: 'supports' | 'refutes'
  createdAt: number
}

interface Hypothesis {
  id: string
  statement: string
  status: HypothesisStatus
  confidence: number
  createdAt: number
  updatedAt: number
  evidence: HypEvidence[]
  nextTests: string[]
  tags: string[]
}

interface HypothesisPayload {
  topic: string
  hypotheses: Hypothesis[]
}

const DAY = 86_400_000
const NOW = 1_744_243_200_000 // stable fixture time (2025-04-10)

export const DEMO_HYPOTHESIS: HypothesisPayload = {
  topic: 'Fe-doped BaTiO3 photocatalysis mechanism',
  hypotheses: [
    {
      id: 'hyp_1',
      statement:
        'Fe substitution at Ti sites introduces mid-gap states enabling visible-light absorption',
      status: 'supported',
      confidence: 0.82,
      createdAt: NOW - 21 * DAY,
      updatedAt: NOW - 2 * DAY,
      tags: ['electronic_structure', 'photocatalysis'],
      evidence: [
        {
          id: 'ev_1_1',
          artifactId: 'demo_art_uvvis_01',
          note:
            'UV-Vis DRS shows a clear absorption tail extending to ~580 nm at 3% Fe doping, absent in undoped BaTiO3. Tauc plot gives an optical gap drop from 3.20 eV to 2.45 eV.',
          strength: 'strong',
          direction: 'supports',
          createdAt: NOW - 20 * DAY,
        },
        {
          id: 'ev_1_2',
          artifactId: 'demo_art_xps_fe2p',
          note:
            'XPS Fe 2p3/2 peak at 710.6 eV with 2p1/2 satellite near 724 eV is consistent with Fe(III) in an octahedral Ti site environment. No metallic Fe0 detected.',
          strength: 'strong',
          direction: 'supports',
          createdAt: NOW - 18 * DAY,
        },
        {
          id: 'ev_1_3',
          artifactId: 'demo_art_dft_dos',
          note:
            'Spin-polarized DFT+U (U=4 eV on Fe-3d) places occupied Fe-3d states ~0.9 eV above the O-2p VBM and unoccupied states ~0.6 eV below the Ti-3d CBM, matching the observed sub-gap absorption.',
          strength: 'moderate',
          direction: 'supports',
          createdAt: NOW - 10 * DAY,
        },
        {
          id: 'ev_1_4',
          note:
            'XRD refinement shows no measurable lattice parameter shift below 1% Fe, weakly arguing that sub-percent Fe may be interstitial rather than substitutional.',
          strength: 'weak',
          direction: 'refutes',
          createdAt: NOW - 8 * DAY,
        },
      ],
      nextTests: [
        'Mössbauer spectroscopy to directly confirm Fe(III) octahedral coordination and rule out Fe(II) contribution',
        'Temperature-dependent photoluminescence quenching to map the mid-gap state lifetime',
      ],
    },
    {
      id: 'hyp_2',
      statement:
        'Oxygen vacancies dominate the visible-light response rather than Fe substitution',
      status: 'open',
      confidence: 0.45,
      createdAt: NOW - 18 * DAY,
      updatedAt: NOW - 4 * DAY,
      tags: ['defects', 'photocatalysis'],
      evidence: [
        {
          id: 'ev_2_1',
          artifactId: 'demo_art_epr',
          note:
            'EPR signal at g=2.003 scales with reducing-atmosphere annealing, independent of Fe content, hinting that Vo centers alone contribute to sub-gap absorption.',
          strength: 'moderate',
          direction: 'supports',
          createdAt: NOW - 15 * DAY,
        },
        {
          id: 'ev_2_2',
          note:
            'Reoxidation in O2 at 600 C only partially restores the band edge, leaving a residual tail attributable to Fe. Ambiguous between the two hypotheses.',
          strength: 'weak',
          direction: 'refutes',
          createdAt: NOW - 5 * DAY,
        },
      ],
      nextTests: [
        'Parametric study decoupling Fe content from oxygen partial pressure during synthesis',
        'In-situ XPS O 1s depth profiling to quantify Vo population vs. Fe content',
        'Positron annihilation spectroscopy for vacancy-type discrimination',
      ],
    },
    {
      id: 'hyp_3',
      statement: 'Fe-Fe clustering at >5% doping quenches photoactivity',
      status: 'inconclusive',
      confidence: 0.55,
      createdAt: NOW - 14 * DAY,
      updatedAt: NOW - 3 * DAY,
      tags: ['clustering', 'photocatalysis'],
      evidence: [
        {
          id: 'ev_3_1',
          artifactId: 'demo_art_tem_eds',
          note:
            'HAADF-STEM with EDS mapping at 6% nominal Fe shows faint 2-3 nm Fe-rich domains, but statistics are limited to 4 grains.',
          strength: 'moderate',
          direction: 'supports',
          createdAt: NOW - 12 * DAY,
        },
        {
          id: 'ev_3_2',
          artifactId: 'demo_art_photocat_curve',
          note:
            'Methylene-blue degradation rate peaks near 3% Fe and drops by ~40% at 7% Fe, consistent with an activity maximum followed by quenching.',
          strength: 'moderate',
          direction: 'supports',
          createdAt: NOW - 9 * DAY,
        },
        {
          id: 'ev_3_3',
          note:
            'DFT supercell calculations (2x2x2) predict only marginal Fe-Fe exchange coupling at 6%, suggesting clustering alone is insufficient to quench the entire mid-gap channel.',
          strength: 'moderate',
          direction: 'refutes',
          createdAt: NOW - 3 * DAY,
        },
      ],
      nextTests: [
        'Atom probe tomography on a 6% Fe sample to directly map Fe clustering statistics',
        'Synchrotron EXAFS on Fe K-edge to quantify Fe-Fe coordination number vs. doping',
      ],
    },
    {
      id: 'hyp_4',
      statement:
        'Surface Fe2O3 islands act as recombination centers at high doping',
      status: 'refuted',
      confidence: 0.18,
      createdAt: NOW - 10 * DAY,
      updatedAt: NOW - 1 * DAY,
      tags: ['surface', 'defects'],
      evidence: [
        {
          id: 'ev_4_1',
          artifactId: 'demo_art_xrd_highfe',
          note:
            'High-resolution XRD on 8% Fe samples shows no detectable Fe2O3 reflections (detection limit ~0.5 wt%), strongly arguing against surface Fe2O3 islands.',
          strength: 'strong',
          direction: 'refutes',
          createdAt: NOW - 7 * DAY,
        },
        {
          id: 'ev_4_2',
          artifactId: 'demo_art_xps_survey',
          note:
            'XPS Fe 2p lineshape and binding energy match Fe(III) in BaTiO3 lattice with no Fe2O3 satellite signature; surface-sensitive AR-XPS also flat across take-off angles.',
          strength: 'strong',
          direction: 'refutes',
          createdAt: NOW - 1 * DAY,
        },
      ],
      nextTests: [
        'LEIS surface analysis on 8% Fe to rule out sub-monolayer Fe2O3 below XRD detection limit',
      ],
    },
  ],
}
