// CP2K-language snippets for the Compute Pro workbench.
//
// Ported from lattice-cli/src/lattice_cli/tools/compute_exec.py
// (the `_BUILTIN_SNIPPETS` array). See ./python.ts for the full note on
// the session-context globals and origin line numbers.

import type { ComputeSnippet } from '../../types/pro-api'

export const CP2K_SNIPPETS: ComputeSnippet[] = [
  {
    id: 'cp2k_cell_opt',
    title: 'CP2K CELL_OPT (template)',
    name: 'CP2K CELL_OPT',
    description:
      'Cell + atomic relaxation scaffold. Shipped with a cubic BaTiO3 example cell — edit SUBSYS / CELL / COORD / KIND blocks for the target material, or pass a `customizations` hint (e.g. "use Si diamond structure") so the LLM rewrites it before creation.',
    category: 'DFT',
    language: 'cp2k',
    code: `! Template: cubic BaTiO3. Replace CELL / COORD / KIND blocks for
! your target material before running.
&GLOBAL
  PROJECT cell_opt
  RUN_TYPE CELL_OPT
&END GLOBAL

&MOTION
  &CELL_OPT
    OPTIMIZER BFGS
    MAX_ITER 100
    KEEP_SYMMETRY .TRUE.
  &END CELL_OPT
  &GEO_OPT
    MAX_ITER 200
    MAX_FORCE 4.5E-4
  &END GEO_OPT
&END MOTION

&FORCE_EVAL
  METHOD Quickstep
  STRESS_TENSOR ANALYTICAL
  &DFT
    BASIS_SET_FILE_NAME BASIS_MOLOPT
    POTENTIAL_FILE_NAME GTH_POTENTIALS
    &MGRID
      CUTOFF 400
      REL_CUTOFF 60
    &END MGRID
    &XC
      &XC_FUNCTIONAL PBE
      &END XC_FUNCTIONAL
    &END XC
    &SCF
      SCF_GUESS ATOMIC
      EPS_SCF 1.0E-7
      MAX_SCF 300
    &END SCF
  &END DFT
  &SUBSYS
    &CELL
      A 4.036 0.000 0.000
      B 0.000 4.036 0.000
      C 0.000 0.000 4.036
    &END CELL
    &COORD
      Ba 0.000 0.000 0.000
      Ti 2.018 2.018 2.018
      O  2.018 2.018 0.000
      O  2.018 0.000 2.018
      O  0.000 2.018 2.018
    &END COORD
    &KIND Ba
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q10
    &END KIND
    &KIND Ti
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q12
    &END KIND
    &KIND O
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q6
    &END KIND
  &END SUBSYS
&END FORCE_EVAL
`,
  },
  {
    id: 'cp2k_md',
    title: 'CP2K Ab Initio MD (NVT, template)',
    name: 'CP2K AIMD (NVT)',
    description:
      'Born-Oppenheimer MD at constant temperature. Example cell is cubic Si — override via SUBSYS / CELL / COORD / KIND or pass a `customizations` hint to have the LLM rewrite for a different material.',
    category: 'MD',
    language: 'cp2k',
    code: `&GLOBAL
  PROJECT aimd
  RUN_TYPE MD
&END GLOBAL

&MOTION
  &MD
    ENSEMBLE NVT
    TIMESTEP 0.5
    STEPS 100
    TEMPERATURE 300
    &THERMOSTAT
      TYPE NOSE
      &NOSE
        TIMECON 100.0
      &END NOSE
    &END THERMOSTAT
  &END MD
  &PRINT
    &TRAJECTORY
      &EACH
        MD 5
      &END EACH
    &END TRAJECTORY
  &END PRINT
&END MOTION

&FORCE_EVAL
  METHOD Quickstep
  &DFT
    BASIS_SET_FILE_NAME BASIS_MOLOPT
    POTENTIAL_FILE_NAME GTH_POTENTIALS
    &MGRID
      CUTOFF 300
    &END MGRID
    &XC
      &XC_FUNCTIONAL PBE
      &END XC_FUNCTIONAL
    &END XC
    &SCF
      SCF_GUESS RESTART
      EPS_SCF 1.0E-6
      MAX_SCF 200
    &END SCF
  &END DFT
  &SUBSYS
    &CELL
      A 5.431 0.000 0.000
      B 0.000 5.431 0.000
      C 0.000 0.000 5.431
    &END CELL
    &COORD
      Si 0.000 0.000 0.000
      Si 0.000 2.716 2.716
      Si 2.716 2.716 0.000
      Si 2.716 0.000 2.716
    &END COORD
    &KIND Si
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q4
    &END KIND
  &END SUBSYS
&END FORCE_EVAL
`,
  },
  {
    id: 'cp2k_band',
    title: 'CP2K Band Structure (template)',
    name: 'CP2K band structure',
    description:
      'Electronic band structure along a high-symmetry k-path. Example cell is cubic Si (FCC k-path) — override SUBSYS + SPECIAL_POINTs or pass a `customizations` hint for a different material / k-path.',
    category: 'DFT',
    language: 'cp2k',
    code: `&GLOBAL
  PROJECT band
  RUN_TYPE ENERGY
&END GLOBAL

&FORCE_EVAL
  METHOD Quickstep
  &DFT
    BASIS_SET_FILE_NAME BASIS_MOLOPT
    POTENTIAL_FILE_NAME GTH_POTENTIALS
    &MGRID
      CUTOFF 400
    &END MGRID
    &XC
      &XC_FUNCTIONAL PBE
      &END XC_FUNCTIONAL
    &END XC
    &SCF
      SCF_GUESS ATOMIC
      EPS_SCF 1.0E-7
      MAX_SCF 300
      ADDED_MOS 10
    &END SCF
    &PRINT
      &BAND_STRUCTURE
        &KPOINT_SET
          UNITS B_VECTOR
          SPECIAL_POINT GAMMA 0.0 0.0 0.0
          SPECIAL_POINT X     0.5 0.0 0.5
          SPECIAL_POINT W     0.5 0.25 0.75
          SPECIAL_POINT L     0.5 0.5 0.5
          SPECIAL_POINT GAMMA 0.0 0.0 0.0
          NPOINTS 20
        &END KPOINT_SET
      &END BAND_STRUCTURE
    &END PRINT
  &END DFT
  &SUBSYS
    &CELL
      A 5.431 0.000 0.000
      B 0.000 5.431 0.000
      C 0.000 0.000 5.431
    &END CELL
    &COORD
      Si 0.000 0.000 0.000
      Si 0.000 2.716 2.716
      Si 2.716 2.716 0.000
      Si 2.716 0.000 2.716
    &END COORD
    &KIND Si
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q4
    &END KIND
  &END SUBSYS
&END FORCE_EVAL
`,
  },
  {
    id: 'cp2k_single_point',
    title: 'CP2K Single Point',
    name: 'CP2K single point',
    description: 'Quick single-point energy scaffold.',
    category: 'DFT',
    language: 'cp2k',
    code:
      '&GLOBAL\n' +
      '  PROJECT single_point\n' +
      '  RUN_TYPE ENERGY\n' +
      '&END GLOBAL\n' +
      '&FORCE_EVAL\n' +
      '  METHOD Quickstep\n' +
      '  &DFT\n' +
      '    CHARGE 0\n' +
      '    MULTIPLICITY 1\n' +
      '    BASIS_SET_FILE_NAME BASIS_MOLOPT\n' +
      '    POTENTIAL_FILE_NAME GTH_POTENTIALS\n' +
      '  &END DFT\n' +
      '&END FORCE_EVAL\n',
  },
]
