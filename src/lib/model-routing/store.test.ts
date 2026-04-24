import { beforeEach, describe, expect, it } from 'vitest'
import { useModelRouteStore } from './store'

beforeEach(() => {
  useModelRouteStore.getState().clearAllOverrides()
})

describe('useModelRouteStore', () => {
  it('setOverride merges fields without clobbering others', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({ providerId: 'p1' })
    s.setOverride({ modelId: 'm1' })
    expect(useModelRouteStore.getState().override).toEqual({
      providerId: 'p1',
      modelId: 'm1',
    })
  })

  it('clearModelOverride keeps effort', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({
      providerId: 'p1',
      modelId: 'm1',
      reasoningEffort: 'high',
    })
    s.clearModelOverride()
    expect(useModelRouteStore.getState().override).toEqual({
      reasoningEffort: 'high',
    })
  })

  it('setEffortOverride sets and replaces effort without touching model', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({ providerId: 'p1', modelId: 'm1' })
    s.setEffortOverride('high')
    expect(useModelRouteStore.getState().override).toEqual({
      providerId: 'p1',
      modelId: 'm1',
      reasoningEffort: 'high',
    })
  })

  it('setEffortOverride(null) clears effort but not model', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({ providerId: 'p1', modelId: 'm1', reasoningEffort: 'high' })
    s.setEffortOverride(null)
    expect(useModelRouteStore.getState().override).toEqual({
      providerId: 'p1',
      modelId: 'm1',
    })
  })

  it('clearAllOverrides resets to empty state', () => {
    const s = useModelRouteStore.getState()
    s.setOverride({ providerId: 'p1', modelId: 'm1', reasoningEffort: 'low' })
    s.clearAllOverrides()
    expect(useModelRouteStore.getState().override).toEqual({})
  })
})
