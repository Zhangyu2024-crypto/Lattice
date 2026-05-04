import type {
  LLMModel,
  LLMProviderType,
} from '@/types/llm'
import type { LlmListedModelPayload } from '@/types/electron'

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

const buildDefaultModelFromCatalogue = (
  listed: LlmListedModelPayload,
  providerType: LLMProviderType,
): LLMModel => ({
  id: listed.id,
  label: listed.displayName?.trim() || listed.id,
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  supportsTools:
    providerType === 'anthropic' ||
    providerType === 'openai' ||
    providerType === 'openai-compatible',
  supportsVision: false,
  supportsCaching: providerType === 'anthropic',
})

export interface MergeFetchedModelsOutcome {
  models: LLMModel[]
  added: number
  updated: number
}

// Union by id: preserve user-edited pricing/capabilities, refresh labels only
// when the local label is still the raw id, append newly fetched ids.
export const mergeFetchedModels = (
  existing: LLMModel[],
  fetched: LlmListedModelPayload[],
  providerType: LLMProviderType,
): MergeFetchedModelsOutcome => {
  const byId = new Map<string, LLMModel>(existing.map((m) => [m.id, m]))
  let added = 0
  let updated = 0
  for (const entry of fetched) {
    const current = byId.get(entry.id)
    if (!current) {
      byId.set(entry.id, buildDefaultModelFromCatalogue(entry, providerType))
      added += 1
      continue
    }
    const newLabel = entry.displayName?.trim()
    if (newLabel && current.label === current.id && newLabel !== current.label) {
      byId.set(entry.id, { ...current, label: newLabel })
      updated += 1
    }
  }
  return { models: Array.from(byId.values()), added, updated }
}
