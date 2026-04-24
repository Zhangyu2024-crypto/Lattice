// Model-routing primitives.
//
// Shape ported from Claude Code's layered model-resolution system (see
// `src/utils/model/model.ts` in that repo). We reuse Lattice's existing
// {providerId, modelId, reasoningEffort} axes rather than introducing a
// parallel alias namespace — the project's model catalog is already
// provider-scoped through `LLMProvider.models`, and aliases would just
// duplicate that lookup table.

import type { ReasoningEffort } from '../../types/llm'

/**
 * An address into the `(providerId, modelId, reasoningEffort)` space.
 * All fields are optional so partial overrides can stack — e.g. `/fast`
 * only sets `reasoningEffort: 'low'` and inherits provider/model from
 * the mode default below it.
 */
export interface ModelBinding {
  providerId?: string | null
  modelId?: string | null
  reasoningEffort?: ReasoningEffort
}

/** Source of a layer in the override chain; used for telemetry / tests. */
export type ModelBindingSource =
  | 'mode-default'
  | 'session-override'
  | 'skill'
  | 'per-request'

export interface ResolvedBindingLayer {
  source: ModelBindingSource
  binding: ModelBinding
}
