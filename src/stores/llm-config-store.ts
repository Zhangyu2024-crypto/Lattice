import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  BudgetConfig,
  ComposerMode,
  GenerationConfig,
  LLMModel,
  LLMProvider,
  LLMProviderType,
  MentionResolvePolicy,
  RateLimitConfig,
} from '../types/llm'
import {
  DEFAULT_AGENT_SYSTEM_PROMPT,
  DEFAULT_DIALOG_SYSTEM_PROMPT,
  createDefaultProviders,
  genLLMId,
} from './llm-defaults'

// Default generation configs. Separated from the store so tests and the
// "reset" actions can cheaply clone them via the spread operator.
const DEFAULT_DIALOG_CONFIG: GenerationConfig = {
  providerId: null,
  modelId: null,
  temperature: 0.7,
  maxTokens: 1024,
  topP: 1.0,
  // Single source of truth in `llm-defaults.ts` — the modal's "reset" button
  // and the migrate step both re-seed from the same constant.
  systemPrompt: DEFAULT_DIALOG_SYSTEM_PROMPT,
  reasoningEffort: 'low',
}

const DEFAULT_AGENT_CONFIG: GenerationConfig = {
  providerId: null,
  modelId: null,
  temperature: 0.0,
  maxTokens: 8192,
  topP: 1.0,
  systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
  reasoningEffort: 'medium',
}

function withDefaultSystemPrompt(
  mode: ComposerMode,
  config: GenerationConfig,
): GenerationConfig {
  return {
    ...config,
    systemPrompt:
      mode === 'dialog'
        ? DEFAULT_DIALOG_SYSTEM_PROMPT
        : DEFAULT_AGENT_SYSTEM_PROMPT,
  }
}

function omitSystemPromptPatch(
  patch: Partial<GenerationConfig>,
): Partial<GenerationConfig> {
  const { systemPrompt: _systemPrompt, ...rest } = patch
  return rest
}

const DEFAULT_BUDGET: BudgetConfig = {
  daily: {
    tokenLimit: 500_000,
    costLimitUSD: 5.0,
  },
  monthly: {
    tokenLimit: null,
    costLimitUSD: null,
  },
  perRequest: {
    maxInputTokens: 100_000,
    maxOutputTokens: 16_000,
  },
  warnAtPct: 0.8,
  mode: 'warn',
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxCallsPerMinute: 30,
  maxTokensPerRequest: 150_000,
  retryOn429: true,
  exponentialBackoff: {
    enabled: true,
    baseMs: 1000,
    maxMs: 30_000,
  },
}

const REMOVED_DEV_PROVIDER_IDS = new Set(['clawd-proxy'])
const URL_FETCHED_BUILT_IN_PROVIDER_IDS = new Set([
  'anthropic-default',
  'openai-default',
])

const withoutRemovedDevProviders = (providers: LLMProvider[]): LLMProvider[] =>
  providers.filter((provider) => !REMOVED_DEV_PROVIDER_IDS.has(provider.id))

const clearRemovedDevProviderBinding = (
  config: GenerationConfig,
): GenerationConfig =>
  config.providerId && REMOVED_DEV_PROVIDER_IDS.has(config.providerId)
    ? { ...config, providerId: null, modelId: null }
    : config

const clearUrlFetchedBuiltInModels = (
  providers: LLMProvider[],
): LLMProvider[] =>
  providers.map((provider) =>
    URL_FETCHED_BUILT_IN_PROVIDER_IDS.has(provider.id) &&
    !provider.enabled &&
    !provider.apiKey
      ? { ...provider, models: [] }
      : provider,
  )

const clearBrokenModelBinding = (
  providers: LLMProvider[],
  config: GenerationConfig,
): GenerationConfig =>
  tryResolveProviderModel(providers, config)
    ? config
    : { ...config, providerId: null, modelId: null }

function tryResolveProviderModel(
  providers: LLMProvider[],
  cfg: Pick<GenerationConfig, 'providerId' | 'modelId'>,
): { provider: LLMProvider; model: LLMModel } | null {
  if (!cfg.providerId || !cfg.modelId) return null
  const provider = providers.find((p) => p.id === cfg.providerId)
  if (!provider) return null
  const model = provider.models.find((m) => m.id === cfg.modelId)
  if (!model) return null
  return { provider, model }
}

