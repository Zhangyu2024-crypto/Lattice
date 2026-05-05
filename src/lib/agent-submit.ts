// Agent/dialog prompt submission — the central "user sends a chat message" path.
//
// Dialog mode: Electron IPC (`llm-chat.ts` → `llm:invoke`).
//
// Agent mode (two transports):
//   • **Self-contained** (default): local `runAgentTurn` +
//     `LOCAL_TOOL_CATALOG`, with LLM calls through Electron IPC. This is the
//     normal Lattice-app path and does not require lattice-cli.
//   • **Legacy lattice-cli backend** (opt-in): when
//     `VITE_LATTICE_BACKEND_AGENT=1` and `backend.ready`, POST
//     `/api/chat/send` and follow progress via WebSocket.
//
// MP-2 (docs/CHAT_PANEL_REDESIGN.md §6.4): the caller may attach an
// `AgentSubmitCtx.mentions` list; it flows into both the user transcript
// entry (so the UI can re-render chips) and the LLM request (so the model
// sees resolved context blocks). The per-request token budget is estimated
// up-front so users hit the warn/block guard before the network call, not
// after.

import { toast } from '../stores/toast-store'
import { useLLMConfigStore } from '../stores/llm-config-store'
import { usePrefsStore } from '../stores/prefs-store'
import { useRuntimeStore } from '../stores/runtime-store'
import { estimateTokens } from './token-estimator'
import { sendLlmChat } from './llm-chat'
import { runAgentTurn } from './agent-orchestrator'
import { LOCAL_TOOL_CATALOG } from './agent-tools'
import {
  latticeBackendAgentPreferred,
  submitLatticeBackendAgentTurn,
} from './lattice-backend-agent'
import type { ComposerMode } from '../types/llm'
import type { MentionRef } from '../types/mention'
import type { TranscriptMessage } from '../types/session'

export interface AgentSubmitCtx {
  sessionId: string
  /** Recent transcript for LLM context — the caller reads this from
   *  `session.transcript`. */
  transcript: TranscriptMessage[]
  /**
   * Mentions attached to this submit. `anchor` must match a
   * `@[label#anchor](mention://…)` token that already appears in the user
   * message text (composer guarantees this). Safe to omit for legacy
   * callers that don't yet surface mentions.
   */
  mentions?: Array<{ anchor: string; ref: MentionRef }>
  /**
   * Optional cancellation signal — propagated to the orchestrator in Agent
   * mode so a long tool chain can be aborted without leaving a thinking
   * placeholder dangling. Dialog mode currently ignores it (the single-
   * shot LLM call is short-lived and the IPC timeout is the backstop).
   */
  signal?: AbortSignal
  /**
   * Raise the agent-loop iteration ceiling for this submit only. Default
   * behaviour (omitted) uses the orchestrator's built-in absolute ceiling.
   * Long workflows can set a higher per-request budget, but should still
   * prefer resumable tools over one outer agent turn per work item.
   */
  maxIterations?: number
  /**
   * Optional pasted / picked images (base64 without `data:` prefix). Only
   * honored when `window.electronAPI.llmInvoke` is available; the optional
   * legacy backend agent path skips vision and is not used for these turns.
   */
  images?: ReadonlyArray<{ base64: string; mediaType: string }>
  /**
   * When set, this is the text shown in the transcript as the user's
   * message instead of the full `text` argument. The LLM still receives
   * `text`, which may be a longer scaffold or expanded command prompt.
   */
  displayText?: string
  /**
   * Per-request model override. Honored end-to-end through
   * `runAgentTurn` → `sendLlmChat`. See `src/lib/model-routing/` for the
   * precedence rules.
   */
  modelBindingOverride?: import('./model-routing').ModelBinding
}

/**
 * Rough per-mention input-token reservation used by the up-front budget
 * guard. These are lower than the real {@link MENTION_BUDGET} ceilings in
 * `llm-chat.ts` on purpose: the guard only needs to estimate how much the
 * user's turn is likely to consume; the serialiser is the single source of
 * truth for the actual payload. Keep these in sync (directionally) with
 * any change to `MENTION_BUDGET`.
 */
