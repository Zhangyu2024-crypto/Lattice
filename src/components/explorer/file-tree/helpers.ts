// Path + formatting helpers used by the FileTree and its sub-components.
// Kept as plain functions (no hooks, no React) so they can be unit-tested
// in isolation and imported by the dialog/menu pieces without pulling in
// the whole tree component.

import type { IndexedEntry } from '../../../stores/workspace-store'
import { getWorkspaceFs } from '../../../lib/workspace/fs'
import { readEnvelope, writeEnvelope } from '../../../lib/workspace/envelope'
import { useRuntimeStore } from '../../../stores/runtime-store'

/**
 * Join two POSIX-style relative paths. If the left side is empty (root
 * workspace) the right side is returned untouched — concatenating `'' + '/'
 * + name` would produce a leading slash that the workspace store treats as
 * an absolute path and rejects.
 */
export function posixJoin(a: string, b: string): string {
  if (!a) return b
  return `${a}/${b}`
}

/**
 * Resolve the directory that should "contain" a new sibling of the given
 * entry — if `entry` is itself a directory we create children inside it,
 * otherwise we drop alongside it in its parent.
 *
 * Currently unused by the tree render path but retained for future
 * context-menu actions that create files relative to a selected node.
 */
export function parentDir(entry: IndexedEntry | null): string {
  if (!entry) return ''
  return entry.isDirectory ? entry.relPath : entry.parentRel
}

/**
 * Human-readable byte size used by the Properties dialog. "unknown" covers
 * both the zero/missing case and negative sentinels returned by the
 * workspace fs when it couldn't stat the entry.
 */
export function formatSize(size: number): string {
  if (!size || size <= 0) return 'unknown'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * After renaming a `.chat.json` file on disk, sync the derived title in two
 * places so the chat panel header doesn't drift:
 *   1. The envelope's `meta.title` (persists across reloads).
 *   2. The live runtime-store session matching the envelope id (drives the
 *      AgentComposer header right now).
 *
 * Failures are swallowed intentionally — the disk rename already succeeded
 * and the title will reconcile itself the next time the file is opened.
 */
export async function syncChatTitleAfterRename(
  nextRel: string,
  newBaseName: string,
): Promise<void> {
  const newTitle = newBaseName.replace(/\.chat\.json$/i, '')
  try {
    const fs = getWorkspaceFs()
    const env = await readEnvelope<unknown>(fs, nextRel)
    await writeEnvelope(fs, nextRel, {
      kind: env.kind,
      id: env.id,
      createdAt: env.createdAt,
      updatedAt: Date.now(),
      meta: { ...(env.meta ?? {}), title: newTitle },
      payload: env.payload,
    })
    if (env.id) {
      const runtime = useRuntimeStore.getState()
      if (runtime.sessions[env.id]) {
        runtime.renameSession(env.id, newTitle)
      }
    }
  } catch {
    // Non-fatal — see docstring.
  }
}
