// Agent tool — `workspace_edit_file`. Exact-string replacement with a
// proposal-first flow: read the current file, apply each patch
// sequentially in-memory, surface the preview + per-patch errors so
// the editor can red-flag broken rows. No disk write here — the
// applier does that on approve.

import type { LocalTool } from '@/types/agent-tool'
import { countOccurrences, ensureRoot, readText } from './helpers'
import type {
  WorkspaceEditPatch,
  WorkspaceEditPatchError,
  WorkspaceEditProposal,
} from './types'

export const workspaceEditFileTool: LocalTool<
  {
    relPath: string
    // Single-patch shape ────────────────────────
    oldString?: string
    newString?: string
    // Multi-patch shape ─────────────────────────
    patches?: WorkspaceEditPatch[]
  },
  WorkspaceEditProposal
> = {
  name: 'workspace_edit_file',
  description:
    'Exact-string replacement in a workspace file. Returns a review proposal: each {oldString, newString} patch is applied in-memory and surfaced for approval. Use `patches: [...]` for multi-patch edits; `oldString` / `newString` remain supported for single-patch calls.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: { type: 'string' },
      oldString: { type: 'string', description: 'Exact text to replace (single-patch form).' },
      newString: { type: 'string', description: 'Replacement text (single-patch form).' },
      patches: {
        type: 'array',
        description:
          'Multi-patch form: ordered list of {oldString, newString} exact-string replacements. Each is applied to the result of the previous one.',
      },
    },
    required: ['relPath'],
  },
  async execute(input) {
    ensureRoot()
    if (!input?.relPath) throw new Error('relPath is required')

    // Normalise to a uniform patch list.
    const patches: WorkspaceEditPatch[] = []
    if (Array.isArray(input.patches)) {
      for (let i = 0; i < input.patches.length; i++) {
        const p: unknown = input.patches[i]
        if (
          !p ||
          typeof p !== 'object' ||
          typeof (p as WorkspaceEditPatch).oldString !== 'string' ||
          typeof (p as WorkspaceEditPatch).newString !== 'string'
        ) {
          throw new Error(
            `patches[${i}] must be {oldString: string, newString: string}`,
          )
        }
        patches.push({
          oldString: (p as WorkspaceEditPatch).oldString,
          newString: (p as WorkspaceEditPatch).newString,
        })
      }
    }
    if (patches.length === 0) {
      if (typeof input.oldString !== 'string' || typeof input.newString !== 'string') {
        throw new Error(
          'edit_file requires either `patches: [...]` or both `oldString` + `newString`',
        )
      }
      patches.push({ oldString: input.oldString, newString: input.newString })
    }

    // Main-chat proposal flow: read the current file, apply each patch
    // sequentially in-memory, surface the preview + per-patch errors so
    // the editor can red-flag broken rows. No disk write here — the
    // applier does that on approve.
    const existingContent = await readText(input.relPath)
    let preview = existingContent
    const errors: WorkspaceEditPatchError[] = []
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      if (p.oldString.length === 0) {
        errors.push({ index: i, reason: 'oldString is empty' })
        continue
      }
      const occurrences = countOccurrences(preview, p.oldString)
      if (occurrences === 0) {
        errors.push({ index: i, reason: 'oldString not found in file' })
        continue
      }
      if (occurrences > 1) {
        errors.push({
          index: i,
          reason: `oldString matches ${occurrences} places; provide more context`,
        })
        continue
      }
      preview = preview.replace(p.oldString, p.newString)
    }

    return {
      relPath: input.relPath,
      patches,
      existingContent,
      preview,
      ...(errors.length > 0 ? { errors } : {}),
    }
  },
}
