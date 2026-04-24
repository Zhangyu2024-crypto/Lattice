/**
 * Minimal CIF parser / writer + 4 crystal-structure transforms.
 *
 * Scope:
 *   - Input is assumed to be a P1-expanded CIF with a loop_ listing all
 *     atoms explicitly via `_atom_site_label`, `_atom_site_type_symbol`,
 *     `_atom_site_fract_x/y/z`, and optionally `_atom_site_occupancy`.
 *     Column order is detected from the headers.
 *   - Symmetry operations beyond the space group name are NOT expanded.
 *   - Non-atom loops (e.g., anisotropic displacement parameters) are
 *     tolerated but not preserved — we only round-trip the atom loop.
 *   - Comments and blank lines are stripped from the parsed form.
 *
 * This covers Lattice's demo CIFs, LLM-generated CIFs requested via the
 * CIF_SYSTEM_PROMPT, and any other simple loop-form CIF. It does not try
 * to handle DDL2 CIFs, multi-block CIFs, or space-group-expanded content.
 *
 * The four transforms (supercell / dope / slabHkl / oxygenVacancy) all
 * take and return `ParsedCif`; the caller runs `writeCif(...)` to get a
 * string back. Re-parsing our own output is a sanity invariant — the dev
 * helper `window.__latticeCifRoundTrip` exposes this for manual smoke
 * testing.
 *
 * Implementation is split across `./cif/`:
 *   - `types.ts`      — public interfaces (LatticeParams, CifSite, ParsedCif)
 *   - `helpers.ts`    — number/string utilities, deterministic PRNG
 *   - `math.ts`       — 3x3 matrix + 3-vector helpers used by slabHkl
 *   - `parser.ts`     — `parseCif`
 *   - `writer.ts`     — `writeCif`
 *   - `transforms.ts` — `supercell`, `dope`, `slabHkl`, `oxygenVacancy`,
 *                       `computeFormula`, `computeLatticeParams`
 *
 * This module is intentionally a thin barrel so that external import
 * paths (`from '.../lib/cif'`) keep working unchanged.
 */

export type { LatticeParams, CifSite, ParsedCif } from './cif/types'
export { parseCif } from './cif/parser'
export { writeCif } from './cif/writer'
export {
  computeFormula,
  computeLatticeParams,
  supercell,
  dope,
  slabHkl,
  oxygenVacancy,
} from './cif/transforms'

import { parseCif } from './cif/parser'
import { writeCif } from './cif/writer'

// ─── Dev helper ───────────────────────────────────────────────────────

/**
 * Expose a round-trip helper on `window` in dev builds so we can sanity-
 * check parse/write without unit tests.
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as { __latticeCifRoundTrip?: unknown }).__latticeCifRoundTrip = (cif: string) => {
    const p = parseCif(cif)
    const out = writeCif(p)
    const p2 = parseCif(out)
    return {
      sitesBefore: p.sites.length,
      sitesAfter: p2.sites.length,
      latticeMatch:
        Math.abs(p.lattice.a - p2.lattice.a) < 1e-4 &&
        Math.abs(p.lattice.b - p2.lattice.b) < 1e-4 &&
        Math.abs(p.lattice.c - p2.lattice.c) < 1e-4,
      out,
    }
  }
}
