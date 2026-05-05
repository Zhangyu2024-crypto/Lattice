import { LATTICE_AUTH_PROVIDER_ID, LATTICE_AUTH_PROVIDER_NAME } from './lattice-auth-client'
import type { LLMModel, LLMProvider } from '../types/llm'

export function publicModelLabel(
  resolved: { provider: LLMProvider; model: LLMModel } | null | undefined,
  fallback = 'no model',
): string {
  if (!resolved) return fallback
  if (resolved.provider.id === LATTICE_AUTH_PROVIDER_ID) {
    return LATTICE_AUTH_PROVIDER_NAME
  }
  return `${resolved.provider.name} / ${resolved.model.label}`
}

export function publicProviderModelLabel(
  provider: LLMProvider,
  model: LLMModel,
): string {
  if (provider.id === LATTICE_AUTH_PROVIDER_ID) return LATTICE_AUTH_PROVIDER_NAME
  return `${provider.name} / ${model.label}`
}

export function publicModelOverrideLabel(
  provider: LLMProvider | undefined,
  model: LLMModel | undefined,
  fallback: string,
): string {
  if (provider?.id === LATTICE_AUTH_PROVIDER_ID) return LATTICE_AUTH_PROVIDER_NAME
  if (provider && model) return `${provider.name} -> ${model.label}`
  return fallback
}
