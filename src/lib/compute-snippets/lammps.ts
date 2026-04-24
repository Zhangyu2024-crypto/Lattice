// LAMMPS-language snippets for the Compute Pro workbench.
//
// Ported from lattice-cli/src/lattice_cli/tools/compute_exec.py
// (the `_BUILTIN_SNIPPETS` array). See ./python.ts for the full note on
// the session-context globals and origin line numbers.

import type { ComputeSnippet } from '../../types/pro-api'

export const LAMMPS_SNIPPETS: ComputeSnippet[] = [
  {
    id: 'lammps_nve',
    title: 'LAMMPS NVE (Lennard-Jones)',
    name: 'LAMMPS NVE',
    description: 'Minimal Lennard-Jones NVE input.',
    category: 'Simulation',
    language: 'lammps',
    code:
      'units lj\n' +
      'atom_style atomic\n' +
      'lattice fcc 0.8442\n' +
      'region box block 0 8 0 8 0 8\n' +
      'create_box 1 box\n' +
      'create_atoms 1 box\n' +
      'mass 1 1.0\n' +
      'pair_style lj/cut 2.5\n' +
      'pair_coeff 1 1 1.0 1.0 2.5\n' +
      'velocity all create 1.0 12345\n' +
      'fix 1 all nve\n' +
      'thermo 100\n' +
      'run 1000\n',
  },
  {
    id: 'lammps_npt',
    title: 'LAMMPS NPT (EAM)',
    name: 'LAMMPS NPT template',
    description: 'Isothermal-isobaric relaxation with EAM. Edit the data file + potential path.',
    category: 'Simulation',
    language: 'lammps',
    code:
      'units metal\n' +
      'atom_style atomic\n' +
      'read_data system.data\n' +
      'pair_style eam/alloy\n' +
      'pair_coeff * * Cu_u3.eam\n' +
      'timestep 0.001\n' +
      'fix 1 all npt temp 300 300 0.1 iso 0 0 1.0\n' +
      'thermo 100\n' +
      'run 20000\n',
  },
  {
    id: 'lammps_minimize',
    title: 'LAMMPS Energy Minimisation',
    name: 'LAMMPS energy minimization',
    description: 'Conjugate-gradient minimisation starting point.',
    category: 'Simulation',
    language: 'lammps',
    code:
      'units metal\n' +
      'atom_style atomic\n' +
      'read_data system.data\n' +
      'pair_style eam/alloy\n' +
      'pair_coeff * * potential.eam.alloy Cu\n' +
      'neighbor 2.0 bin\n' +
      'min_style cg\n' +
      'minimize 1.0e-12 1.0e-12 1000 10000\n',
  },
  {
    id: 'lammps_dump',
    title: 'LAMMPS NVT + Trajectory Dump',
    name: 'LAMMPS dump trajectory',
    description: 'NVT dynamics with a custom trajectory dump.',
    category: 'Simulation',
    language: 'lammps',
    code:
      'units real\n' +
      'atom_style full\n' +
      'read_data system.data\n' +
      'dump 1 all custom 100 traj.lammpstrj id type x y z\n' +
      'dump_modify 1 sort id\n' +
      'fix 1 all nvt temp 300 300 100\n' +
      'run 10000\n',
  },
]
