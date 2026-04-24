import type { LocalCommand } from '../types'
import { useModelRouteStore } from '../../model-routing'
import type { ReasoningEffort } from '../../../types/llm'

const VALID: readonly ReasoningEffort[] = ['low', 'medium', 'high']

export const effortCommand: LocalCommand = {
  type: 'local',
  name: 'effort',
  description: 'Set reasoning effort for this session',
  argumentHint: '[low|medium|high|off]',
  source: 'builtin',
  paletteGroup: 'Model',
  call: async (args) => {
    const store = useModelRouteStore.getState()
    const trimmed = args.trim().toLowerCase()

    if (!trimmed) {
      const current =
        store.override.reasoningEffort ?? '(inherit mode default)'
      return {
        kind: 'text',
        text: `Current session effort: ${current}. Use \`/effort low\`, \`/effort medium\`, \`/effort high\`, or \`/effort off\`.`,
      }
    }

    if (trimmed === 'off' || trimmed === 'reset' || trimmed === 'clear') {
      store.setEffortOverride(null)
      return {
        kind: 'text',
        text: 'Cleared effort override; using the mode default.',
      }
    }

    if (!(VALID as readonly string[]).includes(trimmed)) {
      return {
        kind: 'text',
        text: `Unknown effort "${trimmed}". Valid: low, medium, high, off.`,
      }
    }
    store.setEffortOverride(trimmed as ReasoningEffort)
    return {
      kind: 'text',
      text: `Session reasoning effort set to ${trimmed}.`,
    }
  },
}
