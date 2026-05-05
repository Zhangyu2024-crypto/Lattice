import { ipcMain } from 'electron'
import {
  invoke,
  listModels,
  testConnection,
  type LlmInvokeRequest,
  type LlmInvokeResult,
  type LlmListModelsRequest,
  type LlmListModelsResult,
  type LlmTestConnectionRequest,
  type LlmTestConnectionResult,
} from './llm-proxy'
import {
  startStream,
  abortStream,
  type StreamStartResult,
} from './llm-stream'
import {
  recordApiCall,
  summarizeErrorForAudit,
  summarizeForAudit,
} from './api-call-audit'

// Basic shape guard — the renderer is trusted (single-origin) but we still
// narrow the payload so a malformed caller gets a structured error instead
// of crashing the main process.
function isValidRequest(v: unknown): v is LlmInvokeRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.provider === 'string' &&
    typeof r.apiKey === 'string' &&
    typeof r.baseUrl === 'string' &&
    typeof r.model === 'string' &&
    Array.isArray(r.messages) &&
    typeof r.maxTokens === 'number' &&
    typeof r.temperature === 'number'
  )
}

function isValidTestRequest(v: unknown): v is LlmTestConnectionRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.provider === 'string' &&
    typeof r.apiKey === 'string' &&
    typeof r.baseUrl === 'string'
  )
}

// The list-models payload mirrors the test-connection shape (provider + key
// + base url), so we reuse the same narrow guard but expose a separate name
// to keep call sites self-documenting.
function isValidListModelsRequest(v: unknown): v is LlmListModelsRequest {
  return isValidTestRequest(v as LlmTestConnectionRequest)
}

function summarizeLlmRequest(req: LlmInvokeRequest): Record<string, unknown> {
  return {
    provider: req.provider,
    baseUrl: req.baseUrl,
    model: req.model,
    mode: req.mode ?? 'dialog',
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    timeoutMs: req.timeoutMs,
    reasoningEffort: req.reasoningEffort,
    messageCount: req.messages.length,
    contextBlockCount: req.contextBlocks?.length ?? 0,
    contextBlockTokens: req.contextBlocks?.reduce(
      (sum, block) => sum + (Number.isFinite(block.tokenEstimate) ? block.tokenEstimate : 0),
      0,
    ),
    toolCount: req.tools?.length ?? 0,
    tools: req.tools?.map((tool) => tool.name).slice(0, 120),
  }
}

function summarizeLlmResult(result: LlmInvokeResult): Record<string, unknown> {
  if (!result.success) {
    return {
      success: false,
      status: result.status,
      durationMs: result.durationMs,
      error: result.error,
    }
  }
  return {
    success: true,
    durationMs: result.durationMs,
    contentChars: result.content.length,
    usage: result.usage,
    toolCalls: result.toolCalls?.map((call) => call.name),
    toolCallCount: result.toolCalls?.length ?? 0,
    messageCount: result.messages?.length ?? 0,
    thinkingChars: result.thinkingContent?.length ?? 0,
  }
}

function recordLlmInvoke(req: LlmInvokeRequest, result: LlmInvokeResult): void {
  const audit = req.audit
  recordApiCall({
    kind: 'llm.invoke',
    source: audit?.source ?? (req.mode === 'agent' ? 'agent' : 'dialog'),
    operation: `${req.provider}:${req.model}`,
    status: result.success ? 'ok' : 'error',
    durationMs: result.durationMs,
    sessionId: audit?.sessionId,
    taskId: audit?.taskId,
    stepId: audit?.stepId,
    workspaceRoot: audit?.workspaceRoot,
    request: summarizeLlmRequest(req),
    response: summarizeLlmResult(result),
    error: result.success ? undefined : result.error,
    meta: audit?.metadata,
  })
}

function summarizeProviderProbe(
  req: LlmTestConnectionRequest | LlmListModelsRequest,
): Record<string, unknown> {
  return {
    provider: req.provider,
    baseUrl: req.baseUrl,
    timeoutMs: req.timeoutMs,
  }
}

export function registerLlmIpc(): void {
  ipcMain.handle('llm:invoke', async (_event, req: unknown): Promise<LlmInvokeResult> => {
    if (!isValidRequest(req)) {
      return {
        success: false,
        error: 'Invalid LLM invoke request payload',
        durationMs: 0,
      }
    }
    const result = await invoke(req)
    recordLlmInvoke(req, result)
    return result
  })

  ipcMain.handle(
    'llm:test-connection',
    async (_event, req: unknown): Promise<LlmTestConnectionResult> => {
      if (!isValidTestRequest(req)) {
        return {
          success: false,
          error: 'Invalid test-connection request payload',
          durationMs: 0,
        }
      }
      const result = await testConnection(req)
      recordApiCall({
        kind: 'llm.test_connection',
        source: 'llm-settings',
        operation: req.provider,
        status: result.success ? 'ok' : 'error',
        durationMs: result.durationMs,
        request: summarizeProviderProbe(req),
        response: summarizeForAudit(result),
        error: result.success ? undefined : result.error,
      })
      return result
    },
  )

  ipcMain.handle(
    'llm:list-models',
    async (_event, req: unknown): Promise<LlmListModelsResult> => {
      if (!isValidListModelsRequest(req)) {
        return {
          success: false,
          error: 'Invalid list-models request payload',
          durationMs: 0,
        }
      }
      const result = await listModels(req)
      recordApiCall({
        kind: 'llm.list_models',
        source: 'llm-settings',
        operation: req.provider,
        status: result.success ? 'ok' : 'error',
        durationMs: result.durationMs,
        request: summarizeProviderProbe(req),
        response: result.success
          ? { modelCount: result.models.length, models: result.models.slice(0, 100) }
          : summarizeForAudit(result),
        error: result.success ? undefined : result.error,
      })
      return result
    },
  )

  ipcMain.handle(
    'llm:stream-start',
    (event, req: unknown): StreamStartResult => {
      if (!isValidRequest(req)) {
        return { ok: false, error: 'Invalid LLM stream request payload' }
      }
      const startedAt = Date.now()
      try {
        const result = startStream(req, event.sender)
        recordApiCall({
          kind: 'llm.stream_start',
          source: req.audit?.source ?? 'agent',
          operation: `${req.provider}:${req.model}`,
          status: result.ok ? 'accepted' : 'error',
          durationMs: Date.now() - startedAt,
          sessionId: req.audit?.sessionId,
          taskId: req.audit?.taskId,
          stepId: req.audit?.stepId,
          workspaceRoot: req.audit?.workspaceRoot,
          request: summarizeLlmRequest(req),
          response: result,
          error: result.ok ? undefined : result.error,
          meta: req.audit?.metadata,
        })
        return result
      } catch (err) {
        recordApiCall({
          kind: 'llm.stream_start',
          source: req.audit?.source ?? 'agent',
          operation: `${req.provider}:${req.model}`,
          status: 'error',
          durationMs: Date.now() - startedAt,
          sessionId: req.audit?.sessionId,
          taskId: req.audit?.taskId,
          stepId: req.audit?.stepId,
          workspaceRoot: req.audit?.workspaceRoot,
          request: summarizeLlmRequest(req),
          error: summarizeErrorForAudit(err),
          meta: req.audit?.metadata,
        })
        throw err
      }
    },
  )

  ipcMain.handle(
    'llm:stream-abort',
    (_event, streamId: unknown): void => {
      if (typeof streamId === 'string') {
        abortStream(streamId)
      }
    },
  )
}
