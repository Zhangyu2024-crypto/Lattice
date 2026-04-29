// Built-in compute-experiment templates.
//
// Each template knows how to materialise (objective, parameters,
// points, per-point script template) so the agent can spin up a
// canned parameter sweep with just `templateId`. Templates may share
// per-point script bodies with `compute-snippets/python.ts`, but they
// expose them through the `pointScriptTemplate` placeholder syntax
// (`{{param:<name>}}`) so the runner can substitute per-point values.
//
// Adding a new template: append a key here. The id must be unique
// across single-script snippets and experiment templates so callers
// can use one stable identifier in chat / docs.

import type {
  ComputeExperimentParameter,
  ComputeExperimentPoint,
} from '../../types/artifact'

export interface ExperimentTemplateBuild {
  title: string
  objective: string
  engine: 'python' | 'cp2k' | 'lammps' | 'shell'
  parameters: ComputeExperimentParameter[]
  points: ComputeExperimentPoint[]
  pointScriptTemplate: string
  metrics: Array<{ name: string; label?: string; unit?: string }>
}

export interface ExperimentTemplate {
  id: string
  description: string
  build(): ExperimentTemplateBuild
}

function pointsFromValues(values: number[]): ComputeExperimentPoint[] {
  return values.map((a, index) => ({
    id: `pt_${index.toString().padStart(4, '0')}`,
    index,
    params: { a },
    status: 'pending' as const,
  }))
}

const SI_BULK_MODULUS_LATTICE_VALUES = [5.30, 5.38, 5.43, 5.48, 5.56]

/** Per-point CP2K Si energy script. Substitutes the lattice constant
 *  `{{param:a}}`. Prints the converged energy as a metric the runner
 *  picks up via the `__LATTICE_METRIC__` sentinel. The fit (E vs V →
 *  bulk modulus) is intentionally left to a downstream analysis step
 *  rather than baked in per-point: each point only needs to produce
 *  one energy. */
const SI_BULK_MODULUS_SCRIPT = `import os
import shutil
import subprocess
import re
from pathlib import Path

a = {{param:a}}
point_id = "{{point_id}}"

cp2k = shutil.which('cp2k.psmp') or shutil.which('cp2k')
if not cp2k:
    raise RuntimeError('CP2K executable not found on PATH')

run_root = Path(os.environ.get('WORKDIR', '.')) / f'si_{point_id}'
run_root.mkdir(parents=True, exist_ok=True)

frac = [
    (0.0, 0.0, 0.0), (0.0, 0.5, 0.5), (0.5, 0.0, 0.5), (0.5, 0.5, 0.0),
    (0.25, 0.25, 0.25), (0.25, 0.75, 0.75), (0.75, 0.25, 0.75), (0.75, 0.75, 0.25),
]
coords = '\\n'.join(f'      Si {x*a:.8f} {y*a:.8f} {z*a:.8f}' for x, y, z in frac)

inp = run_root / 'si.inp'
inp.write_text(f"""&GLOBAL
  PROJECT si_bulk
  RUN_TYPE ENERGY
  PRINT_LEVEL LOW
&END GLOBAL
&FORCE_EVAL
  METHOD Quickstep
  &DFT
    BASIS_SET_FILE_NAME BASIS_MOLOPT
    POTENTIAL_FILE_NAME GTH_POTENTIALS
    &MGRID
      CUTOFF 300
      REL_CUTOFF 40
    &END MGRID
    &XC
      &XC_FUNCTIONAL PBE
      &END XC_FUNCTIONAL
    &END XC
    &SCF
      SCF_GUESS ATOMIC
      EPS_SCF 1.0E-5
      MAX_SCF 250
    &END SCF
  &END DFT
  &SUBSYS
    &CELL
      A {a:.8f} 0 0
      B 0 {a:.8f} 0
      C 0 0 {a:.8f}
      PERIODIC XYZ
    &END CELL
    {coords}
  &END SUBSYS
&END FORCE_EVAL
""")

result = subprocess.run([cp2k, '-i', 'si.inp'], cwd=run_root, capture_output=True, text=True, check=False)
if result.returncode != 0:
    print(result.stderr)
    raise RuntimeError(f'CP2K failed for a={a}')

m = re.search(r'ENERGY\\| Total FORCE_EVAL.*?:\\s*(-?\\d+\\.\\d+)', result.stdout)
if not m:
    raise RuntimeError('Could not parse CP2K total energy')

energy_hartree = float(m.group(1))
volume = a ** 3

print(f'__LATTICE_METRIC__ energy_hartree={energy_hartree}')
print(f'__LATTICE_METRIC__ volume_a3={volume}')
print(f'__LATTICE_METRIC__ a={a}')
`

const cp2kSiBulkModulus: ExperimentTemplate = {
  id: 'cp2k_si_bulk_modulus',
  description:
    'Energy-volume scan of diamond Si over 5 lattice constants — feed the resulting (V, E) table into a quadratic E(V) fit downstream to extract bulk modulus.',
  build() {
    const parameters: ComputeExperimentParameter[] = [
      {
        name: 'a',
        label: 'Lattice constant',
        unit: 'Å',
        kind: 'continuous',
        values: SI_BULK_MODULUS_LATTICE_VALUES,
        role: 'scan',
      },
    ]
    const points = pointsFromValues(SI_BULK_MODULUS_LATTICE_VALUES)
    return {
      title: 'CP2K Si bulk modulus (E–V scan)',
      objective:
        'Energy-volume scan of diamond Si — sweep lattice constant and feed the table to a quadratic fit for bulk modulus.',
      engine: 'python',
      parameters,
      points,
      pointScriptTemplate: SI_BULK_MODULUS_SCRIPT,
      metrics: [
        { name: 'a', label: 'Lattice constant', unit: 'Å' },
        { name: 'volume_a3', label: 'Volume', unit: 'Å³' },
        { name: 'energy_hartree', label: 'Energy', unit: 'Hartree' },
      ],
    }
  },
}

export const EXPERIMENT_TEMPLATES: Record<string, ExperimentTemplate> = {
  [cp2kSiBulkModulus.id]: cp2kSiBulkModulus,
}
