// Static config for the structure artifact card: transform-kind glyphs
// shown in the "Recent transforms" pill row, and the default 1x1x1
// replication tier.

import type { StructureTransform } from '../../../../types/artifact'
import type { Replication } from '../structure/StructureViewer'

export const GLYPHS: Record<StructureTransform['kind'], string> = {
  supercell: 'SC',
  dope: 'Dp',
  surface: 'Sf',
  defect: 'Df',
  import: 'Im',
}

export const DEFAULT_REPLICATION: Replication = { nx: 1, ny: 1, nz: 1 }
