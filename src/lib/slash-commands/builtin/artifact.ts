import type { OverlayCommand } from '../types'
import { useModalStore } from '../../../stores/modal-store'

export const artifactCommand: OverlayCommand = {
  type: 'overlay',
  name: 'artifact',
  description: 'Open an artifact by id in the artifact overlay',
  argumentHint: '<artifact-id>',
  source: 'builtin',
  call: (args, ctx) => {
    const artifactId = args.trim()
    if (!artifactId || !ctx.sessionId) return undefined
    useModalStore.getState().setArtifactOverlay({
      sessionId: ctx.sessionId,
      artifactId,
    })
    return undefined
  },
}
