// Agent tool — `workspace_write_file`. Proposal-first: execute()
// returns a diff-shaped proposal for the AgentCard; the applier
// registry (src/components/agent/tool-cards/applier-registry.ts)
// performs the disk write only after the user approves.

import type { LocalTool } from '@/types/agent-tool'
import { ensureRoot, readText, statExists, utf8ByteLength } from './helpers'
import type { WorkspaceWriteProposal } from './types'

export const workspaceWriteFileTool: LocalTool<
  { relPath: string; content: string },
  WorkspaceWriteProposal
> = {
  name: 'workspace_write_file',
  description:
    'Create or overwrite a UTF-8 text file in the workspace. Returns a proposal for the user to review + approve in the AgentCard; the applier registry writes to disk only after approval. Parent directories are created as needed.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: { type: 'string', description: 'Target path relative to workspace root.' },
      content: { type: 'string', description: 'UTF-8 file contents.' },
    },
    required: ['relPath', 'content'],
  },
  async execute(input) {
    ensureRoot()
    if (!input?.relPath) throw new Error('relPath is required')
    if (typeof input.content !== 'string') throw new Error('content is required')

    let existing: string | null = null
    if (await statExists(input.relPath)) {
      try {
        existing = await readText(input.relPath)
      } catch {
        existing = null
      }
    }

    return {
      relPath: input.relPath,
      proposedContent: input.content,
      sizeBytes: utf8ByteLength(input.content),
      existingContent: existing,
    }
  },
}
