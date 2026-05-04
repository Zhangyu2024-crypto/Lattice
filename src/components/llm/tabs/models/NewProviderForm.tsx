import { useState } from 'react'
import { Save, X } from 'lucide-react'
import Button from '../../../ui/Button'
import { toast } from '../../../../stores/toast-store'
import type { LLMProvider, LLMProviderType } from '../../../../types/llm'
import { DEFAULT_BASE_URL, PROVIDER_TYPE_OPTIONS } from './types'
import { LATTICE_AUTH_API_KEY_REF } from '../../../../lib/lattice-auth-client'

interface NewProviderFormProps {
  onCancel: () => void
  onSubmit: (input: Omit<LLMProvider, 'id'>) => void
}

export default function NewProviderForm({
  onCancel,
  onSubmit,
}: NewProviderFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<LLMProviderType>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL['openai-compatible'])
  const [apiKey, setApiKey] = useState('')

  const handleTypeChange = (next: LLMProviderType) => {
    setType(next)
    const prevDefault = DEFAULT_BASE_URL[type]
    if (!baseUrl.trim() || baseUrl === prevDefault) {
      setBaseUrl(DEFAULT_BASE_URL[next])
    }
  }

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.warn('Provider name is required')
      return
    }
    if (!baseUrl.trim()) {
      toast.warn('Base URL is required')
      return
    }
    if (apiKey.trim() === LATTICE_AUTH_API_KEY_REF) {
      toast.warn('Use "Sign in with chaxiejun.xyz" for the Lattice provider')
      return
    }
    onSubmit({
      name: name.trim(),
      type,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
      enabled: true,
      models: [],
    })
  }

  return (
    <div className="llm-models-form">
      <div className="llm-models-form-title">New provider</div>
      <div className="llm-models-subheading" style={{ marginBottom: 8 }}>
        Enter endpoint + key — models are fetched automatically after you add
        it.
      </div>

      <FormField label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. DeepSeek, Kimi, OpenRouter"
          className="llm-input llm-input--full"
          autoFocus
        />
      </FormField>

      <FormField label="Type">
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as LLMProviderType)}
          className="llm-input llm-input--full"
        >
          {PROVIDER_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Base URL">
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com"
          className="llm-input llm-input--full"
        />
      </FormField>

      <FormField label="API key">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="llm-input llm-input--full"
        />
      </FormField>

      <div className="llm-models-form-action-row">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          leading={<Save size={12} />}
        >
          Add & connect
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          leading={<X size={12} />}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="llm-models-form-field">
      <span className="llm-models-form-field-label">{label}</span>
      {children}
    </label>
  )
}
