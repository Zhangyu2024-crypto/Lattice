import { describe, expect, it } from 'vitest'
import { resolveEffectiveBinding } from './resolve'

const AGENT_DEFAULT = {
  providerId: 'prov-default',
  modelId: 'model-default',
  reasoningEffort: 'medium' as const,
}

describe('resolveEffectiveBinding', () => {
  it('returns mode default when nothing else is set', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
    })
    expect(out).toMatchObject({
      providerId: 'prov-default',
      modelId: 'model-default',
      reasoningEffort: 'medium',
      winner: 'mode-default',
    })
  })

  it('session override wins over mode default', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: { providerId: 'prov-session', modelId: 'model-session' },
    })
    expect(out.providerId).toBe('prov-session')
    expect(out.modelId).toBe('model-session')
    expect(out.reasoningEffort).toBe('medium') // still inherits
    expect(out.winner).toBe('session-override')
  })

  it('skill override wins over session override', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: { providerId: 'prov-session', modelId: 'model-session' },
      skillOverride: { providerId: 'prov-skill', modelId: 'model-skill' },
    })
    expect(out.providerId).toBe('prov-skill')
    expect(out.modelId).toBe('model-skill')
    expect(out.winner).toBe('skill')
  })

  it('per-request override wins over everything', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: { providerId: 'prov-session' },
      skillOverride: { providerId: 'prov-skill' },
      perRequestOverride: { providerId: 'prov-req', modelId: 'model-req' },
    })
    expect(out.providerId).toBe('prov-req')
    expect(out.modelId).toBe('model-req')
    expect(out.winner).toBe('per-request')
  })

  it('merges fields from different layers slot-by-slot', () => {
    // Session sets only provider; skill sets only model; effort falls
    // through to mode default.
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: { providerId: 'prov-session' },
      skillOverride: { modelId: 'model-skill' },
    })
    expect(out.providerId).toBe('prov-session')
    expect(out.modelId).toBe('model-skill')
    expect(out.reasoningEffort).toBe('medium')
  })

  it('reasoningEffort override stands alone', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: { reasoningEffort: 'high' },
    })
    expect(out.reasoningEffort).toBe('high')
    expect(out.providerId).toBe('prov-default')
  })

  it('trace excludes empty session layers', () => {
    const out = resolveEffectiveBinding({
      mode: 'agent',
      modeDefault: AGENT_DEFAULT,
      sessionOverride: {},
    })
    const sources = out.trace.map((l) => l.source)
    expect(sources).toEqual(['mode-default'])
  })
})
