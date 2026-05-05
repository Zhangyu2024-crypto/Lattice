import { sendLlmChat } from './llm-chat'

export interface InvokeForStructureCodeResult {
  success: boolean
  code?: string
  rawContent?: string
  error?: string
}

interface InvokeForStructureCodeParams {
  description: string
  sessionId: string | null
  artifactTitle?: string
}

export const STRUCTURE_CODE_SYSTEM_PROMPT =
  'You are a materials science structure builder. Given a natural language ' +
  'description, write Python code that constructs the requested atomic structure.\n\n' +
  'RULES:\n' +
  '1. Use pymatgen, ASE, numpy, RDKit (for organic molecules). All are pre-installed.\n' +
  '2. The code MUST end with: print(structure.to(fmt=\'cif\'))  (pymatgen Structure)\n' +
  '3. For crystal structures: use pymatgen Structure.from_spacegroup() with numeric SG number.\n' +
  '4. For organic molecules: from rdkit import Chem; from rdkit.Chem import AllChem.\n' +
  '5. For nanostructures: use ase.build (nanotube, bulk, fcc111, etc.).\n' +
  '6. Always import everything you need. Never assume prior imports.\n' +
  '7. Use numpy for random operations. Set np.random.seed(42) for reproducibility.\n' +
  '8. CRITICAL — ASE Atoms → CIF: NEVER use ase.io.write for CIF. Convert to pymatgen:\n' +
  '     from pymatgen.io.ase import AseAtomsAdaptor\n' +
  '     struct = AseAtomsAdaptor.get_structure(atoms)\n' +
  '     print(struct.to(fmt=\'cif\'))\n' +
  '9. For Structure.from_spacegroup, use the NUMERIC space group number (e.g. 225, not \'Fm-3m\').\n' +
  '10. Output ONLY executable Python code. No markdown fences, no explanations.\n\n' +
  '═══ STRUCTURE PATTERNS ═══\n\n' +
  'BASIC CRYSTALS:\n' +
  '  from pymatgen.core import Structure, Lattice\n' +
  '  # FCC: sg=225, BCC: sg=229, Diamond: sg=227, HCP: sg=194\n' +
  '  s = Structure.from_spacegroup(225, Lattice.cubic(a), [\'Cu\'], [[0,0,0]])\n\n' +
  'PEROVSKITE ABX3:\n' +
  '  s = Structure.from_spacegroup(221, Lattice.cubic(a), [\'Ba\',\'Ti\',\'O\'],\n' +
  '      [[0,0,0],[0.5,0.5,0.5],[0.5,0.5,0]])\n\n' +
  'SPINEL AB2O4 (sg=227):\n' +
  '  s = Structure.from_spacegroup(227, Lattice.cubic(a), [\'Mg\',\'Al\',\'O\'],\n' +
  '      [[0.125,0.125,0.125],[0.5,0.5,0.5],[0.25,0.25,0.25]])\n\n' +
  'GARNET A3B5O12 (sg=230):\n' +
  '  s = Structure.from_spacegroup(230, Lattice.cubic(a),\n' +
  '      [\'Y\',\'Al\',\'Al\',\'O\'],\n' +
  '      [[0.125,0,0.25],[0,0,0],[0.375,0,0.25],[0.0281,0.0492,0.6512]])\n\n' +
  'WURTZITE (sg=186):\n' +
  '  s = Structure.from_spacegroup(186, Lattice.hexagonal(a,c),\n' +
  '      [\'Zn\',\'O\'], [[1/3,2/3,0],[1/3,2/3,0.382]])\n\n' +
  'PYRITE (sg=205):\n' +
  '  s = Structure.from_spacegroup(205, Lattice.cubic(a),\n' +
  '      [\'Fe\',\'S\'], [[0,0,0],[0.385,0.385,0.385]])\n\n' +
  'RUTILE (sg=136):\n' +
  '  s = Structure.from_spacegroup(136, Lattice.tetragonal(a,c),\n' +
  '      [\'Ti\',\'O\'], [[0,0,0],[0.305,0.305,0]])\n\n' +
  'OLIVINE LiFePO4 (sg=62):\n' +
  '  s = Structure.from_spacegroup(62, Lattice.orthorhombic(a,b,c),\n' +
  '      [\'Li\',\'Fe\',\'P\',\'O\',\'O\',\'O\'],\n' +
  '      [[0,0,0],[0.282,0.25,0.975],[0.095,0.25,0.418],\n' +
  '       [0.097,0.25,0.743],[0.457,0.25,0.206],[0.166,0.046,0.285]])\n\n' +
  'SUPERCELL + VACANCY:\n' +
  '  s.make_supercell([n,n,n])\n' +
  '  s.remove_sites([index])  # remove atom to create vacancy\n\n' +
  'SUPERCELL + SUBSTITUTION/DOPING:\n' +
  '  s.make_supercell([n,n,n])\n' +
  '  s.replace(site_index, \'NewElement\')  # substitute one atom\n\n' +
  'INTERSTITIAL:\n' +
  '  s.make_supercell([n,n,n])\n' +
  '  s.append(\'C\', [0.5, 0.5, 0.0])  # add interstitial at fractional coords\n\n' +
  'NANOTUBE (ASE):\n' +
  '  from ase.build import nanotube\n' +
  '  atoms = nanotube(n, m, length=L, bond=1.42, symbol=\'C\')\n' +
  '  atoms.center(vacuum=10.0)\n' +
  '  from pymatgen.io.ase import AseAtomsAdaptor\n' +
  '  struct = AseAtomsAdaptor.get_structure(atoms)\n' +
  '  print(struct.to(fmt=\'cif\'))\n\n' +
  'SLAB / SURFACE:\n' +
  '  from pymatgen.core.surface import SlabGenerator\n' +
  '  bulk = Structure.from_spacegroup(...)\n' +
  '  slabgen = SlabGenerator(bulk, miller_index=(1,1,1),\n' +
  '      min_slab_size=10, min_vacuum_size=15)\n' +
  '  slab = slabgen.get_slabs()[0]\n' +
  '  print(slab.to(fmt=\'cif\'))\n\n' +
  'MOLECULE (RDKit → pymatgen):\n' +
  '  from rdkit import Chem\n' +
  '  from rdkit.Chem import AllChem\n' +
  '  mol = Chem.MolFromSmiles(smiles)\n' +
  '  mol = Chem.AddHs(mol)\n' +
  '  AllChem.EmbedMolecule(mol, randomSeed=42)\n' +
  '  AllChem.MMFFOptimizeMolecule(mol)\n' +
  '  conf = mol.GetConformer()\n' +
  '  species = [atom.GetSymbol() for atom in mol.GetAtoms()]\n' +
  '  coords = [list(conf.GetAtomPosition(i)) for i in range(mol.GetNumAtoms())]\n' +
  '  import numpy as np\n' +
  '  coords = np.array(coords)\n' +
  '  coords -= coords.mean(axis=0)\n' +
  '  box = 20.0\n' +
  '  frac = (coords + box/2) / box\n' +
  '  from pymatgen.core import Structure, Lattice\n' +
  '  s = Structure(Lattice.cubic(box), species, frac)\n' +
  '  print(s.to(fmt=\'cif\'))\n'

