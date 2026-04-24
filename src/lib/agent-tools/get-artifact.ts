import { useRuntimeStore } from '../../stores/runtime-store'
import type { LocalTool } from '../../types/agent-tool'

// Payload trimming caps. The tool must be safe to feed back to the model
// without blowing the context window — a 50k-point spectrum payload would
// swamp the next turn's input. Caps are intentionally conservative; tool
// authors who need full data should write a narrower tool.
const MAX_DEPTH = 3
const MAX_ARRAY_ITEMS = 24
const MAX_OBJECT_KEYS = 24

function trimValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    if (value.length <= MAX_ARRAY_ITEMS) {
      return value.map((item) => trimValue(item, depth + 1))
    }
    return {
      length: value.length,
      preview: value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => trimValue(item, depth + 1)),
      truncated: true,
    }
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const out: Record<string, unknown> = {}
    for (const [key, child] of entries.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = trimValue(child, depth + 1)
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out._truncatedKeys = entries.length - MAX_OBJECT_KEYS
    }
    return out
  }
  return value
}

interface GetArtifactInput {
  artifactId: string
}

interface GetArtifactOutput {
  id: string
  kind: string
  title: string
  sourceFile?: string | null
  payload: unknown
}

/**
 * Read-only tool: returns a trimmed snapshot of one artifact by id. Useful
 * when the model needs to inspect payload contents (e.g. peak positions,
 * phase list) before deciding what to do next.
 */
export const getArtifactTool: LocalTool<GetArtifactInput, GetArtifactOutput> = {
  name: 'get_artifact',
  description:
    'Get a trimmed view of one artifact by id. Large arrays and deeply nested objects are truncated to keep the tool result small.',
  cardMode: 'silent',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Artifact id to inspect.',
      },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    const artifact = session?.artifacts[input.artifactId]
    if (!artifact) throw new Error(`Artifact not found: ${input.artifactId}`)
    return {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      sourceFile: artifact.sourceFile ?? null,
      payload: trimValue(artifact.payload),
    }
  },
}