/** Keys mirrored between dialog and agent whenever either side changes. */
function pickModelBindingPatch(
  patch: Partial<GenerationConfig>,
): Partial<Pick<GenerationConfig, 'providerId' | 'modelId'>> {
  const out: Partial<Pick<GenerationConfig, 'providerId' | 'modelId'>> = {}
  if ('providerId' in patch) out.providerId = patch.providerId
  if ('modelId' in patch) out.modelId = patch.modelId
  return out
}

/**
 * Resolve provider + model for a composer mode. If that mode has no valid
 * binding (common when users only configure Agent in Settings), fall back to
 * the other mode's binding so a working provider still routes dialog/agent
 * traffic. Generation params (temperature, system prompt, etc.) stay
 * mode-specific in {@link sendLlmChat} — only the provider endpoint + model
 * id are shared by this fallback.
 */
export function resolveProviderModelForMode(
  state: {
    providers: LLMProvider[]
    dialog: Pick<GenerationConfig, 'providerId' | 'modelId'>
    agent: Pick<GenerationConfig, 'providerId' | 'modelId'>
  },
  mode: ComposerMode,
): { provider: LLMProvider; model: LLMModel } | null {
  const primary = mode === 'dialog' ? state.dialog : state.agent
  const secondary = mode === 'dialog' ? state.agent : state.dialog
  return (
    tryResolveProviderModel(state.providers, primary) ??
    tryResolveProviderModel(state.providers, secondary)
  )
}

const SETTINGS_MODELS_HINT = 'Open Settings -> Connections (Ctrl+Shift+L).'

function explainBrokenBinding(
  providers: LLMProvider[],
  label: 'Dialog' | 'Agent',
  cfg: Pick<GenerationConfig, 'providerId' | 'modelId'>,
): string | null {
  if (!cfg.providerId || !cfg.modelId) return null
  if (tryResolveProviderModel(providers, cfg)) return null
  const p = providers.find((x) => x.id === cfg.providerId)
  if (!p) return `The saved ${label} connection no longer exists.`
  if (!p.models.some((m) => m.id === cfg.modelId)) {
    return `The saved ${label} option is not in the connection list. Refresh the connection or pick a new default.`
  }
  return `The saved ${label} option could not be resolved.`
}

/**
 * User-facing copy when {@link resolveProviderModelForMode} returns null.
 * Distinguishes "no providers", "nothing selected", and stale bindings.
 */
export function getUnresolvedModelMessage(
  state: {
    providers: LLMProvider[]
    dialog: Pick<GenerationConfig, 'providerId' | 'modelId'>
    agent: Pick<GenerationConfig, 'providerId' | 'modelId'>
  },
  mode: ComposerMode,
): string {
  const { providers, dialog, agent } = state

  if (providers.length === 0) {
    return `No service connections are configured. ${SETTINGS_MODELS_HINT}`
  }

  const dComplete = Boolean(dialog.providerId && dialog.modelId)
  const aComplete = Boolean(agent.providerId && agent.modelId)
  if (!dComplete && !aComplete) {
    return `No default connection is selected for Dialog or Agent. ${SETTINGS_MODELS_HINT}`
  }

  const hints: string[] = []
  const dh = explainBrokenBinding(providers, 'Dialog', dialog)
  const ah = explainBrokenBinding(providers, 'Agent', agent)
  if (dh) hints.push(dh)
  if (ah) hints.push(ah)
  if (hints.length > 0) {
    return `${hints.join(' ')} ${SETTINGS_MODELS_HINT}`
  }

  return `Could not resolve a connection for ${mode} mode. ${SETTINGS_MODELS_HINT}`
}

interface LLMConfigState {
  providers: LLMProvider[]
  activeProviderId: string | null
  dialog: GenerationConfig
  agent: GenerationConfig
  budget: BudgetConfig
  rateLimit: RateLimitConfig

