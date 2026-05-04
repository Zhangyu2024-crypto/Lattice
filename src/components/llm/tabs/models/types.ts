import type {
  LLMModel,
  LLMProvider,
  LLMProviderType,
} from '../../../../types/llm'
import type { LlmListedModelPayload } from '../../../../types/electron'

// ─── Shared helpers ─────────────────────────────────────────────────────

export const isBuiltIn = (id: string): boolean =>
  id.startsWith('anthropic-default') || id.startsWith('openai-default')

export const PROVIDER_TYPE_OPTIONS: Array<{
  value: LLMProviderType
  label: string
}> = [
  { value: 'openai-compatible', label: 'OpenAI-compatible (default)' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
]

export const DEFAULT_BASE_URL: Record<LLMProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'openai-compatible': '',
  ollama: 'http://localhost:11434',
  custom: '',
}

// Providers whose key+endpoint combo can be validated by calling
// `GET /v1/models`. All currently supported types fit this surface; the set
// stays a named constant so ollama/custom can be added without hunting the
// disable logic down the file.
export const CONNECTABLE_TYPES: ReadonlySet<LLMProviderType> = new Set([
  'anthropic',
  'openai',
  'openai-compatible',
])

export type ConnectStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | {
      state: 'ok'
      durationMs: number
      fetched: number
      added: number
      updated: number
    }
  | { state: 'error'; message: string; status?: number }

export const CONNECT_IDLE: ConnectStatus = { state: 'idle' }

// Catalogue responses have no pricing/capability signal — use the same
// conservative defaults the manual form used. Users can still edit pricing
// later (future UI) or work from the label shown in the dropdown.
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

export interface MergeOutcome {
  models: LLMModel[]
  added: number
  updated: number
}

// Union-by-id merge: keep user-edited entries, refresh labels only when the
// local label is still the raw id (i.e. user hasn't touched it), append
// unknown ids. Full rationale was in the original implementation — kept here
// because the invariant (never lose user-customised pricing) is non-obvious.
export const mergeFetchedModels = (
  existing: LLMModel[],
  fetched: LlmListedModelPayload[],
  providerType: LLMProviderType,
): MergeOutcome => {
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

export const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n))

export const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`

export interface ModelOption {
  key: string
  providerId: string
  modelId: string
  modelLabel: string
  providerDisabled: boolean
}

export interface ProviderGroup {
  providerId: string
  providerName: string
  disabled: boolean
  models: ModelOption[]
}

export const buildProviderGroups = (providers: LLMProvider[]): ProviderGroup[] =>
  providers.map((p) => ({
    providerId: p.id,
    providerName: p.name,
    disabled: !p.enabled,
    models: p.models.map((m) => ({
      key: `${p.id}::${m.id}`,
      providerId: p.id,
      modelId: m.id,
      modelLabel: m.label,
      providerDisabled: !p.enabled,
    })),
  }))

export function parseModelOptionKey(
  val: string,
): { providerId: string; modelId: string } | null {
  const i = val.indexOf('::')
  if (i <= 0) return null
  const providerId = val.slice(0, i)
  const modelId = val.slice(i + 2)
  if (!providerId || !modelId) return null
  return { providerId, modelId }
}

export function formatAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  return `${day}d`
}
