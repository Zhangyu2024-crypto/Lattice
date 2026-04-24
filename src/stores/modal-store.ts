// Global modal / overlay state.
//
// Previously App.tsx owned ten `useState` slots for Settings / Library /
// Knowledge / Pro Launcher / Command Palette / Compute Overlay / Creator
// / Paper Reader and drilled the setters through props (`useAppShortcuts`
// and ActivityBar needed several of them). Every new modal meant another
// pair of state + prop threaded through a growing surface.
//
// Hoisting to Zustand lets any component — a command-palette entry, a
// bus listener, an agent-tool response card — pop open a modal without
// routing through App.tsx. App keeps its role as the renderer that
// mounts the modals when their `open` flag flips, but it no longer owns
// the state.
//
// One-shot fields (`computeSpawn`, `computeFocusCellId`) stay in the
// store so any opener can seed them, and `consumeComputeSpawn()` /
// `consumeComputeFocusCell()` clear them once the overlay has applied
// the payload — matching the pre-refactor semantics exactly.

import { create } from 'zustand'
import type { OpenComputeOverlayRequest } from '../lib/compute-overlay-bus'
import type { SettingsTabId } from '../components/layout/SettingsModal'

export interface PaperReaderTarget {
  sessionId: string
  artifactId: string
}

export interface CreatorOverlayTarget {
  sessionId: string
  artifactId: string
}

interface ModalState {
  paletteOpen: boolean
  settingsOpen: boolean
  settingsTab: SettingsTabId
  libraryOpen: boolean
  knowledgeOpen: boolean
  proLauncherOpen: boolean
  paperReader: PaperReaderTarget | null
  computeOverlayOpen: boolean
  computeSpawn: OpenComputeOverlayRequest['spawnCell'] | null
  computeFocusCellId: string | null
  creatorOverlay: CreatorOverlayTarget | null
  artifactOverlay: { sessionId: string; artifactId: string } | null

  setPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean, tab?: SettingsTabId) => void
  toggleSettingsTab: (tab: SettingsTabId) => void
  setLibraryOpen: (open: boolean) => void
  setKnowledgeOpen: (open: boolean) => void
  setProLauncherOpen: (open: boolean) => void
  setPaperReader: (target: PaperReaderTarget | null) => void
  openComputeOverlay: (req?: OpenComputeOverlayRequest) => void
  closeComputeOverlay: () => void
  consumeComputeSpawn: () => void
  consumeComputeFocusCell: () => void
  setCreatorOverlay: (target: CreatorOverlayTarget | null) => void
  setArtifactOverlay: (target: { sessionId: string; artifactId: string } | null) => void
}

export const useModalStore = create<ModalState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  settingsTab: 'general',
  libraryOpen: false,
  knowledgeOpen: false,
  proLauncherOpen: false,
  paperReader: null,
  computeOverlayOpen: false,
  computeSpawn: null,
  computeFocusCellId: null,
  creatorOverlay: null,
  artifactOverlay: null,

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),

  setSettingsOpen: (settingsOpen, tab) =>
    set((s) =>
      tab ? { settingsOpen, settingsTab: tab } : { settingsOpen },
    ),
  toggleSettingsTab: (tab) =>
    set((s) => {
      // Tab-button behaviour: if the requested tab is already open,
      // close the modal; otherwise open it (and switch to the tab when
      // it's a different one). Matches the old `setSettingsOpen((open)
      // => !(open && settingsTab === tab))` + tab-set combo at App:756.
      if (s.settingsOpen && s.settingsTab === tab) {
        return { settingsOpen: false }
      }
      return { settingsOpen: true, settingsTab: tab }
    }),

  setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
  setKnowledgeOpen: (knowledgeOpen) => set({ knowledgeOpen }),
  setProLauncherOpen: (proLauncherOpen) => set({ proLauncherOpen }),
  setPaperReader: (paperReader) => set({ paperReader }),

  openComputeOverlay: (req) =>
    set({
      computeOverlayOpen: true,
      computeSpawn: req?.spawnCell ?? null,
      computeFocusCellId: req?.focusCellId ?? null,
    }),
  closeComputeOverlay: () =>
    set({
      computeOverlayOpen: false,
      computeSpawn: null,
      computeFocusCellId: null,
    }),
  consumeComputeSpawn: () => set({ computeSpawn: null }),
  consumeComputeFocusCell: () => set({ computeFocusCellId: null }),

  setCreatorOverlay: (creatorOverlay) => set({ creatorOverlay }),
  setArtifactOverlay: (artifactOverlay) => set({ artifactOverlay }),
}))
