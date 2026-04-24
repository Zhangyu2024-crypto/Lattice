import type { LocalCommand } from '../types'
import { useModelRouteStore } from '../../model-routing'
import { useLLMConfigStore } from '../../../stores/llm-config-store'

// `/model [provider/id]` sets a session-scoped model override.
// `/model` alone lists the available provider/model pairs with the
// currently-active row marked.

const EXAMPLE = 'anthropic-default/claude-opus-4-7'

export const modelCommand: LocalCommand = {
  type: 'local',
  name: 'model',
  description: 'Switch the model for this session (or list options)',
  argumentHint: '[provider/model]',
  source: 'builtin',
  paletteGroup: 'Model',
  call: async (args) => {
    const trimmed = args.trim()
    const configState = useLLMConfigStore.getState()
    const routeStore = useModelRouteStore.getState()

    if (!trimmed) {
      // No args — list every available (providerId, modelId) pair with a
      // marker on the currently-effective one.
      const rows = configState.providers.flatMap((p) =>
        p.models.map((m) => ({
          pid: p.id,
          mid: m.id,
          label: `${p.name} → ${m.label}`,
        })),
      )
      if (rows.length === 0) {
        return {
          kind: 'text',
          text:
            'No models configured. Open Settings → Models to add a provider first.',
        }
      }
      const activePid = routeStore.override.providerId ?? null
      const activeMid = routeStore.override.modelId ?? null
      const active = `${activePid ?? ''}/${activeMid ?? ''}`
      const lines = rows
        .map((r) => {
          const marker = active === `${r.pid}/${r.mid}` ? '▶' : ' '
          return `  ${marker} ${r.pid}/${r.mid}  — ${r.label}`
        })
        .sort()
      const footer = activePid
        ? `Active override: ${activePid}/${activeMid}. Run \`/model reset\` to clear.`
        : `No session override — using the Settings default. Try \`/model ${EXAMPLE}\`.`
      return {
        kind: 'text',
        text: `${lines.join('\n')}\n\n${footer}`,
      }
    }

    if (trimmed === 'reset' || trimmed === 'off' || trimmed === 'clear') {
      routeStore.clearModelOverride()
      return {
        kind: 'text',
        text: 'Cleared session model override; back to Settings default.',
      }
    }

    // Accept either `providerId/modelId` or bare `modelId` (pick the first
    // provider that declares it).
    const slash = trimmed.indexOf('/')
    let providerId: string | null = null
    let modelId: string | null = null
    if (slash > 0) {
      providerId = trimmed.slice(0, slash).trim()
      modelId = trimmed.slice(slash + 1).trim()
    } else {
      modelId = trimmed
      const match = configState.providers.find((p) =>
        p.models.some((m) => m.id === modelId),
      )
      providerId = match?.id ?? null
    }

    if (!providerId || !modelId) {
      return {
        kind: 'text',
        text: `Could not parse "${trimmed}". Use \`/model\` to list options, or \`/model <providerId>/<modelId>\`.`,
      }
    }

    const provider = configState.providers.find((p) => p.id === providerId)
    const model = provider?.models.find((m) => m.id === modelId)
    if (!provider || !model) {
      return {
        kind: 'text',
        text: `Unknown model "${providerId}/${modelId}". Run \`/model\` to list available pairs.`,
      }
    }

    routeStore.setOverride({ providerId, modelId })
    return {
      kind: 'text',
      text: `Session model set to ${provider.name} → ${model.label}. (\`/model reset\` to undo)`,
    }
  },
}
