// Context-window accounting and token-warning thresholds.
//
// Port of claude-code-main / services/compact/autoCompact.ts constants +
// `calculateTokenWarningState`, adapted to Lattice's single-session model
// shape. Used by the StatusBar context chip so the user sees how close
// the active session is to the model's window before hitting a hard 400.
//
// The buffers are intentionally identical to upstream — Anthropic picked
// them so that microcompact + autocompact have room to operate before a
// request is genuinely blocked. We don't yet run autocompact; the buffer
// still serves as a yellow/red gradient for the chip.

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 10_000

export type TokenWarningLevel = 'ok' | 'warn' | 'critical'

export interface TokenWarningState {
  /** Whole-percent of the usable window that is still free. 0 means the
   *  request is at or past the hard limit. */
  percentLeft: number
  /** Whole-percent of the usable window that is currently used. */
  percentUsed: number
  level: TokenWarningLevel
  /** Usable window after the autocompact buffer is subtracted. */
  threshold: number
}

/** Window the UI should treat as "usable" after reserving the autocompact
 *  buffer. A 200k model still reports 200k as its nominal contextWindow in
 *  `LLMModel`; past 187k we want the chip red because the buffer is
 *  effectively the application-level ceiling. */
export function getEffectiveContextWindowSize(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0
  return Math.max(1, contextWindow - AUTOCOMPACT_BUFFER_TOKENS)
}

/**
 * Classify the current input-token usage against the usable window.
 * `warn` fires when there are fewer than ~20k tokens left; `critical` is
 * the last ~10k — the user is about to overflow and should either compact
 * the session or start a new one.
 */
export function calculateTokenWarningState(
  tokenUsage: number,
  contextWindow: number,
): TokenWarningState {
  const threshold = getEffectiveContextWindowSize(contextWindow)
  if (threshold === 0) {
    return { percentLeft: 100, percentUsed: 0, level: 'ok', threshold: 0 }
  }
  const used = Math.max(0, Math.min(tokenUsage, threshold))
  const percentUsed = Math.round((used / threshold) * 100)
  const percentLeft = Math.max(0, 100 - percentUsed)

  const warningAt = threshold - WARNING_THRESHOLD_BUFFER_TOKENS
  const errorAt = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  let level: TokenWarningLevel = 'ok'
  if (used >= errorAt) level = 'critical'
  else if (used >= warningAt) level = 'warn'

  return { percentLeft, percentUsed, level, threshold }
}
