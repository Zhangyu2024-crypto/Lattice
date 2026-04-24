export type ComposerMode = 'dialog' | 'agent'

/**
 * How the composer should handle mention payloads destined for this provider:
 * - `'allow'`   — resolve and send mention bodies as-is (trusted providers)
 * - `'confirm'` — prompt the user with a list of outgoing artifacts before sending
 * - `'block'`   — replace bodies with a redacted placeholder so no artifact
 *                 content ever leaves the app
 * See docs/CHAT_PANEL_REDESIGN.md §8.
 */
export type MentionResolvePolicy = 'allow' | 'confirm' | 'block'

export type LLMProviderType =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'ollama'
  | 'custom'

export interface LLMPricing {
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion?: number
  cacheCreatePerMillion?: number
}

export interface LLMModel {
  id: string // provider-side id, e.g. 'claude-opus-4-6'
  label: string
  contextWindow: number
  maxOutputTokens: number
  pricing: LLMPricing
  supportsTools: boolean
  supportsVision: boolean
  supportsCaching: boolean
  description?: string
}

export interface LLMProvider {
  id: string // internal id, e.g. 'anthropic-default'
  name: string
  type: LLMProviderType
  baseUrl: string
  apiKey?: string // MVP: plaintext in localStorage; later: Electron safeStorage ciphertext
  enabled: boolean
  /**
   * Mention-resolve policy for this provider. Optional for backward
   * compatibility with persisted v≤2 configs; the llm-config-store migrate
   * step infers a sensible default on rehydrate, and all new writes set it
   * explicitly.
   */
  mentionResolve?: MentionResolvePolicy
  models: LLMModel[]
}

export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface GenerationConfig {
  providerId: string | null
  modelId: string | null
  temperature: number
  maxTokens: number
  topP: number
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
}

export type BudgetMode = 'warn' | 'block'

export interface BudgetConfig {
  daily: {
    tokenLimit: number | null
    costLimitUSD: number | null
  }
  monthly: {
    tokenLimit: number | null
    costLimitUSD: number | null
  }
  perRequest: {
    maxInputTokens: number
    maxOutputTokens: number
  }
  warnAtPct: number // 0..1
  mode: BudgetMode
}

export interface RateLimitConfig {
  maxCallsPerMinute: number
  maxTokensPerRequest: number
  retryOn429: boolean
  exponentialBackoff: {
    enabled: boolean
    baseMs: number
    maxMs: number
  }
}

export interface UsageRecord {
  id: string
  timestamp: number
  providerId: string
  modelId: string
  mode: ComposerMode
  sessionId: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  durationMs: number
  costUSD: number
  success: boolean
  errorMessage?: string
  requestSnippet: string // first ~80 chars of user prompt
}

export interface UsageAggregate {
  calls: number
  inputTokens: number
  outputTokens: number
  costUSD: number
}

export interface UsageDailyBucket extends UsageAggregate {
  date: string // 'YYYY-MM-DD'
}

// Baseline pricing table (USD per 1M tokens). Users may override per model
// in the LLM Config modal; this is the out-of-box default.
export interface BuiltInModelSpec {
  providerType: LLMProviderType
  model: LLMModel
}
