// Session-scoped model-routing state.
//
// Deliberately NOT persisted: `/model` and `/effort` are temporary
// mid-conversation knobs. To change defaults across sessions, users still
// edit Settings → Models. That split keeps "my normal setup" in the
// durable store (`llm-config-store`) and "right now I want Opus for this
// thread" in this one.

import { create } from 'zustand'
import type { ModelBinding } from './types'
import type { ReasoningEffort } from '../../types/llm'

interface ModelRouteState {
  /** Partial binding merged on top of mode defaults. Any field populated
   *  here (providerId, modelId, reasoningEffort) overrides that slot. */
  override: ModelBinding

  setOverride: (patch: Partial<ModelBinding>) => void
  clearModelOverride: () => void
  clearAllOverrides: () => void
  setEffortOverride: (effort: ReasoningEffort | null) => void
}

export const useModelRouteStore = create<ModelRouteState>((set) => ({
  override: {},

  setOverride: (patch) =>
    set((s) => ({ override: { ...s.override, ...patch } })),

  /** Drop only the model selection (providerId + modelId); keeps effort
   *  in place so `/model` reset doesn't also undo `/effort`. */
  clearModelOverride: () =>
    set((s) => {
      const { providerId: _p, modelId: _m, ...rest } = s.override
      return { override: rest }
    }),

  clearAllOverrides: () => set({ override: {} }),

  setEffortOverride: (effort) =>
    set((s) => ({
      override: effort
        ? { ...s.override, reasoningEffort: effort }
        : dropKey(s.override, 'reasoningEffort'),
    })),
}))

function dropKey<T extends object, K extends keyof T>(obj: T, key: K): T {
  const { [key]: _, ...rest } = obj
  return rest as T
}
