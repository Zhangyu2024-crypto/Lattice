// Cross-store selectors — not part of `store.ts` so the route store stays
// single-responsibility. These look up facts that span
// `useModelRouteStore` and `useLLMConfigStore`, e.g. "is the session
// override still pointing at a provider/model that exists and is enabled?"

import type { LLMProvider } from '../../types/llm'
import type { ModelBinding } from './types'

export interface OverrideBrokenState {
  /** When the override is fully specified (both providerId and modelId)
   *  but resolves to nothing in the current provider catalog. */
  broken: boolean
  /** The unresolved provider id, if any. */
  providerId?: string
  /** The unresolved model id, if any. */
  modelId?: string
  /** Why it's broken — provider missing, disabled, missing key, or model
   *  id not in the provider's catalog. */
  reason?:
    | 'provider-missing'
    | 'provider-disabled'
    | 'provider-no-key'
    | 'model-missing'
}

/**
 * Decide whether a `{providerId, modelId}` pair can be served by the
 * currently-configured provider catalog. Returns `{broken: false}` for
 * partial bindings (one id missing) — the resolver merges partial layers
 * with the mode default, so a half-empty override isn't "broken" per se.
 */
export function isBindingBroken(
  binding: ModelBinding | undefined | null,
  providers: readonly LLMProvider[],
): OverrideBrokenState {
  if (!binding) return { broken: false }
  const { providerId, modelId } = binding
  if (!providerId || !modelId) return { broken: false }

  const provider = providers.find((p) => p.id === providerId)
  if (!provider) {
    return { broken: true, providerId, modelId, reason: 'provider-missing' }
  }
  if (!provider.enabled) {
    return { broken: true, providerId, modelId, reason: 'provider-disabled' }
  }
  if (!provider.apiKey || !provider.apiKey.trim()) {
    return { broken: true, providerId, modelId, reason: 'provider-no-key' }
  }
  if (!provider.models.some((m) => m.id === modelId)) {
    return { broken: true, providerId, modelId, reason: 'model-missing' }
  }
  return { broken: false }
}

/**
 * Render a user-facing reason string for a broken override. Returns empty
 * string when `state.broken` is false so callers can concatenate without a
 * branch.
 */
export function getBrokenBindingMessage(state: OverrideBrokenState): string {
  if (!state.broken) return ''
  const target = `${state.providerId}/${state.modelId}`
  switch (state.reason) {
    case 'provider-missing':
      return `Session model override points at provider "${state.providerId}" which no longer exists. Run /model reset or fix Settings → Models.`
    case 'provider-disabled':
      return `Session model override points at ${target} but that provider is disabled. Run /model reset or re-enable it in Settings → Models.`
    case 'provider-no-key':
      return `Session model override points at ${target} but the provider has no API key. Run /model reset or add a key in Settings → Models.`
    case 'model-missing':
      return `Session model override points at ${target} but the model is not in the provider's catalog. Run /model reset or refresh models in Settings → Models.`
    default:
      return `Session model override at ${target} is no longer usable. Run /model reset or fix Settings → Models.`
  }
}
