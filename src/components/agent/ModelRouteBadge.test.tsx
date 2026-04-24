import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ModelRouteBadge from './ModelRouteBadge'
import { useModelRouteStore } from '../../lib/model-routing'
import { useLLMConfigStore } from '../../stores/llm-config-store'

beforeEach(() => {
  useModelRouteStore.getState().clearAllOverrides()
  // Seed the config store with one fake provider so the MODEL tooltip
  // formatter has something to resolve against. A second test exercises
  // the "unknown ids" fallback where the provider is absent.
  useLLMConfigStore.setState((s) => ({
    ...s,
    providers: [
      {
        id: 'prov-a',
        name: 'Provider A',
        type: 'anthropic',
        apiKey: 'x',
        enabled: true,
        baseUrl: '',
        extraHeaders: [],
        models: [
          {
            id: 'model-x',
            label: 'Model X',
            contextTokens: 100000,
            supportsTools: true,
            supportsImages: false,
          },
        ],
      } as unknown as ReturnType<
        typeof useLLMConfigStore.getState
      >['providers'][number],
    ],
  }))
})

describe('ModelRouteBadge', () => {
  it('renders nothing when no overrides are active', () => {
    const { container } = render(<ModelRouteBadge />)
    expect(container.firstChild).toBeNull()
  })

  it('shows MODEL pill with resolved tooltip when override points at a known model', () => {
    useModelRouteStore.getState().setOverride({
      providerId: 'prov-a',
      modelId: 'model-x',
    })
    render(<ModelRouteBadge />)
    const pill = screen.getByText('MODEL')
    expect(pill).toBeInTheDocument()
    expect(pill.getAttribute('title')).toContain('Provider A → Model X')
  })

  it('falls back to raw ids in tooltip when override target is not in the catalog', () => {
    useModelRouteStore.getState().setOverride({
      providerId: 'ghost',
      modelId: 'phantom',
    })
    render(<ModelRouteBadge />)
    const pill = screen.getByText('MODEL')
    expect(pill.getAttribute('title')).toContain('ghost/phantom')
  })

  it('shows EFFORT pill when effort override is set without fast mode', () => {
    useModelRouteStore.getState().setEffortOverride('high')
    render(<ModelRouteBadge />)
    expect(screen.getByText('EFFORT:HIGH')).toBeInTheDocument()
  })

  it('clear button resets all overrides', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({
      providerId: 'prov-a',
      modelId: 'model-x',
      reasoningEffort: 'high',
    })
    render(<ModelRouteBadge />)
    fireEvent.click(screen.getByLabelText('Clear model overrides'))
    expect(useModelRouteStore.getState().override).toEqual({})
  })
})