  // Provider CRUD
  addProvider: (input: Omit<LLMProvider, 'id'>) => string
  removeProvider: (id: string) => void
  updateProvider: (id: string, patch: Partial<Omit<LLMProvider, 'id'>>) => void
  enableProvider: (id: string, enabled: boolean) => void
  setActiveProvider: (id: string | null) => void

  // Generation per mode
  updateDialogConfig: (patch: Partial<GenerationConfig>) => void
  updateAgentConfig: (patch: Partial<GenerationConfig>) => void
  resetDialogConfig: () => void
  resetAgentConfig: () => void

  // Budget + rate limit
  updateBudget: (patch: Partial<BudgetConfig>) => void
  updateRateLimit: (patch: Partial<RateLimitConfig>) => void

  // Selectors (inline methods — callers read via store.getState() or hook
  // with referential-stability caveats; these return freshly computed values)
  getResolvedModel: (
    mode: ComposerMode,
  ) => { provider: LLMProvider; model: LLMModel } | null
  findModel: (providerId: string, modelId: string) => LLMModel | null
}

// Shallow-merge helper that preserves nested object identity when a patch
// does not touch a sub-object. `perRequest`, `daily`, `monthly`, and
// `exponentialBackoff` are nested so we spread them explicitly when the
// caller supplies a partial patch. Note: under the current `Partial<…>`
// signature TypeScript forces callers to provide complete nested objects,
// but the nested spread stays in place so a future deep-partial relaxation
// will not leak values from prior updates.
const mergeBudget = (prev: BudgetConfig, patch: Partial<BudgetConfig>): BudgetConfig => ({
  ...prev,
  ...patch,
  daily: patch.daily ? { ...prev.daily, ...patch.daily } : prev.daily,
  monthly: patch.monthly ? { ...prev.monthly, ...patch.monthly } : prev.monthly,
  perRequest: patch.perRequest
    ? { ...prev.perRequest, ...patch.perRequest }
    : prev.perRequest,
})

const mergeRateLimit = (
  prev: RateLimitConfig,
  patch: Partial<RateLimitConfig>,
): RateLimitConfig => ({
  ...prev,
  ...patch,
  exponentialBackoff: patch.exponentialBackoff
    ? { ...prev.exponentialBackoff, ...patch.exponentialBackoff }
    : prev.exponentialBackoff,
})

// Pick a safe default policy for providers that don't have one set —
// typically legacy persisted configs from before MP-1 landed. Trusted
// first-party providers default to 'allow'; anything that could be a proxy
// / self-hosted endpoint defaults to 'confirm' so the user at least sees
// what is going out.
const inferMentionResolvePolicy = (
  provider: { id: string; type: LLMProviderType },
): MentionResolvePolicy => {
  switch (provider.type) {
    case 'anthropic':
    case 'openai':
      return 'allow'
    case 'openai-compatible':
    case 'ollama':
    case 'custom':
      return 'confirm'
    default: {
      // Exhaustiveness guard: if a new LLMProviderType is added we want the
      // compiler to fail here rather than silently falling through to 'allow'.
      const _exhaustive: never = provider.type
      void _exhaustive
      return 'confirm'
    }
  }
}

