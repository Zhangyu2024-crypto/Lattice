// Static option lists + refinement presets for the XRD parameter panel.
// Kept separate from the panel component so both the panel and its
// siblings (e.g. the Pro-mode module registrations in
// `pro/modules/xrd/index.tsx`) can pull them without dragging the
// JSX-heavy panel into their import graph.

import type { XrdProPayload } from '../../../../types/artifact'

export const WAVELENGTH_OPTIONS = [
  { value: 'Cu', label: 'Cu' },
  { value: 'Mo', label: 'Mo' },
  { value: 'Co', label: 'Co' },
  { value: 'Fe', label: 'Fe' },
  { value: 'Cr', label: 'Cr' },
  { value: 'Ag', label: 'Ag' },
]

export const PEAK_ENGINE_OPTIONS = [
  { value: 'scipy', label: 'Built-in (fast)' },
  { value: 'dara', label: 'BGMN Rietveld (precise)' },
]

export const BACKGROUND_OPTIONS = [
  { value: 'snip', label: 'SNIP' },
  { value: 'polynomial', label: 'Polynomial' },
  { value: 'none', label: 'None' },
]

export const REFINE_PRESETS: Record<
  string,
  Partial<XrdProPayload['params']['refinement']> & { label: string }
> = {
  default: {
    label: 'Default',
    twoThetaMin: 10,
    twoThetaMax: 80,
    maxPhases: 3,
  },
  'high-res': {
    label: 'High-Res',
    twoThetaMin: 5,
    twoThetaMax: 90,
    maxPhases: 4,
  },
  narrow: {
    label: 'Narrow',
    twoThetaMin: 15,
    twoThetaMax: 65,
    maxPhases: 2,
  },
}
