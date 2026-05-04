import { useLLMConfigStore } from '@/stores/llm-config-store'
import { mergeFetchedModels } from '@/lib/llm-model-catalog'
import {
  applyPricingToModels,
  getPricingCatalog,
} from '@/lib/model-pricing'
import { errorMessage } from '@/lib/error-message'
import type { LLMProvider } from '@/types/llm'
import type {
  LatticeAuthSessionPayload,
  LlmListModelsResultPayload,
} from '@/types/electron'

export const LATTICE_AUTH_API_KEY_REF = 'lattice-secure-token'
export const LATTICE_AUTH_PROVIDER_ID = 'lattice-blog'
export const LATTICE_AUTH_PROVIDER_NAME = 'chaxiejun.xyz'

export type AuthenticatedLatticeSession = Extract<
  LatticeAuthSessionPayload,
  { authenticated: true }
>

export type LatticeProviderConnectResult =
  | {
      ok: true
      provider: LLMProvider
      fetched: number
      added: number
      updated: number
      priced: number
      durationMs: number
      selectedModelId: string | null
    }
  | {
      ok: false
      provider: LLMProvider
      message: string
      status?: number
    }

export function upsertLatticeAuthProvider(
  session: AuthenticatedLatticeSession,
): LLMProvider {
  const store = useLLMConfigStore.getState()
  const existing = store.providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID)
  const provider: LLMProvider = {
    ...(existing ?? {}),
    id: existing?.id ?? LATTICE_AUTH_PROVIDER_ID,
    name: LATTICE_AUTH_PROVIDER_NAME,
    type: 'openai-compatible',
    baseUrl: session.baseUrl,
    apiKey: LATTICE_AUTH_API_KEY_REF,
    enabled: true,
    mentionResolve: 'allow',
    models: existing?.models ?? [],
  }

  if (existing) {
    store.updateProvider(existing.id, {
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      enabled: provider.enabled,
      mentionResolve: provider.mentionResolve,
      models: provider.models,
    })
  } else {
    useLLMConfigStore.setState((s) => ({
      providers: [...s.providers, provider],
    }))
  }

  const firstModel = provider.models[0]
  if (firstModel && (!store.agent.providerId || !store.agent.modelId)) {
    store.updateAgentConfig({
      providerId: provider.id,
      modelId: firstModel.id,
    })
  }

  return provider
}

export async function connectLatticeAuthProviderModels(
  session: AuthenticatedLatticeSession,
): Promise<LatticeProviderConnectResult> {
  const provider = upsertLatticeAuthProvider(session)
  const api = window.electronAPI
  if (!api?.llmListModels) {
    return {
      ok: false,
      provider,
      message: 'Model setup requires the Electron desktop shell.',
    }
  }

  let result: LlmListModelsResultPayload
  try {
    result = await api.llmListModels({
      provider: 'openai-compatible',
      apiKey: provider.apiKey?.trim() ?? '',
      baseUrl: provider.baseUrl.trim(),
    })
  } catch (err) {
    return {
      ok: false,
      provider,
      message: errorMessage(err),
    }
  }

  if (!result.success) {
    return {
      ok: false,
      provider,
      message: result.error,
      status: result.status,
    }
  }

  const latestProvider =
    useLLMConfigStore
      .getState()
      .providers.find((p) => p.id === provider.id) ?? provider
  const merged = mergeFetchedModels(
    latestProvider.models,
    result.models,
    latestProvider.type,
  )
  let nextModels = merged.models
  let priced = 0
  try {
    const catalog = await getPricingCatalog()
    const applied = applyPricingToModels(nextModels, catalog, latestProvider.type)
    nextModels = applied.models
    priced = applied.priced
  } catch (err) {
    console.warn('[lattice-auth] pricing lookup failed:', errorMessage(err))
  }

  const store = useLLMConfigStore.getState()
  store.updateProvider(provider.id, { models: nextModels, enabled: true })

  const agent = useLLMConfigStore.getState().agent
  const currentValid =
    agent.providerId === provider.id &&
    Boolean(agent.modelId) &&
    nextModels.some((m) => m.id === agent.modelId)
  let selectedModelId: string | null = null
  if (
    !agent.providerId ||
    !agent.modelId ||
    (agent.providerId === provider.id && !currentValid)
  ) {
    const firstModel = nextModels[0]
    if (firstModel) {
      useLLMConfigStore.getState().updateAgentConfig({
        providerId: provider.id,
        modelId: firstModel.id,
      })
      selectedModelId = firstModel.id
    }
  }

  const connectedProvider =
    useLLMConfigStore
      .getState()
      .providers.find((p) => p.id === provider.id) ?? {
        ...provider,
        models: nextModels,
      }

  return {
    ok: true,
    provider: connectedProvider,
    fetched: result.models.length,
    added: merged.added,
    updated: merged.updated,
    priced,
    durationMs: result.durationMs,
    selectedModelId,
  }
}

export function disableLatticeAuthProvider(): void {
  const store = useLLMConfigStore.getState()
  const provider = store.providers.find((p) => p.id === LATTICE_AUTH_PROVIDER_ID)
  if (!provider) return
  store.updateProvider(provider.id, { apiKey: '', enabled: false })
}
