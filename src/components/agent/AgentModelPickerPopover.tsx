import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react'
import { Check, Settings } from 'lucide-react'
import { useLLMConfigStore, useResolvedModel } from '../../stores/llm-config-store'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
import {
  publicModelLabel,
  publicProviderModelLabel,
} from '../../lib/model-display'

interface Props {
  anchorEl: HTMLElement | null
  onClose: () => void
  /** Full LLM settings (providers, keys, budget) — secondary to quick model pick. */
  onOpenFullSettings?: () => void
}

const POPOVER_WIDTH = 300
const POPOVER_MARGIN = 8

function anchorPosition(anchorEl: HTMLElement | null): { left: number; bottom: number } {
  if (!anchorEl || typeof window === 'undefined') {
    return { left: 16, bottom: 32 }
  }
  const rect = anchorEl.getBoundingClientRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const desiredLeft = Math.min(
    Math.max(POPOVER_MARGIN, rect.left),
    viewportW - POPOVER_WIDTH - POPOVER_MARGIN,
  )
  const bottom = Math.max(POPOVER_MARGIN, viewportH - rect.top + 6)
  return { left: desiredLeft, bottom }
}

/**
 * Compact model switcher for the composer footer chip — avoids routing the
 * primary click through to the full settings modal.
 */
export default function AgentModelPickerPopover({
  anchorEl,
  onClose,
  onOpenFullSettings,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const providers = useLLMConfigStore((s) => s.providers)
  const agentCfg = useLLMConfigStore((s) => s.agent)
  const updateAgentConfig = useLLMConfigStore((s) => s.updateAgentConfig)
  const resolved = useResolvedModel('agent')

  const modelOptions = useMemo(() => {
    const out: Array<{
      key: string
      providerId: string
      modelId: string
      label: string
      disabled: boolean
    }> = []
    for (const provider of providers) {
      for (const model of provider.models) {
        out.push({
          key: `${provider.id}::${model.id}`,
          providerId: provider.id,
          modelId: model.id,
          label: publicProviderModelLabel(provider, model),
          disabled: !provider.enabled,
        })
      }
    }
    return out
  }, [providers])

  const selectedKey =
    agentCfg.providerId && agentCfg.modelId
      ? `${agentCfg.providerId}::${agentCfg.modelId}`
      : ''

  // Anchor trigger (model chip) sits outside the popover — exempt it
  // so its own click toggle isn't fighting the dismissal.
  const anchorRef = useMemo<React.RefObject<HTMLElement | null>>(
    () => ({ current: anchorEl }),
    [anchorEl],
  )
  useOutsideClickDismiss(rootRef, true, onClose, anchorRef)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const position = useMemo(() => anchorPosition(anchorEl), [anchorEl])

  const pick = (providerId: string, modelId: string) => {
    updateAgentConfig({ providerId, modelId })
    onClose()
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Choose agent model"
      className="agent-model-picker"
      style={
        {
          '--agent-model-picker-left': `${position.left}px`,
          '--agent-model-picker-bottom': `${position.bottom}px`,
        } as CSSProperties
      }
    >
      <div className="agent-model-picker-head">
        <span className="agent-model-picker-title">Agent model</span>
        {resolved ? (
          <span className="agent-model-picker-current" title={selectedKey}>
            {publicModelLabel(resolved)}
          </span>
        ) : (
          <span className="agent-model-picker-current is-muted">
            Not configured
          </span>
        )}
      </div>

      <div className="agent-model-picker-list" role="listbox" aria-label="Models">
        {modelOptions.length === 0 ? (
          <div className="agent-model-picker-empty">
            No models in catalog — open settings to connect a provider.
          </div>
        ) : (
          modelOptions.map((opt) => {
            const isSel = opt.key === selectedKey
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={isSel}
                disabled={opt.disabled}
                className={
                  'agent-model-picker-row' +
                  (isSel ? ' is-selected' : '') +
                  (opt.disabled ? ' is-disabled' : '')
                }
                onClick={() =>
                  !opt.disabled && pick(opt.providerId, opt.modelId)
                }
              >
                <span className="agent-model-picker-row-label">{opt.label}</span>
                {isSel ? (
                  <Check size={14} strokeWidth={2} className="agent-model-picker-check" aria-hidden />
                ) : null}
              </button>
            )
          })
        )}
      </div>

      {onOpenFullSettings ? (
        <button
          type="button"
          className="agent-model-picker-footer"
          onClick={() => {
            onClose()
            onOpenFullSettings()
          }}
        >
          <Settings size={12} strokeWidth={2} aria-hidden />
          <span>LLM settings (providers, keys, budget)</span>
        </button>
      ) : null}
    </div>
  )
}
