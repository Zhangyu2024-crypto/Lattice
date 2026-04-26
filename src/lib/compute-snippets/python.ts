// Python-language snippets for the Compute Pro workbench.
//
// Ported from lattice-cli/src/lattice_cli/tools/compute_exec.py L107-802
// (the `_BUILTIN_SNIPPETS` array). The code bodies reference the
// session-context globals ACTIVE_CIFS / CURRENT_SPECTRUM / WORKDIR
// injected by the runner (see electron/compute-runner.ts PYTHON_HEADER
// and the lattice-cli header at compute_exec.py:51-100).

import type { ComputeSnippet } from '../../types/pro-api'

export const PYTHON_SNIPPETS: ComputeSnippet[] = [
  {
    id: 'space_group',
    title: 'Space Group Analysis',
    name: 'Space Group Analysis',
    description: 'Identify crystallographic space group and symmetry operations',
    category: 'Symmetry',
    language: 'python',
    code: `# Analyze crystal symmetry
from pymatgen.core import Structure
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer

if not ACTIVE_CIFS:
    raise RuntimeError("Upload a CIF in the XRD module first")

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

sga = SpacegroupAnalyzer(s, symprec=1e-3)
print(f"Formula       : {s.composition.reduced_formula}")
print(f"Space group   : {sga.get_space_group_symbol()} (#{sga.get_space_group_number()})")
print(f"Crystal system: {sga.get_crystal_system()}")
print(f"Point group   : {sga.get_point_group_symbol()}")
print(f"Lattice (a,b,c): {tuple(round(x,4) for x in s.lattice.abc)}")
print(f"Angles alpha,beta,gamma  : {tuple(round(x,3) for x in s.lattice.angles)}")
print(f"Volume        : {s.lattice.volume:.3f} A^3")
print(f"Density       : {s.density:.3f} g/cm^3")
`,
  },
  {
    id: 'supercell',
    title: 'Build Supercell',
    name: 'Build Supercell',
    description: 'Generate NxNxN supercell from the primitive cell',
    category: 'Structure',
    language: 'python',
    code: `# Build a supercell from an existing CIF
from pymatgen.core import Structure

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

N = 2  # supercell size
s.make_supercell([N, N, N])
print(f"Supercell {N}x{N}x{N}: {len(s)} atoms")
print(f"Lattice: {s.lattice.abc}")
print(f"Volume : {s.lattice.volume:.2f} A^3")

# Save to WORKDIR so it persists across runs
out_path = f"{WORKDIR}/supercell_{N}x{N}x{N}.cif"
s.to(filename=out_path, fmt="cif")
print(f"Saved  : {out_path}")
`,
  },
  {
    id: 'xrd_simulate',
    title: 'Simulate XRD Pattern',
    name: 'Simulate XRD Pattern',
    description: 'Calculate theoretical XRD from CIF using pymatgen',
    category: 'Diffraction',
    language: 'python',
    code: `# Simulate XRD pattern from a CIF
from pymatgen.core import Structure
from pymatgen.analysis.diffraction.xrd import XRDCalculator
import matplotlib.pyplot as plt

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

calc = XRDCalculator(wavelength="CuKa")
pattern = calc.get_pattern(s, two_theta_range=(5, 90))

print(f"Phase: {s.composition.reduced_formula}")
print(f"Top 10 peaks (2theta, I, hkl):")
for i in range(min(10, len(pattern.x))):
    hkl = pattern.hkls[i][0]["hkl"]
    print(f"  {pattern.x[i]:7.3f}  I={pattern.y[i]:6.2f}  ({hkl[0]}{hkl[1]}{hkl[2]})")

fig, ax = plt.subplots(figsize=(9, 4))
ax.vlines(pattern.x, 0, pattern.y, lw=1.2, color="#6366f1")
ax.set_xlabel("2theta (deg)"); ax.set_ylabel("Intensity (a.u.)")
ax.set_title(f"Simulated XRD - {s.composition.reduced_formula} (Cu Kalpha)")
ax.set_xlim(5, 90); ax.grid(alpha=0.3)
plt.tight_layout()
plt.show()
`,
  },
  {
    id: 'slab',
    title: 'Generate Slab / Surface',
    name: 'Generate Slab / Surface',
    description: 'Build low-index surface slab for adsorption studies',
    category: 'Structure',
    language: 'python',
    code: `# Generate a (hkl) slab from bulk
from pymatgen.core import Structure
from pymatgen.core.surface import SlabGenerator

cif = next(iter(ACTIVE_CIFS.values()))
bulk = Structure.from_str(cif["cif_text"], fmt="cif")

miller = (1, 0, 0)
slab_gen = SlabGenerator(
    bulk, miller_index=miller,
    min_slab_size=10, min_vacuum_size=15,
    center_slab=True,
)
slabs = slab_gen.get_slabs()
print(f"Generated {len(slabs)} distinct slabs for {miller}")
for i, slab in enumerate(slabs[:5]):
    print(f"  #{i}: {len(slab)} atoms, thickness={slab.lattice.c:.2f} A, "
          f"terminations={slab.shift:.3f}")

if slabs:
    out = f"{WORKDIR}/slab_{miller[0]}{miller[1]}{miller[2]}.cif"
    slabs[0].to(filename=out, fmt="cif")
    print(f"Saved: {out}")
`,
  },
  {
    id: 'bond_analysis',
    title: 'Bond Length Statistics',
    name: 'Bond Length Statistics',
    description: 'Compute nearest-neighbor bond distances per element pair',
    category: 'Analysis',
    language: 'python',
    code: `# Bond length analysis
from pymatgen.core import Structure
from pymatgen.analysis.local_env import CrystalNN
from collections import defaultdict
import numpy as np

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

nn = CrystalNN()
bonds = defaultdict(list)
for i in range(len(s)):
    try:
        neighbors = nn.get_nn_info(s, i)
    except Exception:
        continue
    center = s[i].specie.symbol
    for info in neighbors:
        partner = info["site"].specie.symbol
        key = "-".join(sorted([center, partner]))
        bonds[key].append(info["weight"] * s.lattice.a)

print(f"Bond statistics ({s.composition.reduced_formula}):")
for pair, dists in sorted(bonds.items()):
    arr = np.array(dists)
    print(f"  {pair:8s}  n={len(arr):3d}  mean={arr.mean():.3f}A  "
          f"std={arr.std():.3f}  min={arr.min():.3f}  max={arr.max():.3f}")
`,
  },
  {
    id: 'dope',
    title: 'Substitutional Doping',
    name: 'Substitutional Doping',
    description: 'Replace one element with another at random sites',
    category: 'Structure',
    language: 'python',
    code: `# Substitutional doping
from pymatgen.core import Structure
from pymatgen.transformations.standard_transformations import SubstitutionTransformation

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

original, replacement = "Fe", "Mn"  # EDIT THESE
sub = SubstitutionTransformation({original: {original: 0.75, replacement: 0.25}})
try:
    doped = sub.apply_transformation(s)
    print(f"Original : {s.composition.reduced_formula}")
    print(f"Doped    : {doped.composition.reduced_formula}")
    out = f"{WORKDIR}/doped_{replacement}.cif"
    doped.to(filename=out, fmt="cif")
    print(f"Saved    : {out}")
except Exception as e:
    print(f"Doping failed: {e}")
    print(f"Available species: {[el.symbol for el in s.composition.elements]}")
`,
  },
  {
    id: 'spectrum_fft',
    title: 'Spectrum FFT',
    name: 'Spectrum FFT',
    description: 'Fourier transform of the currently loaded spectrum',
    category: 'Signal',
    language: 'python',
    code: `# FFT of the active spectrum
import numpy as np
import matplotlib.pyplot as plt

if CURRENT_SPECTRUM is None:
    raise RuntimeError("Load a spectrum file first")

x = np.array(CURRENT_SPECTRUM["x"])
y = np.array(CURRENT_SPECTRUM["y"])

dx = np.mean(np.diff(x))
Y = np.fft.rfft(y - y.mean())
freqs = np.fft.rfftfreq(len(y), d=dx)
power = np.abs(Y) ** 2

fig, axes = plt.subplots(2, 1, figsize=(9, 6))
axes[0].plot(x, y, lw=0.8); axes[0].set_title("Signal"); axes[0].grid(alpha=0.3)
axes[1].loglog(freqs[1:], power[1:], lw=0.8); axes[1].set_title("Power spectrum")
axes[1].grid(alpha=0.3)
plt.tight_layout()
plt.show()
print(f"n={len(y)}  dx~={dx:.4f}  peak_freq={freqs[1+np.argmax(power[1:])]:.4f}")
`,
  },
  {
    id: 'ase_optimize',
    title: 'ASE Geometry Optimization',
    name: 'ASE Geometry Optimization',
    description: 'Relax structure with an ASE calculator (EMT as example)',
    category: 'Simulation',
    language: 'python',
    code: `# Quick geometry optimization using ASE + EMT
from ase.io import read, write
from ase.optimize import BFGS
from ase.calculators.emt import EMT

cif = next(iter(ACTIVE_CIFS.values()))
cif_path = f"{WORKDIR}/_tmp_in.cif"
open(cif_path, "w").write(cif["cif_text"])
atoms = read(cif_path)

atoms.calc = EMT()
print(f"Initial energy: {atoms.get_potential_energy():.4f} eV")
opt = BFGS(atoms, logfile=None)
opt.run(fmax=0.05, steps=50)
print(f"Final energy  : {atoms.get_potential_energy():.4f} eV")
print(f"Max force     : {abs(atoms.get_forces()).max():.4f} eV/A")

out = f"{WORKDIR}/relaxed.cif"
write(out, atoms)
print(f"Saved: {out}")
`,
  },
  {
    id: 'list_packages',
    title: 'Environment Probe',
    name: 'Environment Probe',
    description: 'Print versions of scientific packages available',
    category: 'Analysis',
    language: 'python',
    code: `# Probe the compute container
import importlib, shutil, sys

print(f"Python        : {sys.version.split()[0]}")
for pkg in ['numpy','scipy','matplotlib','pandas','pymatgen','ase',
            'spglib','phonopy','lammps','MDAnalysis','mp_api']:
    try:
        m = importlib.import_module(pkg)
        print(f"{pkg:<14}: {getattr(m, '__version__', '?')}")
    except Exception:
        print(f"{pkg:<14}: (not installed)")
print(f"lammps binary : {'yes' if shutil.which('lmp') else 'no'}")
print(f"cp2k binary   : {'yes' if shutil.which('cp2k') else 'no'}")
`,
  },
  {
    id: 'vacancy',
    title: 'Vacancy Defect',
    name: 'Vacancy Defect',
    description: 'Introduce a single vacancy and save the resulting CIF',
    category: 'Structure',
    language: 'python',
    code: `# Create a vacancy by removing one site
from pymatgen.core import Structure

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")

site_index = 0  # EDIT — which site to remove
print(f"Removing site {site_index}: {s[site_index]}")
s.remove_sites([site_index])
print(f"Sites after : {len(s)}")
out = f"{WORKDIR}/vacancy.cif"
s.to(filename=out, fmt="cif")
print(f"Saved       : {out}")
`,
  },
  {
    id: 'structure_view',
    title: 'Structure Summary',
    name: 'Structure Summary',
    description: 'Concise summary of composition, lattice, and sites',
    category: 'Structure',
    language: 'python',
    code: `# Quick glance at a CIF
from pymatgen.core import Structure

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")
print(f"Formula     : {s.composition.reduced_formula}")
print(f"Sites ({len(s)}):")
for i, site in enumerate(s):
    frac = tuple(round(x, 3) for x in site.frac_coords)
    print(f"  #{i:2d}  {site.species_string:<6s}  frac {frac}")
print(f"Lattice     : a={s.lattice.a:.3f} b={s.lattice.b:.3f} c={s.lattice.c:.3f}")
print(f"Angles      : alpha={s.lattice.alpha:.2f} beta={s.lattice.beta:.2f} gamma={s.lattice.gamma:.2f}")
`,
  },
  {
    id: 'phonon_dispersion',
    title: 'Phonon Dispersion (phonopy)',
    name: 'Phonon Dispersion (phonopy)',
    description: 'Build phonopy displacement dataset from a CIF',
    category: 'Simulation',
    language: 'python',
    code: `# Generate phonopy displacements
from pymatgen.core import Structure
from pymatgen.io.phonopy import get_phonopy_structure
import phonopy

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")
unitcell = get_phonopy_structure(s)

phonon = phonopy.Phonopy(unitcell, supercell_matrix=[[2,0,0],[0,2,0],[0,0,2]])
phonon.generate_displacements(distance=0.02)
supercells = phonon.supercells_with_displacements
print(f"Base atoms         : {len(unitcell.get_scaled_positions())}")
print(f"Supercell atoms    : {len(supercells[0].get_scaled_positions())}")
print(f"Displacement count : {len(supercells)}")
print("Run DFT/MLFF on each supercell, then feed forces back via phonon.produce_force_constants().")
`,
  },
  {
    id: 'xrd_compare',
    title: 'XRD vs Active Spectrum',
    name: 'XRD vs Active Spectrum',
    description: 'Overlay the simulated XRD with the loaded spectrum',
    category: 'Diffraction',
    language: 'python',
    code: `# Compare simulated XRD to the active spectrum
import numpy as np
import matplotlib.pyplot as plt
from pymatgen.core import Structure
from pymatgen.analysis.diffraction.xrd import XRDCalculator

if CURRENT_SPECTRUM is None:
    raise RuntimeError("Load an XRD spectrum first")
if not ACTIVE_CIFS:
    raise RuntimeError("Upload a candidate CIF first")

x = np.array(CURRENT_SPECTRUM["x"])
y = np.array(CURRENT_SPECTRUM["y"])
y_norm = y / max(np.abs(y).max(), 1e-9)

cif = next(iter(ACTIVE_CIFS.values()))
s = Structure.from_str(cif["cif_text"], fmt="cif")
calc = XRDCalculator(wavelength="CuKa")
pattern = calc.get_pattern(s, two_theta_range=(float(x.min()), float(x.max())))

fig, ax = plt.subplots(figsize=(9, 4))
ax.plot(x, y_norm, lw=0.9, color="#0ea5e9", label="observed")
ax.vlines(pattern.x, 0, pattern.y / pattern.y.max(), lw=1.1,
          color="#f97316", label="simulated")
ax.set_xlabel("2theta (deg)"); ax.set_ylabel("Normalised intensity")
ax.set_title(f"Overlay - {s.composition.reduced_formula}")
ax.grid(alpha=0.3); ax.legend()
plt.tight_layout()
plt.show()
`,
  },
  {
    id: 'peak_detect',
    title: 'Peak Detection',
    name: 'Peak Detection',
    description: 'Find peaks in the current spectrum with scipy',
    category: 'Signal',
    language: 'python',
    code: `# Detect peaks via scipy.signal
import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import find_peaks

if CURRENT_SPECTRUM is None:
    raise RuntimeError("Load a spectrum first")

x = np.array(CURRENT_SPECTRUM["x"])
y = np.array(CURRENT_SPECTRUM["y"])

prominence = 0.03 * (y.max() - y.min())
idx, props = find_peaks(y, prominence=prominence, distance=5)
print(f"Detected {len(idx)} peaks (prominence >= {prominence:.3g})")
for i in idx[:20]:
    print(f"  x={x[i]:8.3f}   y={y[i]:8.3f}")

fig, ax = plt.subplots(figsize=(9, 4))
ax.plot(x, y, lw=0.9, color="#334155")
ax.scatter(x[idx], y[idx], s=18, color="#dc2626", label=f"{len(idx)} peaks")
ax.set_xlabel("x"); ax.set_ylabel("y"); ax.grid(alpha=0.3); ax.legend()
plt.tight_layout()
plt.show()
`,
  },
  {
    id: 'cp2k_si_bulk_modulus',
    title: 'CP2K Si Bulk Modulus',
    name: 'CP2K Si bulk modulus',
    description: 'Run a CP2K energy-volume scan for diamond Si and fit a quadratic equation of state to estimate the bulk modulus.',
    category: 'DFT',
    language: 'python',
    code: `# CP2K energy-volume scan for diamond Si bulk modulus.
# This is an interactive smoke/prototype workflow, not a publication setup.
# It uses the 8-atom conventional diamond cell and fits E(V) quadratically.

import os
import re
import shutil
import subprocess
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

HARTREE_TO_EV = 27.211386245988
EV_PER_A3_TO_GPA = 160.21766208

cp2k = shutil.which('cp2k.psmp') or shutil.which('cp2k')
if not cp2k:
    raise RuntimeError('CP2K executable not found on PATH')

run_root = Path(WORKDIR) / 'si_bulk_modulus_cp2k'
run_root.mkdir(parents=True, exist_ok=True)

# Conventional diamond-cubic Si basis, fractional coordinates.
frac_coords = [
    (0.0, 0.0, 0.0),
    (0.0, 0.5, 0.5),
    (0.5, 0.0, 0.5),
    (0.5, 0.5, 0.0),
    (0.25, 0.25, 0.25),
    (0.25, 0.75, 0.75),
    (0.75, 0.25, 0.75),
    (0.75, 0.75, 0.25),
]


def cp2k_input(a):
    coords = '\\n'.join(
        f'      Si {x * a:.8f} {y * a:.8f} {z * a:.8f}'
        for x, y, z in frac_coords
    )
    return f"""&GLOBAL
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
      &OT
        PRECONDITIONER FULL_SINGLE_INVERSE
        MINIMIZER DIIS
      &END OT
      &OUTER_SCF
        MAX_SCF 10
      &END OUTER_SCF
    &END SCF
  &END DFT
  &SUBSYS
    &CELL
      A {a:.8f} 0.00000000 0.00000000
      B 0.00000000 {a:.8f} 0.00000000
      C 0.00000000 0.00000000 {a:.8f}
      PERIODIC XYZ
    &END CELL
    &COORD
{coords}
    &END COORD
    &KIND Si
      BASIS_SET DZVP-MOLOPT-SR-GTH
      POTENTIAL GTH-PBE-q4
    &END KIND
  &END SUBSYS
&END FORCE_EVAL
"""


def parse_energy_hartree(text):
    matches = re.findall(r'ENERGY[|] Total FORCE_EVAL.*?(-?[0-9]+[.][0-9]+)[ \t]*$', text, re.M)
    if matches:
        return float(matches[-1])
    matches = re.findall(r'Total energy:[ \t]*(-?[0-9]+[.][0-9]+)', text)
    if matches:
        return float(matches[-1])
    raise RuntimeError('Could not parse CP2K total energy')


env = os.environ.copy()
env.setdefault('OMP_NUM_THREADS', '2')
env.setdefault('MKL_NUM_THREADS', '2')
env.setdefault('OPENBLAS_NUM_THREADS', '2')
# Keep conda OpenMPI from trying unavailable host transports on desktops/WSL.
env.setdefault('OMPI_MCA_btl', 'self')
env.setdefault('OMPI_MCA_pml', 'ob1')
env.setdefault('OMPI_MCA_rmaps_base_oversubscribe', '1')

cp2k_path = Path(cp2k)
cp2k_data_candidates = [
    Path(os.environ['CP2K_DATA_DIR']) if os.environ.get('CP2K_DATA_DIR') else None,
    Path(os.environ['CONDA_PREFIX']) / 'share' / 'cp2k' / 'data' if os.environ.get('CONDA_PREFIX') else None,
    cp2k_path.parent.parent / 'share' / 'cp2k' / 'data',
    cp2k_path.resolve().parent.parent / 'share' / 'cp2k' / 'data',
]
for candidate in cp2k_data_candidates:
    if candidate and (candidate / 'BASIS_MOLOPT').exists():
        env['CP2K_DATA_DIR'] = str(candidate)
        break

lattice_constants = np.linspace(5.20, 5.70, 6)
rows = []
for index, a in enumerate(lattice_constants, start=1):
    point_dir = run_root / f'a_{a:.3f}'
    point_dir.mkdir(exist_ok=True)
    input_path = point_dir / 'si.inp'
    output_path = point_dir / 'si.out'
    input_path.write_text(cp2k_input(float(a)))

    print(f'__LATTICE_PROGRESS__ {index}/{len(lattice_constants)} a={a:.4f}', flush=True)
    proc = subprocess.run(
        [cp2k, '-i', str(input_path), '-o', str(output_path)],
        cwd=point_dir,
        env=env,
        text=True,
        capture_output=True,
        timeout=420,
    )
    if proc.returncode != 0:
        tail = output_path.read_text(errors='replace')[-3000:] if output_path.exists() else proc.stderr[-3000:]
        raise RuntimeError(f'CP2K failed at a={a:.4f} A with code {proc.returncode}\\n{tail}')

    energy_ev = parse_energy_hartree(output_path.read_text(errors='replace')) * HARTREE_TO_EV
    volume_a3 = float(a) ** 3
    rows.append((volume_a3, energy_ev, float(a)))
    print(f'a={a:.4f} A  V={volume_a3:.4f} A^3  E={energy_ev:.8f} eV', flush=True)

volumes = np.array([row[0] for row in rows])
energies = np.array([row[1] for row in rows])
coef = np.polyfit(volumes, energies, 2)
volume0 = -coef[1] / (2 * coef[0])
energy0 = float(np.polyval(coef, volume0))
bulk_modulus = 2 * coef[0] * volume0 * EV_PER_A3_TO_GPA
a0 = volume0 ** (1 / 3)

print('\\nFit: E(V) = c2*V^2 + c1*V + c0')
print(f'Equilibrium a0 = {a0:.4f} A')
print(f'Equilibrium V0 = {volume0:.4f} A^3 / conventional cell')
print(f'Equilibrium E0 = {energy0:.8f} eV')
print(f'Bulk modulus  = {bulk_modulus:.2f} GPa')
print(f'Run directory = {run_root}')

vfit = np.linspace(volumes.min(), volumes.max(), 200)
efit = np.polyval(coef, vfit)
fig, ax = plt.subplots(figsize=(6.5, 4.2))
ax.plot(volumes, energies, 'o', label='CP2K points')
ax.plot(vfit, efit, '-', label='quadratic fit')
ax.axvline(volume0, color='0.4', ls='--', lw=1)
ax.set_xlabel('Volume (A^3 / conventional cell)')
ax.set_ylabel('Energy (eV)')
ax.set_title(f'Diamond Si bulk modulus: {bulk_modulus:.1f} GPa')
ax.grid(alpha=0.3)
ax.legend()
plt.tight_layout()
plt.show()
`,
  },
  {
    id: 'lammps_via_python',
    title: 'LAMMPS from Python',
    name: 'LAMMPS from Python',
    description: 'Drive LAMMPS via its Python binding inside the container',
    category: 'Simulation',
    language: 'python',
    code: `# Python -> LAMMPS minimal driver
from lammps import lammps

lmp = lammps()
lmp.command("units lj")
lmp.command("atom_style atomic")
lmp.command("lattice fcc 0.8442")
lmp.command("region box block 0 4 0 4 0 4")
lmp.command("create_box 1 box")
lmp.command("create_atoms 1 box")
lmp.command("mass 1 1.0")
lmp.command("pair_style lj/cut 2.5")
lmp.command("pair_coeff 1 1 1.0 1.0 2.5")
lmp.command("velocity all create 1.0 12345")
lmp.command("fix 1 all nve")
lmp.command("thermo 100")
lmp.command("run 500")
print("LAMMPS run finished.")
`,
  },
]
