// Static option lists for the XPS parameter panel. Kept separate from
// the panel component so both the panel and its sibling modules (e.g.
// `pro/modules/xps/index.tsx`) can pull them without dragging the
// JSX-heavy panel into their import graph.

// "tougaard (approx)" in the label is deliberate — the U3 default B/C
// parameters reproduce the universal cross-section only to ~20% across
// d-band metals. Quantitative work requires calibration against a
// metallic standard (Tougaard 1988, Surf. Interface Anal. 11, 453).
export const BG_OPTIONS = [
  { value: 'shirley', label: 'shirley' },
  { value: 'linear', label: 'linear' },
  { value: 'tougaard', label: 'tougaard (approx)' },
]

export const METHOD_OPTIONS = [
  { value: 'least_squares', label: 'least_squares' },
  { value: 'leastsq', label: 'leastsq' },
  { value: 'nelder', label: 'nelder' },
]

export const CHARGE_MODE_OPTIONS = [
  { value: 'auto', label: 'auto' },
  { value: 'manual', label: 'manual' },
]

// RSF catalog options. `scofield` is shipped in `worker/data/` and is the
// sane default — values from Scofield 1976 Al Kα cross-sections,
// normalised to C 1s = 1.0. `kratos_f1s` remains listed for backward
// compatibility with persisted artifacts but the worker doesn't ship a
// Kratos table (returns "no RSF in built-in table" warnings for now).
export const RSF_OPTIONS = [
  { value: 'scofield', label: 'Scofield (Al Kα)' },
  { value: 'kratos_f1s', label: 'Kratos F1s (unshipped)' },
]
