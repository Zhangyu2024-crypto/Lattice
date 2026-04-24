// Static snippet catalog for the Compute Pro workbench.
//
// Ported from lattice-cli/src/lattice_cli/tools/compute_exec.py L107-802
// (the `_BUILTIN_SNIPPETS` array). Keeps the same id / title /
// description / category / language / code fields so the sidebar can
// group by category and match lattice-cli's pro.html Compute module UX.
//
// Per-language snippet bodies live under ./compute-snippets/<lang>.ts so
// this file stays small and focused on catalog assembly + helpers. The
// code bodies reference the session-context globals ACTIVE_CIFS /
// CURRENT_SPECTRUM / WORKDIR injected by the runner (see
// electron/compute-runner.ts PYTHON_HEADER and the lattice-cli header at
// compute_exec.py:51-100).

import type { ComputeLanguage, ComputeSnippet } from '../types/pro-api'
import { PYTHON_SNIPPETS } from './compute-snippets/python'
import { LAMMPS_SNIPPETS } from './compute-snippets/lammps'
import { CP2K_SNIPPETS } from './compute-snippets/cp2k'

export const COMPUTE_SNIPPETS_CATALOG: Record<ComputeLanguage, ComputeSnippet[]> = {
  python: PYTHON_SNIPPETS,
  lammps: LAMMPS_SNIPPETS,
  cp2k: CP2K_SNIPPETS,
  shell: [],
}

/**
 * Return (a shallow copy of) the snippets for a given language, or the union
 * of all snippets if no language is specified. Copies so callers cannot
 * mutate the shared module-level arrays.
 */
export function getComputeSnippets(language?: ComputeLanguage): ComputeSnippet[] {
  const source = language
    ? COMPUTE_SNIPPETS_CATALOG[language] ?? []
    : Object.values(COMPUTE_SNIPPETS_CATALOG).flat()
  return source.map((row) => ({ ...row }))
}

/**
 * Group snippets for a language by `category`, preserving insertion order
 * inside each group. Snippets without a category fall into the 'General'
 * bucket so the sidebar never drops an entry.
 */
export function getComputeSnippetsByCategory(
  language: ComputeLanguage,
): Array<{ category: string; snippets: ComputeSnippet[] }> {
  const list = COMPUTE_SNIPPETS_CATALOG[language] ?? []
  const order: string[] = []
  const grouped = new Map<string, ComputeSnippet[]>()
  for (const snippet of list) {
    const cat = snippet.category?.trim() || 'General'
    if (!grouped.has(cat)) {
      grouped.set(cat, [])
      order.push(cat)
    }
    grouped.get(cat)!.push({ ...snippet })
  }
  return order.map((category) => ({
    category,
    snippets: grouped.get(category) ?? [],
  }))
}