const REQUEST_MENTION_GUARD_TOKENS: Readonly<Record<MentionRef['type'], number>> = {
  artifact: 1024,
  'artifact-element': 512,
  file: 64,
  'pdf-quote': 128,
}

/**
 * Submit a user message, call the LLM, and append the response to the
 * session transcript. Resolves to `true` once an assistant reply has been
 * persisted, `false` for any path that left the user without a real reply
 * (budget block, IPC error, provider error). Callers may use the return
 * value to decide whether to clear their input draft.
 *
 * The caller keeps `isLoading = true` until this promise resolves.
 */
export async function submitAgentPrompt(
  text: string,
  ctx: AgentSubmitCtx,
): Promise<boolean> {
  const trimmed = text.trim()
  const hasImages = Boolean(ctx.images?.length)
  if (!trimmed && !hasImages) return false
  if (
    hasImages &&
    typeof window !== 'undefined' &&
    !window.electronAPI?.llmInvoke
  ) {
    toast.error(
      'Images require the desktop app with a configured local connection.',
    )
    return false
  }

  const rawMode = usePrefsStore.getState().composerMode
  const mode: ComposerMode = rawMode === 'dialog' ? 'agent' : rawMode
  const store = useRuntimeStore.getState()
  const mentions = ctx.mentions

  // ── Budget gate ──────────────────────────────────────────────
  //
  // We estimate the full request cost (system prompt + history + user +
  // mention reservation) before any network / IPC work so a user over
  // budget gets told immediately, without a spinner flash.
  const estimatedInputTokens = estimateRequestInputTokens(
    mode,
    ctx.transcript,
    trimmed,
    mentions,
    ctx.images,
  )
  const decision = checkBudget(estimatedInputTokens)
  if (!decision.allow) {
    toast.error(`Blocked: ${decision.reason ?? 'Request exceeds budget'}`)
    return false
  }
  if (decision.warn && decision.reason) {
    toast.warn(decision.reason)
  }

  const now = Date.now()

  // The mentions attached to *this* turn are mirrored onto both transcript
  // entries: the user message uses them so the chip bar renders correctly,
  // and the assistant placeholder/result inherits them so any
  // `@[label#anchor]` the model echoes resolves back to a clickable chip
  // (per docs/CHAT_PANEL_REDESIGN.md §6.4: the model can only sensibly
  // echo anchors that the user attached this turn).
  const mentionsField =
    mentions && mentions.length > 0 ? { mentions } : {}
  const imagesField =
    hasImages && ctx.images
      ? {
          attachedImages: ctx.images.map(({ mediaType, base64 }) => ({
            mediaType,
            base64,
          })),
        }
      : {}

  // ── Append user message ──────────────────────────────────────
  // `displayText` is the short label the user typed / sees; `trimmed`
  // is the full text fed to the LLM. They diverge for expanded prompts.
  const visibleUserText = ctx.displayText?.trim() || trimmed
  store.appendTranscript(ctx.sessionId, {
    id: `user_${now}`,
    role: 'user',
    content: visibleUserText,
    timestamp: now,
    ...mentionsField,
    ...imagesField,
  })

  // ── Insert a "thinking" placeholder (local / dialog only) ───
  //
  // When the lattice Python backend runs the agent, the assistant row is
  // created from WebSocket `chat_message` frames — a local empty bubble
  // would duplicate the streaming reply until `task_end`.
  const useLatticeBackendAgent =
    mode === 'agent' && latticeBackendAgentPreferred() && !hasImages
  let assistantPlaceholderId: string | null = null
  if (!useLatticeBackendAgent) {
    assistantPlaceholderId = `thinking_${now}_${Math.random()
      .toString(36)
      .slice(2, 6)}`
    store.appendTranscript(ctx.sessionId, {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      timestamp: now,
      ...mentionsField,
    })
  }

  // ── Agent mode: multi-turn orchestrator ─────────────────────
  //
  // Agent mode runs the local orchestrator so any `tool_use` blocks from
  // the model are executed locally and the results are fed back for the
  // next iteration. Dialog mode stays single-shot — no tools, no loop —
  // which is the design-doc §7.1 guarantee.
  if (mode === 'agent') {
    if (useLatticeBackendAgent) {
      const backendResult = await submitLatticeBackendAgentTurn({
        text: trimmed,
        sessionId: ctx.sessionId,
        mentions,
        signal: ctx.signal,
      })
      if (backendResult.ok) {
        return true
      }
      const err = backendResult.error ?? 'Lattice backend agent failed.'
      store.appendTranscript(ctx.sessionId, {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: Date.now(),
        ...mentionsField,
      })
      toast.error(err)
      return false
    }

    let streamed = ''
    const agentResult = await runAgentTurn({
      sessionId: ctx.sessionId,
      userMessage: trimmed,
      images: hasImages ? ctx.images : undefined,
      mentions,
      transcript: ctx.transcript,
      tools: LOCAL_TOOL_CATALOG,
      rootMessageId: assistantPlaceholderId!,
      signal: ctx.signal,
      maxIterations: ctx.maxIterations,
      modelBindingOverride: ctx.modelBindingOverride,
      onStreamAppend: (delta) => {
        streamed += delta
        store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
          content: streamed,
          timestamp: Date.now(),
          status: 'streaming',
        })
      },
    })
    if (agentResult.success) {
      store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
        content: agentResult.finalText || streamed,
        timestamp: Date.now(),
        status: 'complete',
        ...(agentResult.thinkingContent ? { thinking: agentResult.thinkingContent } : {}),
      })
      return true
    }
    const err = agentResult.error ?? 'Agent orchestration failed.'
    store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
      content: ctx.signal?.aborted ? (streamed || 'Cancelled.') : `Error: ${err}`,
      timestamp: Date.now(),
      status: 'complete',
    })
    if (!ctx.signal?.aborted) toast.error(err)
    return false
  }

  // ── Dialog mode: single-shot LLM call (streams when available) ──
  let dialogStreamed = ''
  const result = await sendLlmChat({
    mode,
    userMessage: trimmed,
    transcript: ctx.transcript,
    sessionId: ctx.sessionId,
    mentions,
    images: hasImages ? ctx.images : undefined,
    modelBindingOverride: ctx.modelBindingOverride,
    signal: ctx.signal,
    onTextDelta: (delta) => {
      dialogStreamed += delta
      store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
        content: dialogStreamed,
        timestamp: Date.now(),
        status: 'streaming',
      })
    },
  })

  if (result.success) {
    // Replace the thinking placeholder with the real response. Mentions
    // were already seeded above, so the bubble's chip lookup works even
    // when only `content` is patched.
    store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
      content: result.content,
      timestamp: Date.now(),
      status: 'complete',
      ...(result.thinkingContent ? { thinking: result.thinkingContent } : {}),
    })
    return true
  }

  // Replace the thinking placeholder with an error message.
  const errMsg = result.error ?? 'LLM call failed with no error message.'
  store.updateTranscriptMessage(ctx.sessionId, assistantPlaceholderId!, {
    content: ctx.signal?.aborted ? (dialogStreamed || 'Cancelled.') : `Error: ${errMsg}`,
    timestamp: Date.now(),
    status: 'complete',
  })
  if (!ctx.signal?.aborted) toast.error(errMsg)
  return false
}

