import { RefreshCw } from 'lucide-react'
import Button from '../../../ui/Button'
import type { GenerationConfig, ReasoningEffort } from '../../../../types/llm'
import { clamp } from './types'

interface GenerationTabsProps {
  dialog: GenerationConfig
  agent: GenerationConfig
  onChangeDialog: (patch: Partial<GenerationConfig>) => void
  onChangeAgent: (patch: Partial<GenerationConfig>) => void
  onResetDialog: () => void
  onResetAgent: () => void
}

export default function GenerationTabs({
  agent,
  onChangeAgent,
  onResetAgent,
}: GenerationTabsProps) {
  return (
    <div className="llm-models-generation">
      <div className="llm-models-tabs">
        <span className="llm-models-tab is-active">Generation</span>
        <span className="llm-models-spacer" />
        <Button
          variant="secondary"
          size="sm"
          onClick={onResetAgent}
          leading={<RefreshCw size={11} />}
        >
          Reset
        </Button>
      </div>
      <GenerationDrawer config={agent} onChange={onChangeAgent} />
    </div>
  )
}

function GenerationDrawer({
  config,
  onChange,
}: {
  config: GenerationConfig
  onChange: (patch: Partial<GenerationConfig>) => void
}) {
  return (
    <div className="llm-models-drawer-inner">
      <div className="llm-models-drawer-grid">
        <DrawerFieldset
          label="Temperature"
          description={`Randomness. ${config.temperature.toFixed(2)}`}
        >
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={config.temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            className="llm-models-range"
          />
        </DrawerFieldset>

        <DrawerFieldset
          label="Top P"
          description={`Nucleus sampling. ${config.topP.toFixed(2)}`}
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.topP}
            onChange={(e) => onChange({ topP: Number(e.target.value) })}
            className="llm-models-range"
          />
        </DrawerFieldset>

        <DrawerFieldset
          label="Max tokens"
          description="Upper bound on response length."
        >
          <input
            type="number"
            min={128}
            max={32000}
            step={128}
            value={config.maxTokens}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') return
              const n = parseInt(raw, 10)
              if (Number.isFinite(n)) {
                onChange({ maxTokens: clamp(n, 128, 32000) })
              }
            }}
            className="llm-input llm-input--full"
          />
        </DrawerFieldset>

        <DrawerFieldset
          label="Reasoning effort"
          description="Chain-of-thought depth when supported."
        >
          <select
            value={config.reasoningEffort ?? 'medium'}
            onChange={(e) =>
              onChange({ reasoningEffort: e.target.value as ReasoningEffort })
            }
            className="llm-input llm-input--full"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </DrawerFieldset>
      </div>
    </div>
  )
}

function DrawerFieldset({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="llm-models-fieldset">
      <div className="llm-models-field-head">
        <span className="llm-models-field-label">{label}</span>
        {description && (
          <span className="llm-models-field-desc">{description}</span>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}
