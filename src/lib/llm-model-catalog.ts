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
  removed: number
}

const preserveLocalModelSettings = (
  serverModel: LLMModel,
  localModel: LLMModel,
): LLMModel => ({
  ...serverModel,
  contextWindow: localModel.contextWindow,
  maxOutputTokens: localModel.maxOutputTokens,
  pricing: { ...localModel.pricing },
  supportsTools: localModel.supportsTools,
  supportsVision: localModel.supportsVision,
  supportsCaching: localModel.supportsCaching,
  description: localModel.description,
})

// Server-authoritative sync by id: fetched ids define the next catalog.
// Local rows that disappeared upstream are removed, while surviving rows keep
// user-edited pricing/capability settings.
export const mergeFetchedModels = (
  existing: LLMModel[],
  fetched: LlmListedModelPayload[],
  providerType: LLMProviderType,
): MergeFetchedModelsOutcome => {
  const localById = new Map<string, LLMModel>(existing.map((m) => [m.id, m]))
  const fetchedIds = new Set<string>()
  const models: LLMModel[] = []
  let added = 0
  let updated = 0
  for (const entry of fetched) {
    if (fetchedIds.has(entry.id)) continue
    fetchedIds.add(entry.id)
    const serverModel = buildDefaultModelFromCatalogue(entry, providerType)
    const current = localById.get(entry.id)
    if (!current) {
      models.push(serverModel)
      added += 1
      continue
    }
    if (current.label !== serverModel.label) {
      updated += 1
    }
    models.push(preserveLocalModelSettings(serverModel, current))
  }
  return {
    models,
    added,
    updated,
    removed: existing.filter((m) => !fetchedIds.has(m.id)).length,
  }
}
