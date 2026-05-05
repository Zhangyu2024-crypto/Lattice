import type {
  LLMModel,
  LLMProvider,
  LLMProviderType,
} from '../../../../types/llm'
import { publicProviderModelLabel } from '../../../../lib/model-display'
export { mergeFetchedModels } from '../../../../lib/llm-model-catalog'

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
      removed: number
    }
  | { state: 'error'; message: string; status?: number }

export const CONNECT_IDLE: ConnectStatus = { state: 'idle' }

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
      modelLabel: publicProviderModelLabel(p, m),
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
