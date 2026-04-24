// Global palette router: reuse-or-create a `spectrum-pro` workbench for a
// given technique and dispatch a registered command against it. Keeps the
// command palette decoupled from the specific workbench instance the user
// happens to have focused.

import type { ArtifactId, SpectrumTechnique } from '../../types/artifact'
import { useRuntimeStore } from '../../stores/runtime-store'
import { createProWorkbench } from './create'

/** Max time we wait for a freshly-mounted workbench to register its
 *  commands before reporting a dispatch failure. */
const WORKBENCH_MOUNT_TIMEOUT_MS = 500

/**
 * Open (or reuse) a `spectrum-pro` workbench on the given technique and
 * dispatch a registered command against it. Powers the App-level command
 * palette's domain entries so the user can hit "XRD: Run Phase Search"
 * from anywhere without manually opening a workbench first.
 *
 * Reuse rule:
 *   1. If the session's `lastFocusedProByTechnique[technique]` still
 *      resolves to a live `spectrum-pro` artifact, focus it and dispatch.
 *   2. Otherwise create a new `spectrum-pro`, focus it, wait for the
 *      `TechniqueWorkbenchUI` to register its commands (poll up to
 *      `WORKBENCH_MOUNT_TIMEOUT_MS`), then dispatch.
 *
 * Errors (unregistered artifact after timeout / unknown command / command
 * throw) surface as `{ok: false, error}` so the caller can toast them.
 */
export async function openProWorkbenchAndRunCommand(
  sessionId: string,
  technique: SpectrumTechnique,
  commandName: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Dynamic import: `pro-workbench` lives in `src/lib/` and
  // `commandRegistry.ts` lives in `src/components/`; a static import
  // would create a lib→component dependency that the rest of this
  // module deliberately avoids. The dynamic form also lazy-loads the
  // registry only when the global palette actually dispatches a
  // cross-workbench command (which almost no sessions do), keeping
  // the main bundle's cold-start path shorter.
  const { executeCommand, getRegistration } = await import(
    '@/components/canvas/artifacts/pro/commandRegistry'
  )
  const store = useRuntimeStore.getState()
  const session = store.sessions[sessionId]
  if (!session) return { ok: false, error: 'No active session' }

  // Try to reuse the last-focused workbench for this technique.
  const reusableId = session.lastFocusedProByTechnique?.[technique]
  const reusable =
    reusableId && session.artifacts[reusableId]?.kind === 'spectrum-pro'
      ? reusableId
      : null

  let artifactId: ArtifactId
  if (reusable) {
    artifactId = reusable
    store.focusArtifact(sessionId, artifactId)
  } else {
    artifactId = createProWorkbench({
      sessionId,
      kind: 'spectrum-pro',
      spectrum: undefined,
      technique,
    })
    store.focusArtifact(sessionId, artifactId)
    // Newly-mounted workbench registers asynchronously via its effect —
    // poll until the registry sees it (cap ~500 ms so a misconfigured
    // build doesn't hang the palette).
    const deadline = Date.now() + WORKBENCH_MOUNT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (getRegistration(artifactId)) break
      await new Promise((r) => setTimeout(r, 30))
    }
    if (!getRegistration(artifactId)) {
      return {
        ok: false,
        error: `Workbench didn't register within ${WORKBENCH_MOUNT_TIMEOUT_MS} ms`,
      }
    }
  }

  const result = await executeCommand(artifactId, commandName, args)
  if (result.success) return { ok: true }
  return { ok: false, error: result.error }
}
