// Unified LLM chat invocation for the Lattice Electron app.
//
// Resolves the active provider + model from `llm-config-store` (respecting
// dialog vs agent mode), serialises @-mention context blocks via the
// session-store mention resolver, builds a token-budgeted messages array
// from the session transcript, and dispatches via the Electron IPC
// `llm:invoke` proxy.
//
// MP-2 (docs/CHAT_PANEL_REDESIGN.md §6.4): mentions become a first-class
// part of every outgoing prompt. Sensitive providers can opt into a
// `'block'` policy that swaps the mention body for a redacted placeholder
// before it ever leaves the renderer.
//
// This replaces the broken `sendChat -> REST /api/chat/send -> dead queue`
// pipeline. The IPC path (`electron/llm-proxy.ts`) is proven — it's the same
// route used by `invokeLlmForCif` in `src/lib/llm-client.ts`.
//
// Implementation is split across `src/lib/llm-chat/` so this file stays a
// thin dispatcher — see the sibling modules for message shaping, mention
// serialisation, token-budgeted history trimming, and usage recording.

import {
  getUnresolvedModelMessage,
  useLLMConfigStore,
} from '../stores/llm-config-store'
import { useRuntimeStore } from '../stores/runtime-store'
import { computeCost } from './token-estimator'
import { maybeMicrocompactMessages } from './agent-compact'
import { sendLlmStream } from './llm-stream-client'
import { log } from './logger'
import type {
  LlmInvokeRequestPayload,
  LlmInvokeResultPayload,
  LlmMessagePayload,
} from '../types/electron'
import type {
  LLMModel,
  LLMProvider,
  MentionResolvePolicy,
} from '../types/llm'
import { TIMEOUT_AGENT, TIMEOUT_DIALOG } from './llm-chat/constants'
import { buildContextBlocks } from './llm-chat/mentions'
import {
  transcriptToLlmMessages,
  userMessagePayload,
} from './llm-chat/messages'
import { assembleLlmContext } from './context-management/assembler'
import { recordUsage } from './llm-chat/usage'
import type { LlmChatRequest, LlmChatResult } from './llm-chat/types'
import {
  createLatticeTraceId,
  sha256Hex,
} from './lattice-trace'
import {
  LATTICE_AUTH_API_KEY_REF,
  LATTICE_AUTH_PROVIDER_ID,
} from './lattice-auth-client'
import {
  getBrokenBindingMessage,
  isBindingBroken,
  resolveEffectiveBinding,
  useModelRouteStore,
} from './model-routing'
import { usePrefsStore } from '../stores/prefs-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { USER_AGREEMENT_VERSION } from './user-agreement'

// Re-export the public surface so existing callers (`./llm-chat`) keep
// importing from the same module path. See `./llm-chat/*` for the
// implementations.
export type { LlmChatRequest, LlmChatResult, ToolDefinitionLike } from './llm-chat/types'
export { userMessagePayload, transcriptToLlmMessages } from './llm-chat/messages'

/**
 * Call the LLM via the Electron IPC proxy. Returns the full response text.
 *
 * When `window.electronAPI` is not available (pure Vite dev mode), returns
 * a helpful error — the REST fallback is intentionally NOT used because
 * it's known broken in standalone mode.
 */