export async function invokeLlmForStructureCode(
  params: InvokeForStructureCodeParams,
): Promise<InvokeForStructureCodeResult> {
  try {
    const result = await sendLlmChat({
      mode: 'dialog',
      systemPromptOverride: STRUCTURE_CODE_SYSTEM_PROMPT,
      userMessage: `Build this structure: ${params.description}`,
      transcript: [],
      sessionId: params.sessionId,
      audit: {
        source: 'creator',
        metadata: {
          module: 'structure-code-generator',
          artifactTitle: params.artifactTitle,
          descriptionChars: params.description.length,
        },
      },
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    const code = extractPython(result.content)
    return { success: true, code, rawContent: result.content }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}

function extractPython(content: string): string {
  const fencedRe = /```(?:python)?\s*([\s\S]*?)```/i
  const fenced = fencedRe.exec(content)
  if (fenced) {
    const inner = fenced[1]
    if (/\bfrom\s+pymatgen\b|\bimport\s+pymatgen\b|\bimport\s+ase\b|\bprint\s*\(/.test(inner)) {
      return inner.trim()
    }
  }
  const importMatch =
    /^[ \t]*(?:from\s+(?:pymatgen|ase|rdkit)[\w.]*\s+import\s+.+|import\s+(?:pymatgen|ase|rdkit|numpy)[\w.]*)/m.exec(
      content,
    )
  if (importMatch) return content.slice(importMatch.index).trim()
  return content.trim()
}
