interface ComputeFigure {
  format: 'png' | 'svg'
  base64: string
  caption?: string
}

interface ComputeArtifactPayload {
  language: 'python'
  code: string
  stdout: string
  stderr: string
  figures: ComputeFigure[]
  exitCode: number | null
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  env?: { packages: string[]; pythonVersion: string }
  durationMs?: number
}

const DEMO_CODE = `from pymatgen.core import Structure
from pymatgen.symmetry.analyzer import SpacegroupAnalyzer
import matplotlib.pyplot as plt
import numpy as np

structure = Structure.from_file("BaTiO3.cif")
lattice = structure.lattice
sga = SpacegroupAnalyzer(structure)

print(f"Formula: {structure.composition.reduced_formula}")
print(f"a = {lattice.a:.4f} A  b = {lattice.b:.4f} A  c = {lattice.c:.4f} A")
print(f"alpha = {lattice.alpha:.2f}  beta = {lattice.beta:.2f}  gamma = {lattice.gamma:.2f}")
print(f"Space group: {sga.get_space_group_symbol()} (#{sga.get_space_group_number()})")
print(f"Volume: {lattice.volume:.3f} A^3")

energies = np.linspace(-6.0, 6.0, 200)
dos = np.exp(-(energies ** 2) / 1.8) + 0.35 * np.exp(-((energies - 2.5) ** 2) / 0.6)
plt.figure(figsize=(5, 3))
plt.plot(energies, dos, color="#B0B0B0")
plt.xlabel("Energy (eV)")
plt.ylabel("DOS (states/eV)")
plt.tight_layout()
plt.savefig("dos.png", dpi=120)
`

const DEMO_STDOUT = `Formula: BaTiO3
a = 3.9920 A  b = 3.9920 A  c = 4.0361 A
alpha = 90.00  beta = 90.00  gamma = 90.00
Space group: P4mm (#99)
Volume: 64.326 A^3
`

const RED_DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEX/AAD///9BHTQRAAAAF0lEQVR4nGNgAIL/DKz//zMw/Gdg+A8AE4YC/dGVBKsAAAAASUVORK5CYII='

export const DEMO_COMPUTE: ComputeArtifactPayload = {
  language: 'python',
  code: DEMO_CODE,
  stdout: DEMO_STDOUT,
  stderr: '',
  figures: [
    {
      format: 'png',
      base64: RED_DOT_PNG,
      caption: 'Density of States (placeholder)',
    },
  ],
  exitCode: 0,
  status: 'succeeded',
  env: {
    packages: ['pymatgen==2024.3.1', 'numpy==1.26.4', 'matplotlib==3.8.3'],
    pythonVersion: '3.11.8',
  },
  durationMs: 1843,
}