export async function sendLlmChat(
  req: LlmChatRequest,
): Promise<LlmChatResult> {
  const configState = useLLMConfigStore.getState()

  // Five-layer binding resolution (per-request > skill > session > mode
  // default). The session layer is read fresh from the route store here
  // so `/model` / `/fast` / `/effort` take effect on the next submit
  // without being threaded manually from the composer.
  const routeState = useModelRouteStore.getState()
  const modeCfg =
    req.mode === 'dialog' ? configState.dialog : configState.agent
  const effective = resolveEffectiveBinding({
    mode: req.mode,
    modeDefault: {
      providerId: modeCfg.providerId,
      modelId: modeCfg.modelId,
      reasoningEffort: modeCfg.reasoningEffort,
    },
    sessionOverride: routeState.override,
    perRequestOverride: req.modelBindingOverride,
  })

  let resolved: { provider: LLMProvider; model: LLMModel } | null = null
  if (effective.providerId && effective.modelId) {
    const p = configState.providers.find((x) => x.id === effective.providerId)
    const m = p?.models.find((x) => x.id === effective.modelId) ?? null
    if (p && m) resolved = { provider: p, model: m }
  }
  if (!resolved) {
    // Prefer the override-specific message when a session `/model` or
    // per-request override is what failed to resolve; generic
    // "default is broken" copy is confusing when the default would
    // actually work.
    const perReqBroken = isBindingBroken(
      req.modelBindingOverride,
      configState.providers,
    )
    const sessionBroken = isBindingBroken(
      routeState.override,
      configState.providers,
    )
    const firstBroken = perReqBroken.broken
      ? perReqBroken
      : sessionBroken.broken
        ? sessionBroken
        : null
    const msg = firstBroken
      ? getBrokenBindingMessage(firstBroken)
      : getUnresolvedModelMessage(configState, req.mode)
    log.error(msg, {
      source: 'llm',
      type: 'config',
      detail: {
        mode: req.mode,
        overrideBroken: Boolean(firstBroken),
        reason: firstBroken?.reason,
      },
    })
    return {
      success: false,
      content: '',
      error: msg,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }
  const { provider, model } = resolved
  if (req.mode === 'agent' && req.tools && req.tools.length > 0 && !model.supportsTools) {
    const compatibilityHint =
      provider.type === 'openai-compatible'
        ? ' Many OpenAI-compatible endpoints support plain chat but reject agent tool/function calls.'
        : ''
    return {
      success: false,
      content: '',
      error:
        `The selected model "${model.label}" on ${provider.name} is not configured for tool calls. ` +
        `Research/survey and other Agent workflows require tool/function support.${compatibilityHint} ` +
        'Pick a tool-capable route in Connection Settings.',
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }
  const apiKey = provider.apiKey?.trim()
  if (!apiKey) {
    const msg = `API key missing for ${provider.name}. Add it in Connection Settings.`
    log.error(msg, {
      source: 'llm',
      type: 'config',
      detail: { provider: provider.name, model: model.label, mode: req.mode },
    })
    return {
      success: false,
      content: '',
      error: msg,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }
  if (apiKey === LATTICE_AUTH_API_KEY_REF && provider.id !== LATTICE_AUTH_PROVIDER_ID) {
    const msg = 'The signed-in chaxiejun.xyz connection cannot be reused by another provider.'
    log.error(msg, {
      source: 'llm',
      type: 'config',
      detail: { provider: provider.name, model: model.label, mode: req.mode },
    })
    return {
      success: false,
      content: '',
      error: msg,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }
  if (!provider.enabled) {
    const msg = `Provider ${provider.name} is disabled. Enable it in Connection Settings.`
    log.error(msg, {
      source: 'llm',
      type: 'config',
      detail: { provider: provider.name, mode: req.mode },
    })
    return {
      success: false,
      content: '',
      error: msg,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }

  const electron = window.electronAPI
  if (!electron?.llmInvoke) {
    return {
      success: false,
      content: '',
      error:
        'Connection proxy not available. This feature requires the Electron desktop shell.',
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }

  // Build generation config from the mode-specific settings.
  const genCfg = req.mode === 'dialog' ? configState.dialog : configState.agent
  const timeoutMs = req.mode === 'dialog' ? TIMEOUT_DIALOG : TIMEOUT_AGENT

  // ── Mention context blocks ─────────────────────────────────────
  //
  // Treat absent/empty `mentions` as a non-event so older callers keep
  // working unchanged. The default policy ('confirm') preserves the prior
  // behaviour for trusted-but-unspecified providers; explicit 'block' is the
  // only branch that strips outgoing payloads.
  const mentions = req.mentions ?? []
  const policy: MentionResolvePolicy = provider.mentionResolve ?? 'confirm'
  const sessionState = useRuntimeStore.getState()
  const { blocks, labels } = buildContextBlocks(
    sessionState,
    mentions,
    policy,
  )

  // ── Token budgeting ────────────────────────────────────────────
  const systemPrompt = req.systemPromptOverride ?? genCfg.systemPrompt ?? ''

  // Single source of truth for the conversation this turn. If the caller
  // supplied `messages` (agent-orchestrator re-entry), that's the authority
  // and already includes `userMessage`. Otherwise we derive from the
  // transcript + userMessage tail, which is the MP-2 single-shot path.
  const rawSourceMessages: LlmMessagePayload[] =
    req.messages && req.messages.length > 0
      ? req.messages
      : [
          ...transcriptToLlmMessages(req.transcript),
          userMessagePayload(req.userMessage, req.images),
        ]

  // Microcompact: when the ephemeral message stream accumulates more than
  // MICROCOMPACT_KEEP_RECENT compactable tool_result blocks (long turns
  // where the agent chained several workspace / retrieval calls), clear
  // the content of the older ones so the next call doesn't pay the full
  // token cost for results the model has already reasoned about.
  const compacted = maybeMicrocompactMessages(rawSourceMessages)
  const sourceMessages = compacted.messages

  // The effective ceiling is the smaller of the user's per-request budget
  // and the model's context window — we never want to send more than the
  // model can actually accept, even if the user disabled the budget guard.
  const requestCeiling = Math.min(
    configState.budget.perRequest.maxInputTokens,
    model.contextWindow,
  )

  const assembledContext = assembleLlmContext({
    mode: req.mode,
    systemPrompt,
    contextBlocks: blocks,
    sourceMessages,
    tools: req.tools,
    requestCeiling,
  })

  const request: LlmInvokeRequestPayload = {
    provider: provider.type as LlmInvokeRequestPayload['provider'],
    apiKey,
    baseUrl: provider.baseUrl,
    model: model.id,
    systemPrompt: systemPrompt || undefined,
    messages: assembledContext.messages,
    maxTokens: genCfg.maxTokens,
    temperature: genCfg.temperature,
    timeoutMs,
    mode: req.mode,
    // Only attach contextBlocks when there's something to send; this keeps
    // the IPC payload identical to pre-MP-2 when the user did not @-mention
    // anything, simplifying provider-side debugging.
    ...(blocks.length > 0 ? { contextBlocks: blocks } : {}),
    ...(assembledContext.toolsForInvoke ? { tools: assembledContext.toolsForInvoke } : {}),
    // Extended thinking: pass the reasoning effort level so the main-process
    // SDK client can enable the `thinking` parameter when appropriate.
    ...(effective.reasoningEffort
      ? { reasoningEffort: effective.reasoningEffort }
      : {}),
  }

  const workspaceRootPath = useWorkspaceStore.getState().rootPath
  const acceptedConsent =
    usePrefsStore.getState().privacy.acceptedAgreementVersion ===
    USER_AGREEMENT_VERSION
  request.traceId = createLatticeTraceId()
  request.module =
    req.traceModule ?? (req.mode === 'agent' ? 'agent' : 'agent')
  request.operation = req.traceOperation ?? 'chat'
  request.sessionId = req.sessionId
  request.artifactId = req.artifactId ?? null
  request.consentVersion = acceptedConsent ? USER_AGREEMENT_VERSION : null
  request.workspaceIdHash = workspaceRootPath
    ? await sha256Hex(workspaceRootPath)
    : null

  // ── Transport selection ─────────────────────────────────────────
  //
  // Use the streaming IPC transport when all three conditions hold:
  //   1. The caller supplied an `onTextDelta` callback (wants streaming).
  //   2. The active provider is Anthropic (only provider with stream support).
  //   3. The Electron streaming bridge is available.
  // Otherwise fall through to the one-shot `llmInvoke` path — the result
  // shape (`LlmInvokeResultPayload`) is identical either way.
  const isOfficialAnthropic =
    provider.type === 'anthropic' &&
    /api\.anthropic\.com/i.test(provider.baseUrl)
  const useStreaming =
    Boolean(req.onTextDelta) &&
    isOfficialAnthropic &&
    Boolean(electron.llmStreamStart)

  let result: LlmInvokeResultPayload
  try {
    if (useStreaming) {
      result = await sendLlmStream(
        request,
        { onTextDelta: req.onTextDelta },
        req.signal,
      )
    } else {
      result = await abortableInvoke(electron.llmInvoke(request), req.signal)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.exception(err, {
      source: 'llm',
      detail: {
        provider: provider.name,
        model: model.label,
        mode: req.mode,
      },
      message: `IPC error: ${msg}`,
    })
    recordUsage({
      mode: req.mode,
      providerId: provider.id,
      modelId: model.id,
      sessionId: req.sessionId,
      snippet: req.userMessage.slice(0, 80),
      success: false,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      errorMessage: msg,
    })
    return {
      success: false,
      content: '',
      error: `IPC error: ${msg}`,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  }

  if (!result.success) {
    log.error(result.error, {
      source: 'llm',
      type: 'http',
      detail: {
        provider: provider.name,
        model: model.label,
        mode: req.mode,
        durationMs: result.durationMs,
      },
    })
    recordUsage({
      mode: req.mode,
      providerId: provider.id,
      modelId: model.id,
      sessionId: req.sessionId,
      snippet: req.userMessage.slice(0, 80),
      success: false,
      durationMs: result.durationMs,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      errorMessage: result.error,
    })
    return {
      success: false,
      content: '',
      error: result.error,
      durationMs: result.durationMs,
      inputTokens: 0,
      outputTokens: 0,
    }
  }

  const costUSD = computeCost(
    result.usage.inputTokens,
    result.usage.outputTokens,
    model.pricing,
  )
  recordUsage({
    mode: req.mode,
    providerId: provider.id,
    modelId: model.id,
    sessionId: req.sessionId,
    snippet: req.userMessage.slice(0, 80),
    success: true,
    durationMs: result.durationMs,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUSD,
  })

  return {
    success: true,
    content: result.content,
    durationMs: result.durationMs,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
    ...(result.messages ? { messages: result.messages } : {}),
    ...(result.thinkingContent ? { thinkingContent: result.thinkingContent } : {}),
  }
}

function abortableInvoke<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Cancelled'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(new Error('Cancelled'))
        else resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
