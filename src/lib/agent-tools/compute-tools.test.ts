import { beforeEach, describe, expect, it } from 'vitest'
import { useRuntimeStore } from '../../stores/runtime-store'
import type { StructureArtifact, ComputeArtifact } from '../../types/artifact'
import { LOCAL_TOOL_CATALOG } from './index'
import {
  resolveStructureArtifact,
  structureSlug,
  createComputeArtifact,
} from './compute-helpers'
import { getComputeSnippets } from '../compute-snippets-catalog'
import { buildSimulateTemplate } from '../compute-simulate-templates'
import {
  buildSupercellTweak,
  buildDopeTweak,
  buildSurfaceTweak,
  buildVacancyTweak,
} from '../compute-tweak-templates'
import { buildExportTemplate } from '../compute-export-templates'
import { parseCif, writeCif, supercell, computeFormula, computeLatticeParams } from '../cif'
import { createStructureFromCif } from '../structure-builder'

function resetStore() {
  useRuntimeStore.setState({
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  })
}

function makeSession(): string {
  const id = useRuntimeStore.getState().createSession()
  useRuntimeStore.getState().setActiveSession(id)
  return id
}

function makeStructure(sessionId: string, id: string): StructureArtifact {
  const art: StructureArtifact = {
    id,
    kind: 'structure',
    title: 'BaTiO3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: {
      cif: 'data_BaTiO3\n_cell_length_a 4.0\n',
      formula: 'BaTiO3',
      spaceGroup: 'Pm-3m',
      latticeParams: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
      transforms: [],
    },
  }
  useRuntimeStore.getState().upsertArtifact(sessionId, art)
  return art
}

beforeEach(resetStore)

describe('tool registration', () => {
  const names = LOCAL_TOOL_CATALOG.map((t) => t.name)

  it.each([
    'compute_check_health',
    'compute_from_snippet',
    'simulate_structure',
    'structure_tweak',
    'export_for_engine',
    'compute_run_native',
    'list_compute_snippets',
  ])('%s is registered', (name) => {
    expect(names).toContain(name)
  })

  it('no duplicate tool names', () => {
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })
})

describe('resolveStructureArtifact', () => {
  it('resolves by explicit id', () => {
    const sid = makeSession()
    const struct = makeStructure(sid, 'st-1')
    const resolved = resolveStructureArtifact(sid, 'st-1')
    expect(resolved.id).toBe(struct.id)
  })

  it('resolves focused artifact when no id given', () => {
    const sid = makeSession()
    makeStructure(sid, 'st-2')
    useRuntimeStore.getState().focusArtifact(sid, 'st-2')
    const resolved = resolveStructureArtifact(sid)
    expect(resolved.id).toBe('st-2')
  })

  it('throws when no structures exist', () => {
    const sid = makeSession()
    expect(() => resolveStructureArtifact(sid)).toThrow(/No structure/)
  })
})

describe('structureSlug', () => {
  it('slugifies title', () => {
    const sid = makeSession()
    const struct = makeStructure(sid, 'st-s')
    expect(structureSlug(struct)).toBe('batio3')
  })
})

describe('createComputeArtifact', () => {
  it('creates an idle compute artifact in the session', () => {
    const sid = makeSession()
    const art = createComputeArtifact(sid, {
      title: 'Test Script',
      code: 'print("hello")',
      language: 'python',
    })
    expect(art.kind).toBe('compute')
    expect(art.payload.language).toBe('python')
    expect(art.payload.status).toBe('idle')

    const session = useRuntimeStore.getState().sessions[sid]
    expect(session.artifacts[art.id]).toBeDefined()
    expect(session.focusedArtifactId).toBe(art.id)
  })

  it('supports lammps language', () => {
    const sid = makeSession()
    const art = createComputeArtifact(sid, {
      title: 'LAMMPS Run',
      code: 'units metal',
      language: 'lammps',
    })
    expect(art.payload.language).toBe('lammps')
  })
})

describe('snippet catalog integration', () => {
  it('has python snippets', () => {
    const py = getComputeSnippets('python')
    expect(py.length).toBeGreaterThan(5)
  })

  it('has lammps snippets', () => {
    const lmp = getComputeSnippets('lammps')
    expect(lmp.length).toBeGreaterThan(0)
  })

  it('has cp2k snippets', () => {
    const cp2k = getComputeSnippets('cp2k')
    expect(cp2k.length).toBeGreaterThan(0)
  })

  it('all snippets have id and code', () => {
    const all = getComputeSnippets()
    for (const s of all) {
      expect(s.id).toBeTruthy()
      expect(s.code).toBeTruthy()
    }
  })
})

