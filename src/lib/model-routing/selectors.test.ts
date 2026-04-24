import { describe, expect, it } from 'vitest'
import { getBrokenBindingMessage, isBindingBroken } from './selectors'
import type { LLMProvider } from '../../types/llm'

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: 'prov-a',
    name: 'Provider A',
    type: 'anthropic',
    apiKey: 'k1',
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
    ...overrides,
  } as unknown as LLMProvider
}

describe('isBindingBroken', () => {
  it('treats null/undefined binding as not-broken (nothing to check)', () => {
    expect(isBindingBroken(undefined, [makeProvider()])).toEqual({
      broken: false,
    })
    expect(isBindingBroken(null, [makeProvider()])).toEqual({ broken: false })
  })

  it('partial binding (missing id) is not broken — resolver merges with mode default', () => {
    expect(
      isBindingBroken({ providerId: 'prov-a' }, [makeProvider()]),
    ).toEqual({ broken: false })
    expect(
      isBindingBroken({ modelId: 'model-x' }, [makeProvider()]),
    ).toEqual({ broken: false })
    expect(
      isBindingBroken({ reasoningEffort: 'high' }, [makeProvider()]),
    ).toEqual({ broken: false })
  })

  it('fully-resolved binding against a healthy provider is not broken', () => {
    const state = isBindingBroken(
      { providerId: 'prov-a', modelId: 'model-x' },
      [makeProvider()],
    )
    expect(state.broken).toBe(false)
  })

  it('flags provider-missing', () => {
    const state = isBindingBroken(
      { providerId: 'ghost', modelId: 'whatever' },
      [makeProvider()],
    )
    expect(state.broken).toBe(true)
    expect(state.reason).toBe('provider-missing')
    expect(getBrokenBindingMessage(state)).toMatch(/no longer exists/)
  })

  it('flags provider-disabled', () => {
    const state = isBindingBroken(
      { providerId: 'prov-a', modelId: 'model-x' },
      [makeProvider({ enabled: false })],
    )
    expect(state.reason).toBe('provider-disabled')
    expect(getBrokenBindingMessage(state)).toMatch(/disabled/)
  })

  it('flags provider-no-key', () => {
    const state = isBindingBroken(
      { providerId: 'prov-a', modelId: 'model-x' },
      [makeProvider({ apiKey: '' })],
    )
    expect(state.reason).toBe('provider-no-key')
    expect(getBrokenBindingMessage(state)).toMatch(/no API key/)
  })

  it('flags model-missing', () => {
    const state = isBindingBroken(
      { providerId: 'prov-a', modelId: 'nope' },
      [makeProvider()],
    )
    expect(state.reason).toBe('model-missing')
    expect(getBrokenBindingMessage(state)).toMatch(/not in the provider/)
  })

  it('getBrokenBindingMessage returns empty for healthy state', () => {
    expect(getBrokenBindingMessage({ broken: false })).toBe('')
  })
})