// ── Budget check ──────────────────────────────────────────────────

interface BudgetDecision {
  allow: boolean
  warn: boolean
  reason?: string
}

/**
 * Produce a rough input-token estimate for the request we're about to send.
 * The serialiser in `llm-chat.ts` computes the authoritative number; this
 * function only needs to decide whether to warn / block before that work
 * starts. Mentions are reserved at a conservative per-type amount
 * ({@link REQUEST_MENTION_GUARD_TOKENS}); the real payload may be smaller
 * (short previews) or clipped to fit (large artifacts).
 */
function estimateRequestInputTokens(
  mode: ComposerMode,
  transcript: ReadonlyArray<TranscriptMessage>,
  userMessage: string,
  mentions: ReadonlyArray<{ ref: MentionRef }> | undefined,
  images?: ReadonlyArray<{ base64: string }>,
): number {
  const config = useLLMConfigStore.getState()
  const genCfg = mode === 'dialog' ? config.dialog : config.agent
  let total = estimateTokens(genCfg.systemPrompt || '')
  for (const msg of transcript) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    total += estimateTokens(msg.content)
    if (msg.role === 'user' && msg.attachedImages?.length) {
      for (const img of msg.attachedImages) {
        const bytes = Math.floor((img.base64.length * 3) / 4)
        total += Math.max(768, Math.ceil(bytes / 2048) * 400)
      }
    }
  }
  total += estimateTokens(userMessage)
  if (mentions) {
    for (const { ref } of mentions) {
      total += REQUEST_MENTION_GUARD_TOKENS[ref.type] ?? 0
    }
  }
  if (images) {
    for (const img of images) {
      const bytes = Math.floor((img.base64.length * 3) / 4)
      total += Math.max(768, Math.ceil(bytes / 2048) * 400)
    }
  }
  return total
}

