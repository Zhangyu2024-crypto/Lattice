// Persisted store for Pro Workbench Vars-Tab pins.
//
// Users mark rows in the Vars tab as "pinned" to surface them at the top
// of the tab as live chips — no more scrolling past ten sections to check
// the current Rwp. Persistence is per-artifact-id so each workbench has
// its own pinned set and reloading the app doesn't blow them away.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ArtifactId } from '@/types/artifact'

export interface ProPinKey {
  /** Vars schema section title (e.g. "Fit"). */
  section: string
  /** Row `key` within that section. Unique within its section. */
  row: string
}

interface ProPinsState {
  /** artifactId → list of pinned row keys, in pin order (newest last). */
  pins: Record<ArtifactId, ProPinKey[]>
  togglePin(artifactId: ArtifactId, pin: ProPinKey): void
  isPinned(artifactId: ArtifactId, pin: ProPinKey): boolean
  listPins(artifactId: ArtifactId): ProPinKey[]
  clearPins(artifactId: ArtifactId): void
}

const MAX_PINS_PER_ARTIFACT = 8

function keyEq(a: ProPinKey, b: ProPinKey): boolean {
  return a.section === b.section && a.row === b.row
}

export const useProPinsStore = create<ProPinsState>()(
  persist(
    (set, get) => ({
      pins: {},
      togglePin: (artifactId, pin) =>
        set((s) => {
          const current = s.pins[artifactId] ?? []
          const idx = current.findIndex((p) => keyEq(p, pin))
          if (idx >= 0) {
            const next = current.slice()
            next.splice(idx, 1)
            return { pins: { ...s.pins, [artifactId]: next } }
          }
          // Cap to keep the pinned strip from growing unboundedly — oldest
          // pins fall off when the cap is exceeded.
          const next = [...current, pin].slice(-MAX_PINS_PER_ARTIFACT)
          return { pins: { ...s.pins, [artifactId]: next } }
        }),
      isPinned: (artifactId, pin) => {
        const list = get().pins[artifactId] ?? []
        return list.some((p) => keyEq(p, pin))
      },
      listPins: (artifactId) => get().pins[artifactId] ?? [],
      clearPins: (artifactId) =>
        set((s) => {
          if (!s.pins[artifactId]) return s
          const next = { ...s.pins }
          delete next[artifactId]
          return { pins: next }
        }),
    }),
    {
      name: 'lattice.pro-pins',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
