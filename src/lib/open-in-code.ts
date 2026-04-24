// Creates a new linked Compute artifact pre-populated with a per-kind Python
// template and the source artifact's payload (as a base64 JSON blob in the
// script header). After the artifact is created it is focused so the user
// lands directly in the code editor.
//
// Reuses the existing Docker-backed compute runtime — once the user hits Run,
// everything flows through `runCompute` exactly like a hand-written compute
// artifact.

import type { Artifact, ComputeArtifact } from '../types/artifact'
import { genArtifactId, useRuntimeStore } from '../stores/runtime-store'
import { toast } from '../stores/toast-store'
import { buildCodeTemplate } from './code-template'

/**
 * Spawn a linked Compute artifact from the given source. Returns the new
 * artifact's id on success, null if the kind has no template.
 */
export function openInCode(sessionId: string, source: Artifact): string | null {
  const template = buildCodeTemplate(source)
  if (!template) {
    toast.warn(`"Open in Code" is not available for ${source.kind}`)
    return null
  }

  const now = Date.now()
  const newArtifact: ComputeArtifact = {
    id: genArtifactId(),
    kind: 'compute',
    title: template.baseTitle,
    createdAt: now,
    updatedAt: now,
    parents: [source.id],
    payload: {
      language: 'python',
      code: template.code,
      stdout: '',
      stderr: '',
      figures: [],
      exitCode: null,
      status: 'idle',
    },
  }

  const store = useRuntimeStore.getState()
  store.upsertArtifact(sessionId, newArtifact)
  store.focusArtifact(sessionId, newArtifact.id)
  toast.success(`Opened ${source.kind} in Code — tweak and Run`)
  return newArtifact.id
}
