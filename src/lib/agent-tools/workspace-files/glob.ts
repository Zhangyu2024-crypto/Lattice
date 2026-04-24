// Agent tool — `workspace_glob`. Safe auto-run enumeration of workspace
// files matching a glob. Caps at MAX_GLOB_RESULTS so a rogue root cannot
// blow the LLM's context window.

import type { LocalTool } from '@/types/agent-tool'
import { ensureRoot, listFilesInRoot, matchesGlob } from './helpers'
import { MAX_GLOB_RESULTS } from './types'

export const workspaceGlobTool: LocalTool<
  { pattern: string },
  { files: string[]; truncated: boolean }
> = {
  name: 'workspace_glob',
  description:
    'List workspace files matching a glob pattern (supports `*`, `**`, `?`). Returned paths are relative to the workspace root. Capped at 500.',
  trustLevel: 'safe',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'e.g. "**/*.py" or "data/*.json".',
      },
    },
    required: ['pattern'],
  },
  async execute(input) {
    ensureRoot()
    if (!input?.pattern) throw new Error('pattern is required')
    const all = await listFilesInRoot()
    const matched = all.filter((f) => matchesGlob(f, input.pattern))
    const truncated =
      all.length >= MAX_GLOB_RESULTS || matched.length >= MAX_GLOB_RESULTS
    return {
      files: matched.slice(0, MAX_GLOB_RESULTS),
      truncated,
    }
  },
}
