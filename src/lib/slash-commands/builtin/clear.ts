import type { LocalCommand } from '../types'
import { useRuntimeStore } from '../../../stores/runtime-store'

export const clearCommand: LocalCommand = {
  type: 'local',
  name: 'clear',
  description: 'Clear the transcript of the active session',
  source: 'builtin',
  call: async (_args, ctx) => {
    if (!ctx.sessionId) return { kind: 'skip' }
    useRuntimeStore.getState().clearTranscript(ctx.sessionId)
    return { kind: 'skip' }
  },
}
