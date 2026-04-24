// Usage-store recording helper. Split from `llm-chat.ts` — pure code
// motion. The UsageRecord `id` and `timestamp` are filled in by
// `useUsageStore.recordCall`.

import { useUsageStore } from '../../stores/usage-store'
import type { ComposerMode, UsageRecord } from '../../types/llm'

export interface RecordParams {
  mode: ComposerMode
  providerId: string
  modelId: string
  sessionId: string | null
  snippet: string
  success: boolean
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUSD: number
  errorMessage?: string
}

export function recordUsage(p: RecordParams): void {
  const record: Omit<UsageRecord, 'id' | 'timestamp'> = {
    providerId: p.providerId,
    modelId: p.modelId,
    mode: p.mode,
    sessionId: p.sessionId,
    inputTokens: p.inputTokens,
    outputTokens: p.outputTokens,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    durationMs: p.durationMs,
    costUSD: p.costUSD,
    success: p.success,
    errorMessage: p.errorMessage,
    requestSnippet: p.snippet,
  }
  useUsageStore.getState().recordCall(record)
}
