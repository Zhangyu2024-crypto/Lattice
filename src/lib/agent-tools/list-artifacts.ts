import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'

interface ListArtifactsOutput {
  artifacts: Array<{
    id: string
    kind: string
    title: string
    sourceFile?: string | null
  }>
}

/**
 * Read-only tool: returns the id / kind / title / sourceFile of every
 * artifact in the current session, in the user's display order. Safe to
 * call freely — no mutations, no network.
 */
export const listArtifactsTool: LocalTool<
  Record<string, never>,
  ListArtifactsOutput
> = {
  name: 'list_artifacts',
  description: 'List all artifacts in the current session.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(_input, ctx) {
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) throw new Error(`Session not found: ${ctx.sessionId}`)
    const artifacts = session.artifactOrder
      .map((artifactId) => session.artifacts[artifactId])
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        sourceFile: artifact.sourceFile ?? null,
      }))
    return { artifacts }
  },
}
