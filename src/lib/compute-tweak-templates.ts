// Structure-cell "Tweak" code templates.
//
// Each template produces a fully-runnable Structure-Code cell body that
// loads the parent structure via `load_structure(<parent key>)` (which
// the backend auto-injects from ACTIVE_CIFS) and applies a single
// well-understood transform. Users land in a cell they can read, tweak
// further, and re-run — the shortcut is about not having to remember
// pymatgen's exact API, not about hiding code.

import type { ComputeCellProvenance } from '../types/artifact'

export type TweakKind = 'supercell' | 'dope' | 'surface' | 'vacancy'

export interface SupercellTweakParams {
  nx: number
  ny: number
  nz: number
}

export interface DopeTweakParams {
  /** Element symbol to look for in the source structure. */
  fromElement: string
  /** Element symbol to substitute in. */
  toElement: string
  /** Fraction of sites to substitute (0..1). Defaults to 0.25. */
  fraction?: number
}

export interface SurfaceTweakParams {
  miller: [number, number, number]
  minSlab: number
  minVacuum: number
}

export interface VacancyTweakParams {
  /** Element symbol whose sites are candidates for removal (e.g. 'O'). */
  element: string
  /** How many sites to remove. Defaults to 1. */
  count?: number
  /** PRNG seed for the random-sample step. Defaults to 0 so the cell
   *  is deterministic; users can override in the cell body to re-roll. */
  seed?: number
}

export interface TweakResult {
  code: string
  provenance: ComputeCellProvenance
  title: string
}

export function buildSupercellTweak(
  parentKey: string,
  params: SupercellTweakParams,
): TweakResult {
  const { nx, ny, nz } = params
  const code = [
    '# Spawned by Tweak → Supercell.',
    `# Parent structure: ${parentKey}`,
    '',
    'from pymatgen.core import Structure',
    '',
    `s = load_structure('${parentKey}')`,
    `s = s * (${nx}, ${ny}, ${nz})`,
    'print(s.to(fmt="cif"))',
    '',
  ].join('\n')
  return {
    code,
    provenance: {
      parentCellId: parentKey,
      operation: `tweak:supercell(${nx},${ny},${nz})`,
    },
    title: `Supercell ${nx}×${ny}×${nz}`,
  }
}

export function buildDopeTweak(
  parentKey: string,
  params: DopeTweakParams,
): TweakResult {
  const { fromElement, toElement, fraction = 0.25 } = params
  const code = [
    '# Spawned by Tweak → Dope / Substitute.',
    `# Parent structure: ${parentKey}`,
    '',
    'import random',
    'from pymatgen.core import Structure',
    '',
    `s = load_structure('${parentKey}')`,
    `FROM = '${fromElement}'`,
    `TO = '${toElement}'`,
    `FRACTION = ${fraction}`,
    '',
    'candidates = [i for i, site in enumerate(s) if site.species_string == FROM]',
    'n_sub = max(1, int(round(len(candidates) * FRACTION)))',
    'random.seed(0)',
    'to_replace = set(random.sample(candidates, n_sub))',
    'for i in to_replace:',
    '    s.replace(i, TO)',
    'print(s.to(fmt="cif"))',
    '',
  ].join('\n')
  return {
    code,
    provenance: {
      parentCellId: parentKey,
      operation: `tweak:dope(${fromElement}→${toElement},${fraction})`,
    },
    title: `Dope ${fromElement}→${toElement}`,
  }
}

export function buildSurfaceTweak(
  parentKey: string,
  params: SurfaceTweakParams,
): TweakResult {
  const { miller, minSlab, minVacuum } = params
  const hkl = `(${miller[0]}, ${miller[1]}, ${miller[2]})`
  const code = [
    '# Spawned by Tweak → Surface slab.',
    `# Parent structure: ${parentKey}`,
    '',
    'from pymatgen.core import Structure',
    'from pymatgen.core.surface import SlabGenerator',
    '',
    `s = load_structure('${parentKey}')`,
    `MILLER = ${hkl}`,
    `MIN_SLAB = ${minSlab}`,
    `MIN_VACUUM = ${minVacuum}`,
    '',
    'gen = SlabGenerator(s, MILLER, MIN_SLAB, MIN_VACUUM, center_slab=True, reorient_lattice=True)',
    'slab = gen.get_slab()',
    'print(slab.to(fmt="cif"))',
    '',
  ].join('\n')
  return {
    code,
    provenance: {
      parentCellId: parentKey,
      operation: `tweak:surface(${miller.join('')})`,
    },
    title: `Slab (${miller.join('')})`,
  }
}

export function buildVacancyTweak(
  parentKey: string,
  params: VacancyTweakParams,
): TweakResult {
  const { element, count = 1, seed = 0 } = params
  const code = [
    '# Spawned by Tweak → Vacancy.',
    `# Parent structure: ${parentKey}`,
    `# Removes ${count} random '${element}' site(s) using seed=${seed}.`,
    '',
    'import random',
    'from pymatgen.core import Structure',
    '',
    `s = load_structure('${parentKey}')`,
    `ELEMENT = '${element}'`,
    `COUNT = ${count}`,
    `SEED = ${seed}`,
    '',
    'candidates = [i for i, site in enumerate(s) if site.species_string == ELEMENT]',
    'if len(candidates) < COUNT:',
    '    raise ValueError(f"Only {len(candidates)} {ELEMENT} site(s) — cannot remove {COUNT}.")',
    'random.seed(SEED)',
    'to_remove = sorted(random.sample(candidates, COUNT), reverse=True)',
    'for i in to_remove:',
    '    s.remove_sites([i])',
    'print(s.to(fmt="cif"))',
    '',
  ].join('\n')
  return {
    code,
    provenance: {
      parentCellId: parentKey,
      operation: `tweak:vacancy(${element},${count})`,
    },
    title: `Vacancy ${element}×${count}`,
  }
}
