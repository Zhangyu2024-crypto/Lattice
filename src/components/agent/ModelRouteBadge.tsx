// Surfaces the active slash-command route overrides (`/model`, `/effort`)
// next to the composer's ModelChip so the user can see at a glance which
// layer of the routing resolver is currently in control. Independent
// component to keep ModelChip's prop surface frozen.
//
// Contract: owns its own store subscription, renders nothing when no
// override is active. The composer just mounts it — no props.

import { X } from 'lucide-react'
import { useModelRouteStore } from '../../lib/model-routing'
import { useLLMConfigStore } from '../../stores/llm-config-store'
import { publicModelOverrideLabel } from '../../lib/model-display'
import Badge from '../ui/Badge'

function formatEffort(effort: string | undefined): string {
  if (!effort) return ''
  return effort.toUpperCase()
}

export default function ModelRouteBadge() {
  const override = useModelRouteStore((s) => s.override)
  const providers = useLLMConfigStore((s) => s.providers)

  const hasModelOverride = Boolean(override.providerId || override.modelId)
  const hasEffortOverride = Boolean(override.reasoningEffort)

  if (!hasModelOverride && !hasEffortOverride) return null

  const clear = () => useModelRouteStore.getState().clearAllOverrides()

  let modelTooltip = ''
  if (hasModelOverride) {
    const pid = override.providerId ?? ''
    const mid = override.modelId ?? ''
    const provider = providers.find((p) => p.id === pid)
    const model = provider?.models.find((m) => m.id === mid)
    modelTooltip = publicModelOverrideLabel(provider, model, `${pid}/${mid}`)
  }

  return (
    <span
      className="model-route-badge-row"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 6,
      }}
    >
      {hasModelOverride ? (
        <Badge
          variant="warning"
          title={`Session connection override: ${modelTooltip}`}
        >
          CONN
        </Badge>
      ) : null}
      {hasEffortOverride ? (
        <Badge
          variant="warning"
          title="Session reasoning-effort override is active"
        >
          {`EFFORT:${formatEffort(override.reasoningEffort)}`}
        </Badge>
      ) : null}
      <button
        type="button"
        onClick={clear}
        title="Clear all session connection overrides"
        aria-label="Clear connection overrides"
        className="model-route-badge-clear"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          padding: 0,
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 3,
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
          lineHeight: 0,
        }}
      >
        <X size={12} strokeWidth={2} aria-hidden />
      </button>
    </span>
  )
}
