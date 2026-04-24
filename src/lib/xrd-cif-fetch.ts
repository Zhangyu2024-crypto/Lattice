import type { XrdProCif } from '../types/artifact'
import { callWorker } from './worker-client'

interface CifDbResultEntry {
  material_id: string
  cif_text?: string
  formula?: string
  a?: number
  b?: number
  c?: number
  alpha?: number
  beta?: number
  gamma?: number
  space_group?: string
}

interface CifDbGetResponse {
  success: boolean
  error?: string
  results?: CifDbResultEntry[]
}

export async function fetchCifsForMaterialIds(
  materialIds: string[],
): Promise<XrdProCif[]> {
  const ids = [...new Set(materialIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return []

  const result = await callWorker<CifDbGetResponse>('cif_db.get', {
    material_ids: ids,
    include_lattice: true,
  })
  if (!result.ok) {
    throw new Error(result.error)
  }
  if (!result.value.success) {
    throw new Error(result.value.error ?? 'Failed to load CIFs from the bundled database.')
  }

  return (result.value.results ?? []).flatMap((entry) => {
    if (typeof entry.cif_text !== 'string' || entry.cif_text.length === 0) {
      return []
    }
    return [
      {
        id: `mp_cif_${entry.material_id}`,
        filename: `${entry.material_id}.cif`,
        content: entry.cif_text,
        size: entry.cif_text.length,
        formula: typeof entry.formula === 'string' ? entry.formula : undefined,
        spaceGroup:
          typeof entry.space_group === 'string' ? entry.space_group : undefined,
        a: typeof entry.a === 'number' ? entry.a : undefined,
        b: typeof entry.b === 'number' ? entry.b : undefined,
        c: typeof entry.c === 'number' ? entry.c : undefined,
        alpha: typeof entry.alpha === 'number' ? entry.alpha : undefined,
        beta: typeof entry.beta === 'number' ? entry.beta : undefined,
        gamma: typeof entry.gamma === 'number' ? entry.gamma : undefined,
        selected: true,
      } satisfies XrdProCif,
    ]
  })
}
