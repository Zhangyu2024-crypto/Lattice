import { ipcMain } from 'electron'
import {
  searchLiterature,
  type LiteratureSearchRequest,
  type LiteratureSearchResult,
} from './literature-search'

// The literature search is called both from the renderer (direct UI panels
// that might surface search results) and from the agent runtime (via the
// `literature_search` LocalTool) — both paths land here. The handler does
// only the minimal payload validation needed to avoid a crash on a
// malformed caller; everything else (timeouts, partial failures, source
// diagnostics) is carried through the result shape.
function isValidRequest(v: unknown): v is LiteratureSearchRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.query !== 'string') return false
  if (r.limit !== undefined && typeof r.limit !== 'number') return false
  if (r.timeoutMs !== undefined && typeof r.timeoutMs !== 'number') return false
  if (r.mailto !== undefined && typeof r.mailto !== 'string') return false
  return true
}

export function registerLiteratureIpc(): void {
  ipcMain.handle(
    'literature:search',
    async (_event, req: unknown): Promise<LiteratureSearchResult> => {
      if (!isValidRequest(req)) {
        return {
          success: false,
          error: 'Invalid literature search payload',
          durationMs: 0,
        }
      }
      return searchLiterature(req)
    },
  )
}
