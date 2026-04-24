// Chain quality evaluator — the gate that decides whether a shape-valid
// LLM output deserves to land in the knowledge DB as `accepted`,
// `diagnostic` (kept for debugging but hidden by default), or `rejected`
// (not persisted at all).
//
// Kept deliberately mechanical: the LLM prompt already enforces these
// requirements, so the evaluator catches drift rather than redoing
// extraction. If a rule here starts firing frequently, the prompt is
// the thing to fix — not these thresholds.

import type { ChainNode } from '../../types/library-api'
import { isGenericTerm } from './extractor-version'

export type QualityVerdict = {
  verdict: 'accepted' | 'diagnostic' | 'rejected'
  reasons: string[]
}

export interface EvaluableChain {
  nodes: Array<Pick<ChainNode, 'role' | 'name' | 'value' | 'unit'>>
  context_text?: string
  context_section?: string
}

const MIN_CONTEXT_LEN = 40
const CHARACTERIZATION_ROLES = new Set(['measurement'])
/** Tokens that are *technique* labels — only acceptable as measurement
 *  nodes when paired with a concrete observation somewhere in the chain. */
const CHARACTERIZATION_TECHNIQUES = new Set([
  'sem', 'tem', 'stem', 'xrd', 'xps', 'raman', 'ftir', 'uv-vis', 'uv/vis',
  'bet', 'dsc', 'tga', 'eds', 'edx', 'afm', 'nmr', 'icp',
])

/** Pure numeric/time/percent detection inside context_text, as a fallback
 *  when no node has an explicit value+unit. Mirrors the LLM rule "some
 *  quantitative conclusion must be identifiable".
 *
 *  The trailing `(?=\W|$)` lookahead replaces a naive `\b` — unit symbols
 *  like `Å`, `°C`, `μm` fall outside JS's default `\w` class, so `\b`
 *  after them never fires and the regex would silently miss legitimate
 *  quantities in context text. */
const CONTEXT_HAS_QUANTITY =
  /\b\d+(?:\.\d+)?\s*(?:°C|K|GPa|MPa|Pa|eV|nm|cm|mm|Å|μm|µm|mA|A|mV|V|mg|g|mL|L|mol|%|wt%|mol%|S\/cm|W\/mK|h|min|s)(?=\W|$)/i

function hasNonGenericSystem(nodes: EvaluableChain['nodes']): boolean {
  const systems = nodes.filter((n) => n.role === 'system')
  if (systems.length === 0) return false
  return systems.some((n) => n.name.trim().length > 0 && !isGenericTerm(n.name))
}

function hasValueWithUnit(nodes: EvaluableChain['nodes']): boolean {
  return nodes.some(
    (n) =>
      n.value != null &&
      String(n.value).trim() !== '' &&
      n.unit != null &&
      String(n.unit).trim() !== '',
  )
}

function hasQuantitativeSignal(chain: EvaluableChain): boolean {
  if (hasValueWithUnit(chain.nodes)) return true
  const ctx = (chain.context_text ?? '').trim()
  return ctx.length >= MIN_CONTEXT_LEN && CONTEXT_HAS_QUANTITY.test(ctx)
}

/** A measurement node whose name is a bare technique (SEM/XRD/...) is
 *  only useful if the same chain carries a concrete observation —
 *  either a state node with a descriptor or a value+unit somewhere. */
function bareCharacterizationOnly(chain: EvaluableChain): boolean {
  const measurements = chain.nodes.filter((n) => CHARACTERIZATION_ROLES.has(n.role))
  if (measurements.length === 0) return false
  const allBare = measurements.every(
    (n) =>
      CHARACTERIZATION_TECHNIQUES.has(n.name.trim().toLowerCase()) &&
      (!n.value || String(n.value).trim() === ''),
  )
  if (!allBare) return false
  const hasObservation =
    chain.nodes.some(
      (n) =>
        n.role === 'state' &&
        n.value != null &&
        String(n.value).trim() !== '',
    ) || hasValueWithUnit(chain.nodes)
  return !hasObservation
}

function allGenericContent(chain: EvaluableChain): boolean {
  const nonSystem = chain.nodes.filter((n) => n.role !== 'system')
  if (nonSystem.length === 0) return false
  const everyGeneric = nonSystem.every((n) => isGenericTerm(n.name))
  if (!everyGeneric) return false
  if (hasValueWithUnit(chain.nodes)) return false
  const ctx = (chain.context_text ?? '').trim()
  if (ctx.length >= MIN_CONTEXT_LEN) return false
  return true
}

export function evaluateChainQuality(chain: EvaluableChain): QualityVerdict {
  const reasons: string[] = []

  // Hard rejects — these chains never enter the DB.
  if (allGenericContent(chain)) {
    reasons.push('all-generic-tokens')
    return { verdict: 'rejected', reasons }
  }
  if (bareCharacterizationOnly(chain)) {
    reasons.push('bare-characterization')
    return { verdict: 'rejected', reasons }
  }

  // Acceptance requires: non-generic system + quantitative signal +
  // minimum context length. Falling any one drops the chain to
  // diagnostic instead of rejected.
  if (!hasNonGenericSystem(chain.nodes)) reasons.push('missing-concrete-system')
  if (!hasQuantitativeSignal(chain)) reasons.push('no-quantitative-signal')
  const ctx = (chain.context_text ?? '').trim()
  if (ctx.length < MIN_CONTEXT_LEN) reasons.push('context-too-short')

  if (reasons.length === 0) {
    return { verdict: 'accepted', reasons }
  }
  return { verdict: 'diagnostic', reasons }
}
