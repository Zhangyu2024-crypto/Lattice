import { describe, expect, it } from 'vitest'
import { mergeFetchedModels } from './llm-model-catalog'
import type { LLMModel } from '../types/llm'

const model = (id: string, patch: Partial<LLMModel> = {}): LLMModel => ({
  id,
  label: id,
  contextWindow: 128_000,
  maxOutputTokens: 4096,
  pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  supportsTools: true,
  supportsVision: false,
  supportsCaching: false,
  ...patch,
})

describe('mergeFetchedModels', () => {
  it('uses the fetched catalog as authoritative and preserves local settings on matching ids', () => {
    const existing = [
      model('model-a', {
        label: 'Old Model A',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        pricing: { inputPerMillion: 1.25, outputPerMillion: 2.5 },
        supportsTools: false,
        supportsVision: true,
        supportsCaching: true,
        description: 'custom note',
      }),
      model('stale-model'),
    ]

    const result = mergeFetchedModels(
      existing,
      [
        { id: 'model-a', displayName: 'Server Model A' },
        { id: 'model-b', displayName: 'Server Model B' },
      ],
      'openai-compatible',
    )

    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.models.map((m) => m.id)).toEqual(['model-a', 'model-b'])

    expect(result.models[0]).toMatchObject({
      id: 'model-a',
      label: 'Server Model A',
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      pricing: { inputPerMillion: 1.25, outputPerMillion: 2.5 },
      supportsTools: false,
      supportsVision: true,
      supportsCaching: true,
      description: 'custom note',
    })
    expect(result.models[1]).toMatchObject({
      id: 'model-b',
      label: 'Server Model B',
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    })
  })

  it('clears stale local models when the provider returns an empty catalog', () => {
    const result = mergeFetchedModels(
      [model('old-a'), model('old-b')],
      [],
      'openai-compatible',
    )

    expect(result.models).toEqual([])
    expect(result.added).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.removed).toBe(2)
  })
})
