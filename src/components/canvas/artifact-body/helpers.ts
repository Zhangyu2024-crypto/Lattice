import type { Artifact } from '../../../types/artifact'
import type { Session } from '../../../types/session'
import {
  dispatchMentionAdd,
  type MentionAddRequest,
} from '../../../lib/composer-bus'

/**
 * Walks the session's artifact order from newest to oldest and returns the
 * first artifact whose `kind` matches. Used by `renderArtifactBody` to pair a
 * freshly focused spectrum with its latest peak-fit overlay and vice versa.
 */
export function findLatestByKind<T extends Artifact>(
  session: Session,
  kind: Artifact['kind'],
): T | undefined {
  for (let i = session.artifactOrder.length - 1; i >= 0; i--) {
    const a = session.artifacts[session.artifactOrder[i]]
    if (a && a.kind === kind) return a as T
  }
  return undefined
}

/**
 * Context-menu "Mention in chat" dispatch. Cards leave `sessionId: ''` in the
 * ref (they have no way to know it); the host fills it in here before handing
 * to the composer bus.
 */
export function forwardMention(sessionId: string) {
  return (req: MentionAddRequest) => {
    if (
      req.ref.type === 'artifact' ||
      req.ref.type === 'artifact-element' ||
      req.ref.type === 'file'
    ) {
      dispatchMentionAdd({ ...req, ref: { ...req.ref, sessionId } })
    } else {
      dispatchMentionAdd(req)
    }
  }
}

/**
 * Batch row click — resolve the artifact linked to a succeeded file. The
 * resolution logic (artifactIds first, then sourceFile suffix match) mirrors
 * the pre-Phase-7b inline implementation.
 */
export function resolveBatchLinkedArtifact(
  session: Session,
  file: { relPath: string; artifactIds?: string[] },
): string | null {
  for (const id of file.artifactIds ?? []) {
    if (session.artifacts[id]) return id
  }
  for (let i = session.artifactOrder.length - 1; i >= 0; i--) {
    const id = session.artifactOrder[i]
    const a = session.artifacts[id]
    if (!a?.sourceFile) continue
    if (
      a.sourceFile === file.relPath ||
      a.sourceFile.endsWith(`/${file.relPath}`) ||
      a.sourceFile.endsWith(file.relPath)
    ) {
      return id
    }
  }
  return null
}
