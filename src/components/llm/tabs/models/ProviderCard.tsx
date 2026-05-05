import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  Loader2,
  Plug,
  Save,
  Star,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import Button from '../../../ui/Button'
import { toast } from '../../../../stores/toast-store'
import { maskKey } from '../../llm-config-helpers'
import type { LLMModel, LLMProvider } from '../../../../types/llm'
import { CONNECTABLE_TYPES, isBuiltIn, truncate, type ConnectStatus } from './types'
import {
  LATTICE_AUTH_API_KEY_REF,
  LATTICE_AUTH_PROVIDER_ID,
} from '../../../../lib/lattice-auth-client'
import { publicProviderModelLabel } from '../../../../lib/model-display'

interface ProviderCardProps {
  provider: LLMProvider
  isCurrentDefault: boolean
  currentModelId: string | null
  connectStatus: ConnectStatus
  onUpdateKey: (key: string) => void
  onToggleEnabled: () => void
  onRemove: () => void
  onConnect: () => void
  onSetDefault: (model: LLMModel) => void
}

export default function ProviderCard({
  provider,
  isCurrentDefault,
  currentModelId,
  connectStatus,
  onUpdateKey,
  onToggleEnabled,
  onRemove,
  onConnect,
  onSetDefault,
}: ProviderCardProps) {
  const [editingKey, setEditingKey] = useState(false)
  const [draft, setDraft] = useState(provider.apiKey ?? '')
  const [modelsOpen, setModelsOpen] = useState(provider.models.length > 0)

  const builtIn = isBuiltIn(provider.id)
  const accountBacked = provider.id === LATTICE_AUTH_PROVIDER_ID
  const hasKey = Boolean(provider.apiKey && provider.apiKey.trim())
  const keyStoredSecurely = provider.apiKey?.trim() === LATTICE_AUTH_API_KEY_REF
  const canConnect =
    hasKey && CONNECTABLE_TYPES.has(provider.type) && provider.enabled
  const dotColor =
    provider.enabled && hasKey && provider.models.length > 0
      ? 'var(--color-green)'
      : provider.enabled && hasKey
        ? 'var(--color-yellow, #d6a31a)'
        : 'var(--color-text-muted)'
  const keyColor = hasKey
    ? 'var(--color-text-primary)'
    : 'var(--color-text-muted)'

  const connectDisabledReason = !provider.enabled
    ? 'Enable the connection first'
    : !hasKey
      ? 'Add an API key first'
      : !CONNECTABLE_TYPES.has(provider.type)
        ? `Connection type "${provider.type}" does not expose a compatible catalog`
        : undefined

  const handleSaveKey = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.warn('API key cannot be empty')
      return
    }
    onUpdateKey(trimmed)
    setEditingKey(false)
  }
  const handleCancelKey = () => {
    setDraft(provider.apiKey ?? '')
    setEditingKey(false)
  }
  const startEditingKey = () => {
    setDraft(provider.apiKey ?? '')
    setEditingKey(true)
  }

  return (
    <div className="llm-models-card">
      <div className="llm-models-card-header">
        <span
          className="llm-models-dot"
          style={{ '--dot-color': dotColor } as React.CSSProperties}
        />
        <strong className="llm-models-provider-name">{provider.name}</strong>
        <span className="llm-models-type-chip">{provider.type}</span>
        {isCurrentDefault ? (
          <span
            className="llm-models-type-chip"
            title="Default connection for Dialog and Agent"
          >
            default
          </span>
        ) : null}
        <span className="llm-models-spacer" />
        <label className="llm-models-toggle-label">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={onToggleEnabled}
            className="llm-cursor-pointer"
          />
          {provider.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>

      <div className="llm-models-base-url-row">
        <div className="llm-models-base-url">{provider.baseUrl}</div>
        {keyStoredSecurely ? (
          <span
            className="llm-models-locked-chip"
            title="This endpoint is bound to your signed-in Lattice account in the main process"
          >
            locked
          </span>
        ) : null}
      </div>

      <div className="llm-models-row">
        <span className="llm-models-row-label">API key</span>
        {editingKey ? (
          <div className="llm-models-edit-row">
            <input
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-..."
              className="llm-input llm-models-edit-input"
              autoFocus
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveKey}
              leading={<Save size={12} />}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancelKey}
              leading={<X size={12} />}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="llm-models-edit-row">
            <code
              className="llm-models-key-display"
              style={{ '--key-color': keyColor } as React.CSSProperties}
            >
              {maskKey(provider.apiKey)}
            </code>
            {keyStoredSecurely ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={startEditingKey}
                leading={<Edit2 size={11} />}
              >
                {hasKey ? 'Edit key' : 'Add key'}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="llm-models-row">
        <ConnectButton
          status={connectStatus}
          disabled={!canConnect}
          disabledReason={connectDisabledReason}
          hasModels={provider.models.length > 0}
          onConnect={onConnect}
        />
        <ConnectStatusBadge status={connectStatus} />
        <span className="llm-models-spacer" />
        {provider.models.length > 0 ? (
          <button
            type="button"
            onClick={() => setModelsOpen((v) => !v)}
            className="llm-models-expander"
          >
            {modelsOpen ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            {accountBacked ? 'Account connection' : `Options (${provider.models.length})`}
          </button>
        ) : null}
      </div>

      {modelsOpen && provider.models.length > 0 ? (
        <div className="llm-models-models-list">
          {(accountBacked ? provider.models.slice(0, 1) : provider.models).map((m) => {
            const isDefault =
              isCurrentDefault && currentModelId === m.id
            return (
              <div key={m.id} className="llm-models-model-card-row">
                <div className="llm-models-model-card-main">
                  <div className="llm-models-model-label">
                    {publicProviderModelLabel(provider, m)}
                    {isDefault ? (
                      <span
                        className="llm-models-type-chip"
                        title="Current default"
                        style={{ marginLeft: 6 }}
                      >
                        default
                      </span>
                    ) : null}
                  </div>
                  <div className="llm-models-model-meta">
                    {accountBacked
                      ? 'Connected through chaxiejun.xyz'
                      : `ctx ${(m.contextWindow / 1000).toFixed(0)}k`}
                  </div>
                </div>
                {accountBacked ? (
                  <div className="llm-models-pricing">Managed by account</div>
                ) : (
                  <div className="llm-models-pricing">
                    ${m.pricing.inputPerMillion}/${m.pricing.outputPerMillion} per 1M
                  </div>
                )}
                <Button
                  variant={isDefault ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => onSetDefault(m)}
                  disabled={isDefault}
                  leading={<Star size={11} />}
                  title={
                    isDefault
                      ? 'Already the default'
                      : 'Use this option as default for Dialog and Agent'
                  }
                >
                  {isDefault ? 'Default' : 'Set default'}
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="llm-models-action-row">
        <span className="llm-models-spacer" />
        <Button
          variant="danger"
          size="sm"
          onClick={onRemove}
          disabled={builtIn}
          title={builtIn ? 'Built-in providers cannot be removed' : 'Remove'}
          leading={<Trash2 size={12} />}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

function ConnectButton({
  status,
  disabled,
  disabledReason,
  hasModels,
  onConnect,
}: {
  status: ConnectStatus
  disabled: boolean
  disabledReason?: string
  hasModels: boolean
  onConnect: () => void
}) {
  const running = status.state === 'running'
  const isDisabled = disabled || running
  const label = running
    ? 'Connecting…'
    : hasModels
      ? 'Reconnect'
      : 'Connect'
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={onConnect}
      disabled={isDisabled}
      title={
        running
          ? 'Contacting provider…'
            : disabled
              ? disabledReason
            : hasModels
              ? 'Re-check available options'
              : 'Validate the API key and check available options'
      }
      leading={
        running ? (
          <Loader2 size={12} className="spin" />
        ) : (
          <Plug size={12} />
        )
      }
    >
      {label}
    </Button>
  )
}

function ConnectStatusBadge({ status }: { status: ConnectStatus }) {
  if (status.state === 'idle' || status.state === 'running') return null
  if (status.state === 'ok') {
    const parts = [`${status.fetched} options`, `${status.durationMs}ms`]
    if (status.added > 0) parts.push(`${status.added} new`)
    if (status.updated > 0) parts.push(`${status.updated} updated`)
    return (
      <span className="llm-models-test-badge is-ok">
        <CheckCircle2 size={11} />
        {parts.join(' · ')}
      </span>
    )
  }
  const prefix = status.status != null ? `${status.status} ` : ''
  return (
    <span className="llm-models-test-badge is-err" title={status.message}>
      <XCircle size={11} />
      {prefix}
      {truncate(status.message, 64)}
    </span>
  )
}
