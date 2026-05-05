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
  summarizePayloadForAudit,
  writeAuditEvent,
} from './audit-writer'
import {
  buildLatticeTraceContext,
  latticeTraceAuditMetadata,
} from './lattice-trace'

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

function summarizeMessages(messages: LlmInvokeRequest['messages']): unknown {
  return messages.map((message) => ({
    role: message.role,
    content: summarizePayloadForAudit(message.content),
  }))
}

function llmInvokeAuditMeta(req: LlmInvokeRequest): Record<string, unknown> {
  const trace = buildLatticeTraceContext(req)
  return {
    ...latticeTraceAuditMetadata(trace),
    provider: req.provider,
    baseUrl: req.baseUrl,
    model: req.model,
    mode: req.mode ?? 'dialog',
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    timeoutMs: req.timeoutMs,
    reasoningEffort: req.reasoningEffort,
    systemPrompt: req.systemPrompt
      ? summarizePayloadForAudit(req.systemPrompt)
      : undefined,
    messages: summarizeMessages(req.messages),
    contextBlocks: (req.contextBlocks ?? []).map((block) => ({
      refKey: block.refKey,
      tokenEstimate: block.tokenEstimate,
      body: summarizePayloadForAudit(block.body),
    })),
    tools: (req.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description
        ? summarizePayloadForAudit(tool.description)
        : undefined,
      inputSchema: summarizePayloadForAudit(tool.input_schema),
    })),
  }
}

function traceIdFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return typeof metadata.trace_id === 'string' ? metadata.trace_id : undefined
}

function llmProviderMeta(
  req: LlmTestConnectionRequest | LlmListModelsRequest,
): Record<string, unknown> {
  const trace = buildLatticeTraceContext(req)
  return {
    ...latticeTraceAuditMetadata(trace),
    provider: req.provider,
    baseUrl: req.baseUrl,
    timeoutMs: req.timeoutMs,
  }
}

export function registerLlmIpc(): void {
  ipcMain.handle('llm:invoke', async (_event, req: unknown): Promise<LlmInvokeResult> => {
    const startedAt = Date.now()
    if (!isValidRequest(req)) {
      writeAuditEvent({
        category: 'llm',
        action: 'invoke',
        status: 'error',
        durationMs: 0,
        metadata: { invalidPayload: true },
        error: 'Invalid LLM invoke request payload',
      })
      return {
        success: false,
        error: 'Invalid LLM invoke request payload',
        durationMs: 0,
      }
    }
    const metadata = llmInvokeAuditMeta(req)
    writeAuditEvent({
      category: 'llm',
      action: 'invoke',
      status: 'started',
      metadata,
      traceId: traceIdFromMetadata(metadata),
    })
    const result = await invoke(req)
    writeAuditEvent({
      category: 'llm',
      action: 'invoke',
      status: result.success ? 'success' : 'error',
      durationMs: result.durationMs || Date.now() - startedAt,
      metadata: {
        ...metadata,
        ...(result.success
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              toolCallCount: result.toolCalls?.length ?? 0,
              response: summarizePayloadForAudit(result.content),
            }
          : {
              status: result.status,
            }),
      },
      traceId: traceIdFromMetadata(metadata),
      ...(!result.success ? { error: result.error } : {}),
    })
    return result
  })

  ipcMain.handle(
    'llm:test-connection',
    async (_event, req: unknown): Promise<LlmTestConnectionResult> => {
      const startedAt = Date.now()
      if (!isValidTestRequest(req)) {
        writeAuditEvent({
          category: 'llm',
          action: 'test_connection',
          status: 'error',
          durationMs: 0,
          metadata: { invalidPayload: true },
          error: 'Invalid test-connection request payload',
        })
        return {
          success: false,
          error: 'Invalid test-connection request payload',
          durationMs: 0,
        }
      }
      const metadata = llmProviderMeta(req)
      writeAuditEvent({
        category: 'llm',
        action: 'test_connection',
        status: 'started',
        metadata,
        traceId: traceIdFromMetadata(metadata),
      })
      const result = await testConnection(req)
      writeAuditEvent({
        category: 'llm',
        action: 'test_connection',
        status: result.success ? 'success' : 'error',
        durationMs: result.durationMs || Date.now() - startedAt,
        metadata: {
          ...metadata,
          ...(result.success ? { modelCount: result.modelCount } : { status: result.status }),
        },
        traceId: traceIdFromMetadata(metadata),
        ...(!result.success ? { error: result.error } : {}),
      })
      return result
    },
  )

  ipcMain.handle(
    'llm:list-models',
    async (_event, req: unknown): Promise<LlmListModelsResult> => {
      const startedAt = Date.now()
      if (!isValidListModelsRequest(req)) {
        writeAuditEvent({
          category: 'llm',
          action: 'list_models',
          status: 'error',
          durationMs: 0,
          metadata: { invalidPayload: true },
          error: 'Invalid list-models request payload',
        })
        return {
          success: false,
          error: 'Invalid list-models request payload',
          durationMs: 0,
        }
      }
      const metadata = llmProviderMeta(req)
      writeAuditEvent({
        category: 'llm',
        action: 'list_models',
        status: 'started',
        metadata,
        traceId: traceIdFromMetadata(metadata),
      })
      const result = await listModels(req)
      writeAuditEvent({
        category: 'llm',
        action: 'list_models',
        status: result.success ? 'success' : 'error',
        durationMs: result.durationMs || Date.now() - startedAt,
        metadata: {
          ...metadata,
          ...(result.success ? { modelCount: result.models.length } : { status: result.status }),
        },
        traceId: traceIdFromMetadata(metadata),
        ...(!result.success ? { error: result.error } : {}),
      })
      return result
    },
  )

  ipcMain.handle(
    'llm:stream-start',
    (event, req: unknown): StreamStartResult => {
      if (!isValidRequest(req)) {
        writeAuditEvent({
          category: 'llm',
          action: 'stream_start',
          status: 'error',
          metadata: { invalidPayload: true },
          error: 'Invalid LLM stream request payload',
        })
        return { ok: false, error: 'Invalid LLM stream request payload' }
      }
      const metadata = llmInvokeAuditMeta(req)
      const result = startStream(req, event.sender)
      writeAuditEvent({
        category: 'llm',
        action: 'stream_start',
        status: result.ok ? 'started' : 'error',
        metadata: {
          ...metadata,
          ...(result.ok ? { streamId: result.streamId } : {}),
        },
        traceId: traceIdFromMetadata(metadata),
        ...(!result.ok ? { error: result.error } : {}),
      })
      return result
    },
  )

  ipcMain.handle(
    'llm:stream-abort',
    (_event, streamId: unknown): void => {
      if (typeof streamId === 'string') {
        writeAuditEvent({
          category: 'llm',
          action: 'stream_abort',
          status: 'aborted',
          metadata: { streamId },
        })
        abortStream(streamId)
      }
    },
  )
}
