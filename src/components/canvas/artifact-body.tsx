import { lazy, Suspense, type ReactNode } from 'react'
import type { Artifact } from '../../types/artifact'
import type { Session } from '../../types/session'

const ArtifactBodyRenderer = lazy(
  () => import('./artifact-body/ArtifactBodyRenderer'),
)

export const preloadArtifactBodyRenderer = () =>
  import('./artifact-body/ArtifactBodyRenderer')

function ArtifactBodyLoading() {
  return (
    <div className="artifact-body-loading" role="status">
      Loading artifact…
    </div>
  )
}

/**
 * Renders the main body for a focused artifact (shared by ArtifactCanvas and
 * the standalone Pro workbench BrowserWindow).
 *
 * The actual per-kind renderers live behind a dynamic import so the app shell
 * does not pull charting, CodeMirror, PDF, LaTeX, and structure-viewer code
 * into the first renderer chunk.
 */
export function renderArtifactBody(
  artifact: Artifact,
  session: Session,
  opts?: { embed?: 'card' | 'full' },
): ReactNode {
  return (
    <Suspense fallback={<ArtifactBodyLoading />}>
      <ArtifactBodyRenderer
        artifact={artifact}
        session={session}
        embed={opts?.embed ?? 'card'}
      />
    </Suspense>
  )
}