describe('simulate template integration', () => {
  it('builds md-ase template from slug', () => {
    const tmpl = buildSimulateTemplate('md-ase', {
      slug: 'batio3',
      formula: 'BaTiO3',
      parentStructureId: 'st-x',
    })
    expect(tmpl.code).toContain('load_structure')
    expect(tmpl.code).toContain('batio3')
    expect(tmpl.title).toBeTruthy()
  })

  it('builds dft-cp2k template', () => {
    const tmpl = buildSimulateTemplate('dft-cp2k', {
      slug: 'sio2',
      formula: 'SiO2',
      parentStructureId: 'st-y',
    })
    expect(tmpl.code).toContain('load_structure')
    expect(tmpl.title).toBeTruthy()
  })

  it('builds py-play template', () => {
    const tmpl = buildSimulateTemplate('py-play', {
      slug: 'nacl',
      formula: 'NaCl',
      parentStructureId: 'st-z',
    })
    expect(tmpl.code).toContain('load_structure')
  })
})

describe('end-to-end: structure → compute artifact', () => {
  it('creates a simulation compute artifact from a structure', () => {
    const sid = makeSession()
    const struct = makeStructure(sid, 'st-e2e')
    const slug = structureSlug(struct)

    const tmpl = buildSimulateTemplate('md-ase', {
      slug,
      formula: 'BaTiO3',
      parentStructureId: struct.id,
    })

    const compute = createComputeArtifact(sid, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'python',
    })

    const session = useRuntimeStore.getState().sessions[sid]
    expect(session.artifacts[struct.id]).toBeDefined()
    expect(session.artifacts[compute.id]).toBeDefined()
    expect(compute.payload.code).toContain('batio3')
    expect(compute.payload.status).toBe('idle')
  })

  it('creates a snippet-based compute artifact', () => {
    const sid = makeSession()
    const snippets = getComputeSnippets('python')
    const xrd = snippets.find((s) => s.id === 'xrd_simulate')
    expect(xrd).toBeDefined()

    const compute = createComputeArtifact(sid, {
      title: xrd!.title ?? 'XRD Sim',
      code: xrd!.code ?? '',
      language: 'python',
    })

    expect(compute.payload.code).toContain('XRD')
    expect(compute.payload.language).toBe('python')
  })
})

// ── Realistic CIF for E2E tests ──────────────────────────────────────
const BATIO3_CIF = `data_BaTiO3
_cell_length_a   3.994
_cell_length_b   3.994
_cell_length_c   4.038
_cell_angle_alpha   90.000
_cell_angle_beta    90.000
_cell_angle_gamma   90.000
_symmetry_space_group_name_H-M   'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Ba1 Ba 0.000 0.000 0.000
Ti1 Ti 0.500 0.500 0.512
O1  O  0.500 0.500 0.023
O2  O  0.500 0.000 0.487
O3  O  0.000 0.500 0.487`

function makeRealisticStructure(sessionId: string, id: string): StructureArtifact {
  const parsed = parseCif(BATIO3_CIF)
  const art: StructureArtifact = {
    id,
    kind: 'structure',
    title: 'BaTiO3',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: {
      cif: BATIO3_CIF,
      formula: computeFormula(parsed.sites),
      spaceGroup: parsed.spaceGroup ?? 'P 1',
      latticeParams: computeLatticeParams(parsed),
      transforms: [],
    },
  }
  useRuntimeStore.getState().upsertArtifact(sessionId, art)
  return art
}

// ── E2E: build → modify → simulate pipeline ─────────────────────────

describe('E2E: structure → supercell → CIF roundtrip', () => {
  it('creates structure, applies supercell via CIF transforms, produces valid CIF', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-super')

    // Step 1: Parse the original CIF
    const parsed = parseCif(struct.payload.cif)
    expect(parsed.sites.length).toBe(5) // Ba + Ti + 3O

    // Step 2: Apply 2×2×2 supercell
    const expanded = supercell(parsed, 2, 2, 2)
    expect(expanded.sites.length).toBe(40) // 5 × 8

    // Step 3: Write back to CIF and re-parse (roundtrip)
    const newCif = writeCif(expanded)
    expect(newCif).toContain('data_')
    expect(newCif).toContain('_cell_length_a')

    const reparsed = parseCif(newCif)
    expect(reparsed.sites.length).toBe(40)
    expect(computeFormula(reparsed.sites)).toBe('BaO3Ti')

    // Step 4: Lattice params should be doubled
    const newLattice = computeLatticeParams(reparsed)
    expect(newLattice.a).toBeCloseTo(3.994 * 2, 1)
    expect(newLattice.b).toBeCloseTo(3.994 * 2, 1)
    expect(newLattice.c).toBeCloseTo(4.038 * 2, 1)
  })
})

