// Extractor version tag + generic-term vocabulary.
//
// Every chain written to IndexedDB carries an `extractor_version` string
// so pipeline changes stay backwards-traceable — UIs can filter by version
// without having to inspect the chain payload itself.
//
// Bump `CURRENT_EXTRACTOR_VERSION` whenever the prompt schema or the
// quality gate changes in a user-visible way. Old rows keep their stamp;
// the read path defaults to the latest version.

export const CURRENT_EXTRACTOR_VERSION = 'v2-2026-04'
export const LEGACY_EXTRACTOR_VERSION = 'v1-legacy'

export type ChainQuality = 'accepted' | 'diagnostic' | 'legacy'

/** Tokens that, standing alone, don't carry scientific meaning.
 *  The quality evaluator rejects chains composed entirely of these
 *  (with no value/unit and no substantive context_text). */
export const GENERIC_TERMS: ReadonlySet<string> = new Set([
  // Process verbs / nouns
  'sinter', 'sintering', 'sintered',
  'anneal', 'annealing', 'annealed',
  'calcine', 'calcination', 'calcined',
  'mill', 'milling', 'ball-milling', 'ball mill',
  'mix', 'mixing', 'stir', 'stirring',
  'dry', 'drying', 'heat', 'heating',
  'press', 'pressing',
  // Characterization techniques (without an explicit observation)
  'sem', 'tem', 'stem', 'xrd', 'xps', 'raman', 'ftir', 'uv-vis',
  'bet', 'dsc', 'tga', 'eds', 'edx', 'afm', 'nmr', 'icp',
  // Generic placeholders
  'sample', 'samples', 'material', 'materials', 'the material',
  'compound', 'specimen', 'product', 'reported material',
  'reported value',
])

export function isGenericTerm(name: string): boolean {
  return GENERIC_TERMS.has(name.trim().toLowerCase())
}