export const useLLMConfigStore = create<LLMConfigState>()(
  persist(
    (set, get) => ({
      providers: createDefaultProviders(),
      activeProviderId: null,
      dialog: { ...DEFAULT_DIALOG_CONFIG },
      agent: { ...DEFAULT_AGENT_CONFIG },
      budget: {
        ...DEFAULT_BUDGET,
        daily: { ...DEFAULT_BUDGET.daily },
        monthly: { ...DEFAULT_BUDGET.monthly },
        perRequest: { ...DEFAULT_BUDGET.perRequest },
      },
      rateLimit: {
        ...DEFAULT_RATE_LIMIT,
        exponentialBackoff: { ...DEFAULT_RATE_LIMIT.exponentialBackoff },
      },

      addProvider: (input) => {
        const id = genLLMId('llm')
        const full: LLMProvider = { ...input, id, models: [...input.models] }
        set((s) => ({ providers: [...s.providers, full] }))
        return id
      },

      removeProvider: (id) => {
        set((s) => {
          const providers = s.providers.filter((p) => p.id !== id)
          // If the removed provider was the active one, clear the pointer so
          // downstream consumers never dereference a stale id.
          const activeProviderId =
            s.activeProviderId === id ? null : s.activeProviderId
          // Clear dialog/agent config pointers tied to the removed provider
          // so `getResolvedModel` can degrade gracefully.
          const dialog =
            s.dialog.providerId === id
              ? { ...s.dialog, providerId: null, modelId: null }
              : s.dialog
          const agent =
            s.agent.providerId === id
              ? { ...s.agent, providerId: null, modelId: null }
              : s.agent
          return { providers, activeProviderId, dialog, agent }
        })
      },

      updateProvider: (id, patch) => {
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...patch,
                  id: p.id, // Guard: id is immutable even if patch carries one.
                  models: patch.models ? [...patch.models] : p.models,
                }
              : p,
          ),
        }))
      },

      enableProvider: (id, enabled) => {
        set((s) => ({
          providers: s.providers.map((p) =>
            p.id === id ? { ...p, enabled } : p,
          ),
        }))
      },

      setActiveProvider: (id) => {
        if (id !== null && !get().providers.some((p) => p.id === id)) return
        set({ activeProviderId: id })
      },

      updateDialogConfig: (patch) => {
        set((s) => {
          const safePatch = omitSystemPromptPatch(patch)
          const dialog = withDefaultSystemPrompt('dialog', {
            ...s.dialog,
            ...safePatch,
          })
          const agent = withDefaultSystemPrompt('agent', {
            ...s.agent,
            ...safePatch,
          })
          return { dialog, agent }
        })
      },

      updateAgentConfig: (patch) => {
        set((s) => {
          const safePatch = omitSystemPromptPatch(patch)
          const agent = withDefaultSystemPrompt('agent', {
            ...s.agent,
            ...safePatch,
          })
          const dialog = withDefaultSystemPrompt('dialog', {
            ...s.dialog,
            ...safePatch,
          })
          return { dialog, agent }
        })
      },

      resetDialogConfig: () => {
        set((s) => {
          const bind =
            s.dialog.providerId && s.dialog.modelId
              ? {
                  providerId: s.dialog.providerId,
                  modelId: s.dialog.modelId,
                }
              : s.agent.providerId && s.agent.modelId
                ? {
                    providerId: s.agent.providerId,
                    modelId: s.agent.modelId,
                  }
                : {}
          const dialog = { ...DEFAULT_DIALOG_CONFIG, ...bind }
          const agent = { ...s.agent, ...bind }
          return { dialog, agent }
        })
      },

      resetAgentConfig: () => {
        set((s) => {
          const bind =
            s.agent.providerId && s.agent.modelId
              ? {
                  providerId: s.agent.providerId,
                  modelId: s.agent.modelId,
                }
              : s.dialog.providerId && s.dialog.modelId
                ? {
                    providerId: s.dialog.providerId,
                    modelId: s.dialog.modelId,
                  }
                : {}
          const agent = { ...DEFAULT_AGENT_CONFIG, ...bind }
          const dialog = { ...s.dialog, ...bind }
          return { dialog, agent }
        })
      },

      updateBudget: (patch) => {
        set((s) => ({ budget: mergeBudget(s.budget, patch) }))
      },

      updateRateLimit: (patch) => {
        set((s) => ({ rateLimit: mergeRateLimit(s.rateLimit, patch) }))
      },

      getResolvedModel: (mode) => resolveProviderModelForMode(get(), mode),

      findModel: (providerId, modelId) => {
        const provider = get().providers.find((p) => p.id === providerId)
        if (!provider) return null
        return provider.models.find((m) => m.id === modelId) ?? null
      },
    }),
    {
      name: 'lattice.llm-config',
      version: 7,
      storage: createJSONStorage(() => localStorage),
      // All fields are small and meant to survive restarts — no partialize
      // needed. The only large-ish field (`providers[].models`) caps at a
      // dozen entries per provider in practice.
      migrate: (persistedState: unknown, fromVersion: number) => {
        const state = (persistedState ?? {}) as Partial<LLMConfigState>
        const providers: LLMProvider[] = withoutRemovedDevProviders(
          Array.isArray(state.providers)
            ? [...state.providers]
            : createDefaultProviders(),
        )

        // v3: backfill `mentionResolve` on any provider that predates MP-1.
        // Idempotent — only fills when the field is absent.
        const normalizedProviders = clearUrlFetchedBuiltInModels(
          providers.map((provider) =>
            provider.mentionResolve
              ? provider
              : { ...provider, mentionResolve: inferMentionResolvePolicy(provider) },
          ),
        )

        let dialog: GenerationConfig = clearRemovedDevProviderBinding({
          ...DEFAULT_DIALOG_CONFIG,
          ...(state.dialog ?? {}),
        })
        let agent: GenerationConfig = clearRemovedDevProviderBinding({
          ...DEFAULT_AGENT_CONFIG,
          ...(state.agent ?? {}),
        })

        // v4: one shared provider/model binding for both modes (dialog keeps
        // its pair when both were valid; otherwise fall back to agent).
        if (fromVersion < 4) {
          const dOk = tryResolveProviderModel(normalizedProviders, dialog)
          const aOk = tryResolveProviderModel(normalizedProviders, agent)
          const binding = dOk
            ? {
                providerId: dialog.providerId as string,
                modelId: dialog.modelId as string,
              }
            : aOk
              ? {
                  providerId: agent.providerId as string,
                  modelId: agent.modelId as string,
                }
              : null
          if (binding) {
            dialog = { ...dialog, ...binding }
            agent = { ...agent, ...binding }
          }
        }

        dialog = withDefaultSystemPrompt(
          'dialog',
          clearBrokenModelBinding(normalizedProviders, dialog),
        )
        agent = withDefaultSystemPrompt(
          'agent',
          clearBrokenModelBinding(normalizedProviders, agent),
        )

        return {
          ...state,
          providers: normalizedProviders,
          activeProviderId:
            state.activeProviderId &&
            !REMOVED_DEV_PROVIDER_IDS.has(state.activeProviderId)
              ? state.activeProviderId
              : null,
          dialog,
          agent,
          budget: state.budget ?? {
            ...DEFAULT_BUDGET,
            daily: { ...DEFAULT_BUDGET.daily },
            monthly: { ...DEFAULT_BUDGET.monthly },
            perRequest: { ...DEFAULT_BUDGET.perRequest },
          },
          rateLimit: state.rateLimit ?? {
            ...DEFAULT_RATE_LIMIT,
            exponentialBackoff: { ...DEFAULT_RATE_LIMIT.exponentialBackoff },
          },
        }
      },
    },
  ),
)

