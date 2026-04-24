// Agent tool — `workspace_read_file`. Safe auto-run read that surfaces
// the file contents inline through the chat card (cardMode:'silent').

import type { LocalTool } from '@/types/agent-tool'
import { ensureRoot, readText, utf8ByteLength } from './helpers'

export const workspaceReadFileTool: LocalTool<
  { relPath: string },
  { content: string; sizeBytes: number }
> = {
  name: 'workspace_read_file',
  description:
    'Read a UTF-8 text file from the workspace root. `relPath` is relative to the root; absolute paths and ".." are rejected by the IPC layer. Max file size 2 MB.',
  trustLevel: 'safe',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: {
        type: 'string',
        description: 'Path inside the workspace, e.g. "script.py" or "data/peaks.json".',
      },
    },
    required: ['relPath'],
  },
  async execute(input) {
    ensureRoot()
    if (!input?.relPath) throw new Error('relPath is required')
    const content = await readText(input.relPath)
    return { content, sizeBytes: utf8ByteLength(content) }
  },
}
