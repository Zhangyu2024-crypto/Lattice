import type { LLMPricing } from '../types/llm'

// Heuristic token estimator — free of any tokenizer dependency. Works
// reasonably for mixed English/Chinese text which is the dominant input
// shape for Lattice (materials-science queries + Chinese user comments).
//
// Rationale for the constants:
// - ASCII: ~4 chars per token (OpenAI/Anthropic tokenizers average ~3.5-4.5
//   for English prose).
// - CJK / Hiragana / Katakana / Hangul: ~1.5 chars per token (each glyph
//   typically decomposes into 1-2 BPE tokens, averaging ~0.66 tokens/char).
// - Whitespace and punctuation fall in the ASCII bucket.
//
// This estimator is intentionally pessimistic-ish (slightly overcounts for
// mixed text) because it feeds the budget guard — it is better to refuse
// one more call than to accidentally overshoot a hard cost cap.
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let ascii = 0
  // for..of iterates by Unicode code points, not UTF-16 code units, so
  // surrogate pairs (e.g. CJK extension B) are counted as a single glyph.
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af)    // Hangul syllables
    ) {
      cjk++
    } else {
      ascii++
    }
  }
  return Math.ceil(ascii / 4 + cjk / 1.5)
}

/**
 * Sum a batch of mention context-block token estimates, defensively filtering
 * out `NaN`, `Infinity`, and negative values so a single malformed block
 * cannot poison the per-request budget calculation. Returns a non-negative
 * integer.
 *
 * Used by `sendLlmChat` to compute `contextBlocksTokens` before deciding how
 * much of the message history still fits under `budget.perRequest.maxInputTokens`.
 */
export function estimateMentionsBudget(
  blocks: ReadonlyArray<{ tokenEstimate: number }>,
): number {
  let total = 0
  for (const b of blocks) {
    const n = b.tokenEstimate
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    total += n
  }
  return Math.ceil(total)
}

// Compute USD cost for a single call given token counts and a model's
// pricing sheet. Cache-related token fields are optional because only some
// providers (Anthropic) bill them separately — for OpenAI/custom models the
// caller just passes zeros and the cache branches short-circuit.
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  pricing: LLMPricing,
  cacheReadTokens = 0,
  cacheCreateTokens = 0,
): number {
  const inputCost = (inputTokens * pricing.inputPerMillion) / 1_000_000
  const outputCost = (outputTokens * pricing.outputPerMillion) / 1_000_000
  const cacheReadCost = pricing.cacheReadPerMillion
    ? (cacheReadTokens * pricing.cacheReadPerMillion) / 1_000_000
    : 0
  const cacheCreateCost = pricing.cacheCreatePerMillion
    ? (cacheCreateTokens * pricing.cacheCreatePerMillion) / 1_000_000
    : 0
  return inputCost + outputCost + cacheReadCost + cacheCreateCost
}