/**
 * React hook returning the resolved `{ provider, model }` for a composer
 * mode. Selects only stable primitive fields (providerId / modelId) plus
 * the providers array, then memoises the result so callers get a
 * reference-stable object — using `useLLMConfigStore(s => s.getResolvedModel(...))`
 * directly breaks React's getSnapshot cache (fresh object each call →
 * "Maximum update depth exceeded").
 */
export function useResolvedModel(
  mode: ComposerMode,
): { provider: LLMProvider; model: LLMModel } | null {
  const dialogProviderId = useLLMConfigStore((s) => s.dialog.providerId)
  const dialogModelId = useLLMConfigStore((s) => s.dialog.modelId)
  const agentProviderId = useLLMConfigStore((s) => s.agent.providerId)
  const agentModelId = useLLMConfigStore((s) => s.agent.modelId)
  const providers = useLLMConfigStore((s) => s.providers)
  return useMemo(() => {
    const dialog = {
      providerId: dialogProviderId,
      modelId: dialogModelId,
    } satisfies Pick<GenerationConfig, 'providerId' | 'modelId'>
    const agent = {
      providerId: agentProviderId,
      modelId: agentModelId,
    } satisfies Pick<GenerationConfig, 'providerId' | 'modelId'>
    return resolveProviderModelForMode({ providers, dialog, agent }, mode)
  }, [
    dialogProviderId,
    dialogModelId,
    agentProviderId,
    agentModelId,
    providers,
    mode,
  ])
}