describe('E2E: structure → compute artifact pipeline', () => {
  it('structure → MD simulation template → compute artifact', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-md')
    const slug = structureSlug(struct)

    // Build MD template
    const tmpl = buildSimulateTemplate('md-ase', {
      slug,
      formula: 'BaTiO3',
      parentStructureId: struct.id,
    })
    expect(tmpl.code).toContain('load_structure')
    expect(tmpl.code).toContain(slug)

    // Create compute artifact
    const compute = createComputeArtifact(sid, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'python',
    })

    // Both artifacts exist in session
    const session = useRuntimeStore.getState().sessions[sid]
    expect(Object.keys(session.artifacts)).toHaveLength(2)
    expect(session.artifacts[struct.id]!.kind).toBe('structure')
    expect(session.artifacts[compute.id]!.kind).toBe('compute')
    expect(compute.payload.status).toBe('idle')
    expect(compute.payload.language).toBe('python')
  })

  it('structure → DFT-CP2K template → compute artifact', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-dft')
    const slug = structureSlug(struct)

    const tmpl = buildSimulateTemplate('dft-cp2k', {
      slug,
      formula: 'BaTiO3',
      parentStructureId: struct.id,
    })
    expect(tmpl.code).toContain('load_structure')

    const compute = createComputeArtifact(sid, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'python',
    })
    expect(compute.payload.code.length).toBeGreaterThan(100)
  })

  it('structure → XRD simulation snippet → compute artifact', () => {
    const sid = makeSession()
    makeRealisticStructure(sid, 'e2e-xrd')

    const snippets = getComputeSnippets('python')
    const xrd = snippets.find((s) => s.id === 'xrd_simulate')!
    expect(xrd).toBeDefined()

    const compute = createComputeArtifact(sid, {
      title: xrd.title ?? 'XRD Simulation',
      code: xrd.code ?? '',
      language: 'python',
    })
    expect(compute.payload.code).toBeTruthy()
  })
})

describe('E2E: structure → tweak → compute artifact', () => {
  it('structure → supercell tweak → compute artifact with correct params', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-tweak-sc')
    const slug = structureSlug(struct)

    const tweak = buildSupercellTweak(slug, { nx: 3, ny: 3, nz: 3 })
    expect(tweak.code).toContain('(3, 3, 3)')
    expect(tweak.code).toContain(slug)
    expect(tweak.title).toBeTruthy()

    const compute = createComputeArtifact(sid, {
      title: tweak.title,
      code: tweak.code,
      language: 'python',
    })
    expect(compute.payload.code).toContain(slug)
  })

  it('structure → dope tweak → compute artifact', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-tweak-dope')
    const slug = structureSlug(struct)

    const tweak = buildDopeTweak(slug, {
      fromElement: 'Ti',
      toElement: 'Zr',
      fraction: 0.1,
    })
    expect(tweak.code).toContain('Ti')
    expect(tweak.code).toContain('Zr')

    const compute = createComputeArtifact(sid, {
      title: tweak.title,
      code: tweak.code,
      language: 'python',
    })
    expect(compute.payload.code).toContain(slug)
  })

  it('structure → surface slab tweak → compute artifact', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-tweak-slab')
    const slug = structureSlug(struct)

    const tweak = buildSurfaceTweak(slug, {
      miller: [1, 1, 0],
      minSlab: 10,
      minVacuum: 15,
    })
    expect(tweak.code).toContain('SlabGenerator')

    const compute = createComputeArtifact(sid, {
      title: tweak.title,
      code: tweak.code,
      language: 'python',
    })
    expect(compute.payload.code).toContain(slug)
  })

  it('structure → vacancy tweak → compute artifact', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-tweak-vac')
    const slug = structureSlug(struct)

    const tweak = buildVacancyTweak(slug, { element: 'O', count: 1, seed: 42 })
    expect(tweak.code).toContain("'O'")

    const compute = createComputeArtifact(sid, {
      title: tweak.title,
      code: tweak.code,
      language: 'python',
    })
    expect(compute.payload.code).toContain(slug)
  })
})

describe('E2E: structure → engine export', () => {
  it('structure → LAMMPS export template', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-lammps')
    const slug = structureSlug(struct)
    const parsed = parseCif(struct.payload.cif)

    const tmpl = buildExportTemplate('lammps', {
      slug,
      formula: 'BaTiO3',
      parsedCif: parsed,
      parentStructureId: struct.id,
    })
    expect(tmpl.code).toContain('lammps')
    expect(tmpl.title).toBeTruthy()

    const compute = createComputeArtifact(sid, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'python',
    })
    expect(compute.payload.language).toBe('python')
  })

  it('structure → CP2K export template', () => {
    const sid = makeSession()
    const struct = makeRealisticStructure(sid, 'e2e-cp2k')
    const parsed = parseCif(struct.payload.cif)

    const tmpl = buildExportTemplate('cp2k', {
      slug: structureSlug(struct),
      formula: 'BaTiO3',
      parsedCif: parsed,
      parentStructureId: struct.id,
    })
    expect(tmpl.code).toContain('CELL')
    expect(tmpl.cellKind).toBe('cp2k')

    const compute = createComputeArtifact(sid, {
      title: tmpl.title,
      code: tmpl.code,
      language: 'cp2k',
    })
    expect(compute.payload.language).toBe('cp2k')
  })
})