/**
 * Two-layer budget guard:
 *
 *   1. Per-request: block (or warn, depending on `budget.mode`) when the
 *      estimated input tokens exceed `budget.perRequest.maxInputTokens`.
 *      This catches "accidentally @-mentioned a 50 KB artifact" before the
 *      provider ever sees the payload.
 *   2. Daily cumulative: the original behaviour — warn at `warnAtPct`,
 *      warn-or-block at 100% depending on `budget.mode`.
 */
function checkBudget(estimatedInputTokens: number): BudgetDecision {
  const config = useLLMConfigStore.getState()
  const { budget } = config

  // ── Per-request ceiling ──────────────────────────────────────
  const perRequestLimit = budget.perRequest.maxInputTokens
  if (perRequestLimit > 0 && estimatedInputTokens > perRequestLimit) {
    const reason = `Estimated ${estimatedInputTokens.toLocaleString()} input tokens exceeds per-request limit of ${perRequestLimit.toLocaleString()}.`
    if (budget.mode === 'block') {
      return { allow: false, warn: true, reason }
    }
    // warn mode: allow but nudge.
    return { allow: true, warn: true, reason }
  }

  // ── Daily cumulative ─────────────────────────────────────────
  let today: { inputTokens: number; outputTokens: number; costUSD: number }
  try {
    const { useUsageStore } = require('../stores/usage-store')
    today = useUsageStore.getState().getTodayTotals()
  } catch {
    return { allow: true, warn: false }
  }

  const tokenTotal = today.inputTokens + today.outputTokens
  const tokenLimit = budget.daily.tokenLimit
  const costLimit = budget.daily.costLimitUSD

  const tokenPct = tokenLimit ? tokenTotal / tokenLimit : 0
  const costPct = costLimit ? today.costUSD / costLimit : 0
  const maxPct = Math.max(tokenPct, costPct)

  if (maxPct >= 1) {
    if (budget.mode === 'block') {
      return {
        allow: false,
        warn: true,
        reason:
          tokenPct >= 1
            ? `Daily token budget exceeded (${tokenTotal.toLocaleString()} / ${(tokenLimit ?? 0).toLocaleString()})`
            : `Daily cost budget exceeded ($${today.costUSD.toFixed(2)} / $${(costLimit ?? 0).toFixed(2)})`,
      }
    }
    return { allow: true, warn: true, reason: 'Daily budget 100% reached' }
  }
  if (maxPct >= budget.warnAtPct) {
    return {
      allow: true,
      warn: true,
      reason: `Daily budget ${Math.round(maxPct * 100)}% used`,
    }
  }
  return { allow: true, warn: false }
}
