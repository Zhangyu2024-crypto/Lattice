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

export function registerLlmIpc(): void {
  ipcMain.handle('llm:invoke', async (_event, req: unknown): Promise<LlmInvokeResult> => {
    if (!isValidRequest(req)) {
      return {
        success: false,
        error: 'Invalid LLM invoke request payload',
        durationMs: 0,
      }
    }
    return invoke(req)
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
      return testConnection(req)
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
      return listModels(req)
    },
  )

  ipcMain.handle(
    'llm:stream-start',
    (event, req: unknown): StreamStartResult => {
      if (!isValidRequest(req)) {
        return { ok: false, error: 'Invalid LLM stream request payload' }
      }
      return startStream(req, event.sender)
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