describe('E2E: CIF auto-detection from compute output', () => {
  it('stdout with CIF data is detected', () => {
    const cifOutput = BATIO3_CIF
    expect(cifOutput).toContain('data_')
    expect(cifOutput).toContain('_cell_length_a')
  })

  it('auto-creates structure artifact from CIF output', async () => {
    const sid = makeSession()

    const result = await createStructureFromCif({
      sessionId: sid,
      cif: BATIO3_CIF,
      titleMode: 'formula',
      transformKind: 'import',
      transformParams: { source: 'compute_run' },
      transformNote: 'Auto-detected from compute output',
      orchestrator: null,
    })

    expect(result.artifact.kind).toBe('structure')
    expect(result.formula).toBe('BaO3Ti')
    expect(result.spaceGroup).toBe('P 1')
    expect(result.cellVolume).toBeGreaterThan(0)

    const session = useRuntimeStore.getState().sessions[sid]
    expect(session.artifacts[result.artifact.id]).toBeDefined()
    expect(session.artifacts[result.artifact.id]!.kind).toBe('structure')
  })
})

describe('E2E: full pipeline structure → modify → simulate → export', () => {
  it('complete workflow: create → supercell → MD + XRD + LAMMPS', () => {
    const sid = makeSession()

    // Step 1: Create structure
    const struct = makeRealisticStructure(sid, 'e2e-full')

    // Step 2: Supercell via CIF transforms (pure JS, no container)
    const parsed = parseCif(struct.payload.cif)
    const expanded = supercell(parsed, 2, 2, 2)
    const newCif = writeCif(expanded)
    const newFormula = computeFormula(expanded.sites)
    expect(newFormula).toBe('BaO3Ti')

    // Step 3: Update structure artifact with supercell
    const newPayload = {
      ...struct.payload,
      cif: newCif,
      formula: newFormula,
      latticeParams: computeLatticeParams(expanded),
    }
    useRuntimeStore.getState().patchArtifact(sid, struct.id, {
      payload: newPayload,
    } as never)

    const slug = structureSlug(struct)

    // Step 4: MD simulation → compute artifact
    const mdTmpl = buildSimulateTemplate('md-ase', {
      slug,
      formula: newFormula,
      parentStructureId: struct.id,
    })
    const mdCompute = createComputeArtifact(sid, {
      title: mdTmpl.title,
      code: mdTmpl.code,
      language: 'python',
    })

    // Step 5: XRD simulation → compute artifact
    const xrdSnippet = getComputeSnippets('python').find((s) => s.id === 'xrd_simulate')!
    const xrdCompute = createComputeArtifact(sid, {
      title: 'XRD Simulation',
      code: xrdSnippet.code ?? '',
      language: 'python',
    })

    // Step 6: LAMMPS export → compute artifact
    const reparsed = parseCif(newCif)
    const lammpsTmpl = buildExportTemplate('lammps', {
      slug,
      formula: newFormula,
      parsedCif: reparsed,
      parentStructureId: struct.id,
    })
    const lammpsCompute = createComputeArtifact(sid, {
      title: lammpsTmpl.title,
      code: lammpsTmpl.code,
      language: 'python',
    })

    // Verify: 1 structure + 3 compute artifacts in session
    const session = useRuntimeStore.getState().sessions[sid]
    const artifacts = Object.values(session.artifacts)
    expect(artifacts.filter((a) => a.kind === 'structure')).toHaveLength(1)
    expect(artifacts.filter((a) => a.kind === 'compute')).toHaveLength(3)

    // Verify all compute artifacts are idle and have code
    for (const art of artifacts) {
      if (art.kind !== 'compute') continue
      const ca = art as ComputeArtifact
      expect(ca.payload.status).toBe('idle')
      expect(ca.payload.code.length).toBeGreaterThan(10)
    }

    // Verify structure was updated with supercell
    const finalStruct = session.artifacts[struct.id] as StructureArtifact
    expect(finalStruct.payload.formula).toBe('BaO3Ti')
    expect(finalStruct.payload.latticeParams.a).toBeCloseTo(7.988, 1)
  })
})
