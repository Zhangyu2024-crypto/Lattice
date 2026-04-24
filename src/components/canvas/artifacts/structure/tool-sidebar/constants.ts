// Static option tables consumed by the ToolSidebar sections. Kept
// next to the section components so adding a style / replication /
// projection option is a one-file edit.

import type {
  ProjectionMode,
  Replication,
  StructureStyleMode,
} from '../StructureViewer'

export const STYLE_OPTIONS: ReadonlyArray<{
  value: StructureStyleMode
  label: string
}> = [
  { value: 'stick', label: 'Stick' },
  { value: 'ball-stick', label: 'Ball + Stick' },
  { value: 'sphere', label: 'Space-fill' },
]

export const REPLICATION_OPTIONS: ReadonlyArray<{
  label: string
  value: Replication
}> = [
  { label: '1×1×1', value: { nx: 1, ny: 1, nz: 1 } },
  { label: '2×1×1', value: { nx: 2, ny: 1, nz: 1 } },
  { label: '2×2×1', value: { nx: 2, ny: 2, nz: 1 } },
  { label: '2×2×2', value: { nx: 2, ny: 2, nz: 2 } },
  { label: '3×3×3', value: { nx: 3, ny: 3, nz: 3 } },
]

export const PROJECTION_OPTIONS: ReadonlyArray<{
  value: ProjectionMode
  label: string
}> = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthographic', label: 'Orthographic' },
]

export const BACKGROUND_SWATCHES: ReadonlyArray<{
  label: string
  color: string
}> = [
  { label: 'Black', color: '#000000' },
  { label: 'Dark', color: '#1A1A1A' },
  { label: 'Slate', color: '#3A3A3A' },
  { label: 'White', color: '#FFFFFF' },
]
