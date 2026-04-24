// Internal types for the structure artifact card. Only used by the
// card's own sub-modules — the public artifact types live in
// `src/types/artifact`.

import type { StructureTransformKind } from '../../../../types/artifact'
import type { ParsedCif } from '../../../../lib/cif'

/** One pass through the CIF transform pipeline: a kind, its params,
 *  a human-readable note, and the pure function that does the work. */
export interface TransformRunInput {
  kind: StructureTransformKind
  params: Record<string, unknown>
  note: string
  run: (parsed: ParsedCif) => ParsedCif
}
