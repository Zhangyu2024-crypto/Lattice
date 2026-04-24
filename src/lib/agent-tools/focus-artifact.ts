import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'

interface FocusArtifactInput {
  artifactId: string
}

interface FocusArtifactOutput {
  ok: true
  artifactId: string
  title: string
}

/**
 * Side-effecting tool: moves the canvas focus to the given artifact so the
 * user sees what the model is talking about. The only allowed mutation —
 * artifact contents themselves are not touched.
 */
export const focusArtifactTool: LocalTool<
  FocusArtifactInput,
  FocusArtifactOutput
> = {
  name: 'focus_artifact',
  description:
    'Focus an artifact in the current session so the user sees it on the canvas.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Artifact id to focus.',
      },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    const store = useRuntimeStore.getState()
    const session = store.sessions[ctx.sessionId]
    const artifact = session?.artifacts[input.artifactId]
    if (!artifact) throw new Error(`Artifact not found: ${input.artifactId}`)
    store.focusArtifact(ctx.sessionId, input.artifactId)
    return {
      ok: true,
      artifactId: artifact.id,
      title: artifact.title,
    }
  },
}
