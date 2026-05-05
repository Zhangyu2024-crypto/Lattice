import { describe, expect, it } from 'vitest'
import { BUILT_IN_PROVIDERS, createDefaultProviders } from './llm-defaults'

describe('LLM built-in provider defaults', () => {
  it('ships without API keys or enabled providers', () => {
    for (const provider of BUILT_IN_PROVIDERS) {
      expect(provider.enabled).toBe(false)
      expect(provider.apiKey).toBeUndefined()
      expect(provider.baseUrl).not.toMatch(/claw-d/i)
      expect(provider.models).toEqual([])
    }
  })

  it('does not include the removed local dev proxy', () => {
    const providers = createDefaultProviders()
    expect(providers.map((provider) => provider.id)).not.toContain('clawd-proxy')
    expect(JSON.stringify(providers)).not.toMatch(/sk-[A-Za-z0-9_-]+/)
    expect(JSON.stringify(providers)).not.toMatch(/sonnet|gpt-4o/i)
  })
})
