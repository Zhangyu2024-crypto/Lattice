import { callWorker } from '../worker-client'
import type { LocalTool } from '../../types/agent-tool'

// ── Types ──────────────────────────────────────────────────────────────

interface CifGetInput {
  /** Single material id */
  material_id?: string
  /** Batch material ids */
  material_ids?: string[]
  /** Include lattice parameters in results (default true) */
  include_lattice?: boolean
}

interface CifSearchInput {
  /** Substring match on chemical formula, e.g. "TiO2" */
  formula?: string
  /** Element-subset filter, e.g. ["Ti", "O"] */
  elements?: string[]
  /** Space group filter (substring), e.g. "Fd-3m" */
  space_group?: string
  /** Crystal system, e.g. "cubic" */
  crystal_system?: string
  /** Include full CIF text in results (default false) */
  include_cif?: boolean
  /** Max results (default 50, max 500) */
  limit?: number
}

interface CifEntry {
  material_id: string
  formula?: string
  space_group?: string
  crystal_system?: string
  a?: number
  b?: number
  c?: number
  alpha?: number
  beta?: number
  gamma?: number
  nsites?: number
  cif_text?: string
}

interface CifGetWorkerResult {
  success: boolean
  error?: string
  results?: CifEntry[]
  count?: number
  missing?: string[] | null
}

interface CifSearchWorkerResult {
  success: boolean
  error?: string
  results?: CifEntry[]
  count?: number
  total_matched?: number | null
}

interface CifGetOutput {
  results: CifEntry[]
  count: number
  missing: string[] | null
}

interface CifSearchOutput {
  results: CifEntry[]
  count: number
  total_matched: number | null
}

// ── cif_lookup ─────────────────────────────────────────────────────────

export const cifLookupTool: LocalTool<CifGetInput, CifGetOutput> = {
  name: 'cif_lookup',
  description:
    'Retrieve CIF crystal structure files from the local Materials Project database (~155k entries). ' +
    'Pass one or more material_id(s) (e.g. "mp-149") to get the full CIF text plus lattice ' +
    'parameters. Use this before dara refinement or whenever you need a CIF for structure modeling.',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      material_id: {
        type: 'string',
        description: 'A single Materials Project id, e.g. "mp-149".',
      },
      material_ids: {
        type: 'array',
        description: 'Multiple material ids for batch retrieval (JSON array of strings).',
      },
      include_lattice: {
        type: 'boolean',
        description: 'Include a/b/c/alpha/beta/gamma/space_group (default true).',
      },
    },
  },
  async execute(input, _ctx) {
    const res = await callWorker<CifGetWorkerResult>('cif_db.get', {
      material_id: input?.material_id,
      material_ids: input?.material_ids,
      include_lattice: input?.include_lattice ?? true,
    })
    if (!res.ok) throw new Error(res.error)
    const data = res.value
    if (!data.success) throw new Error(data.error ?? 'cif_db.get failed')
    return {
      results: data.results ?? [],
      count: data.count ?? 0,
      missing: data.missing ?? null,
    }
  },
}

// ── cif_search ─────────────────────────────────────────────────────────

export const cifSearchTool: LocalTool<CifSearchInput, CifSearchOutput> = {
  name: 'cif_search',
  description:
    'Search the local Materials Project CIF database by formula, elements, space group, ' +
    'or crystal system. Returns matching materials with lattice parameters. Set include_cif=true ' +
    'to also retrieve the full CIF text (increases payload size).',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      formula: {
        type: 'string',
        description: 'Substring match on formula, e.g. "TiO2", "BaTiO3".',
      },
      elements: {
        type: 'array',
        description: 'Element-subset filter (JSON array of element symbols). Materials must contain only these elements.',
      },
      space_group: {
        type: 'string',
        description: 'Space group filter (substring), e.g. "Fd-3m", "P6_3/mmc".',
      },
      crystal_system: {
        type: 'string',
        description: 'Crystal system: cubic, tetragonal, orthorhombic, etc.',
      },
      include_cif: {
        type: 'boolean',
        description: 'Include full CIF text in each result (default false).',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default 50, max 500).',
      },
    },
  },
  async execute(input, _ctx) {
    if (!input?.formula && !input?.elements?.length && !input?.space_group && !input?.crystal_system) {
      throw new Error('Provide at least one filter: formula, elements, space_group, or crystal_system.')
    }
    const res = await callWorker<CifSearchWorkerResult>('cif_db.search', {
      formula: input.formula,
      elements: input.elements,
      space_group: input.space_group,
      crystal_system: input.crystal_system,
      include_cif: input.include_cif ?? false,
      limit: input.limit ?? 50,
    })
    if (!res.ok) throw new Error(res.error)
    const data = res.value
    if (!data.success) throw new Error(data.error ?? 'cif_db.search failed')
    return {
      results: data.results ?? [],
      count: data.count ?? 0,
      total_matched: data.total_matched ?? null,
    }
  },
}
