// Layered resolver. Mirrors Claude Code's funnel-shaped model resolution:
// each layer may supply a full or partial `ModelBinding`, and later layers
// override earlier ones slot-by-slot.
//
// Precedence (high → low):
//
//   1. perRequestOverride  — supplied via ctx on a single submit
//   2. skillOverride       — PromptCommand.model from frontmatter
//   3. session override    — useModelRouteStore (`/model`, `/fast`, `/effort`)
//   4. mode default        — llm-config-store dialog/agent binding + effort
//
// The resolver does NOT look up the actual LLMProvider / LLMModel object —
// that's `tryResolveProviderModel`'s job. It only computes the canonical
// (providerId, modelId, reasoningEffort) triple.

import type { ComposerMode, ReasoningEffort } from '../../types/llm'
import type {
  ModelBinding,
  ModelBindingSource,
  ResolvedBindingLayer,
} from './types'

export interface ResolveInput {
  mode: ComposerMode
  /** Mode-level defaults from the persistent config store. */
  modeDefault: ModelBinding
  /** Session-level overrides (`/model`, `/effort`). */
  sessionOverride?: ModelBinding
  /** Skill / command `model` frontmatter. */
  skillOverride?: ModelBinding | null
  /** Per-request override supplied by the caller (ctx.modelBindingOverride). */
  perRequestOverride?: ModelBinding | null
}

export interface ResolvedBinding {
  providerId: string | null
  modelId: string | null
  reasoningEffort: ReasoningEffort | undefined
  /** Ordered top-down trace of which layer supplied each field. Useful for
   *  the chat's "why is this model active" hover and for unit tests. */
  trace: ResolvedBindingLayer[]
  /** Which layer *actually* won the binding (providerId + modelId). */
  winner: ModelBindingSource
}

export function resolveEffectiveBinding(
  input: ResolveInput,
): ResolvedBinding {
  // Build the ordered stack high → low precedence. Empty / missing layers
  // fall out so `reduce` below doesn't consider them.
  const stack: ResolvedBindingLayer[] = []
  if (input.perRequestOverride)
    stack.push({ source: 'per-request', binding: input.perRequestOverride })
  if (input.skillOverride)
    stack.push({ source: 'skill', binding: input.skillOverride })
  if (input.sessionOverride && !isEmpty(input.sessionOverride)) {
    stack.push({ source: 'session-override', binding: input.sessionOverride })
  }
  stack.push({ source: 'mode-default', binding: input.modeDefault })

  // Merge high → low: earlier entries win.
  let providerId: string | null = null
  let modelId: string | null = null
  let reasoningEffort: ReasoningEffort | undefined = undefined
  let winner: ModelBindingSource = 'mode-default'
  let claimedProvider = false
  let claimedModel = false
  let claimedEffort = false

  for (const layer of stack) {
    const b = layer.binding
    if (!claimedProvider && b.providerId != null) {
      providerId = b.providerId
      claimedProvider = true
      winner = layer.source
    }
    if (!claimedModel && b.modelId != null) {
      modelId = b.modelId
      claimedModel = true
      // When provider and model come from different layers, the model's
      // layer names the winner — it's the more specific slot.
      winner = layer.source
    }
    if (!claimedEffort && b.reasoningEffort != null) {
      reasoningEffort = b.reasoningEffort
      claimedEffort = true
    }
    if (claimedProvider && claimedModel && claimedEffort) break
  }

  return {
    providerId,
    modelId,
    reasoningEffort,
    trace: stack,
    winner,
  }
}

function isEmpty(b: ModelBinding): boolean {
  return (
    b.providerId == null &&
    b.modelId == null &&
    b.reasoningEffort == null
  )
}
