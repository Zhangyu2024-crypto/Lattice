import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface EditorGroup {
  id: string
  tabs: string[]
  activeTab: string | null
}

export interface OpenFileMeta {
  dirty: boolean
  lastOpenedAt: number
}

export type EditorSaver = () => Promise<void>

interface EditorState {
  groups: EditorGroup[]
  activeGroupId: string
  openFiles: Record<string, OpenFileMeta>
  // Phase 4 wires streaming chat writes here; Phase 2 only reserves the slot.
  activeChatFile: string | null
  /**
   * Runtime-only saver registry. Each editable editor publishes a bound
   * `save()` closure here on mount, so the global Ctrl+S handler in the
   * editor area can dispatch the save without reaching into per-editor
   * state. Keyed by POSIX relPath; excluded from persistence because the
   * closures are tied to live component instances.
   */
  savers: Record<string, EditorSaver>

  openFile: (relPath: string, groupId?: string) => void
  closeFile: (relPath: string, groupId: string) => void
  setActiveTab: (groupId: string, relPath: string) => void
  setActiveGroup: (groupId: string) => void
  splitRight: () => string
  moveTabToGroup: (
    relPath: string,
    fromGroupId: string,
    toGroupId: string,
    index?: number,
  ) => void
  markDirty: (relPath: string, dirty: boolean) => void
  setActiveChatFile: (relPath: string | null) => void
  registerSaver: (relPath: string, save: EditorSaver) => void
  unregisterSaver: (relPath: string, save: EditorSaver) => void
}

function genGroupId(): string {
  return `eg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function findGroupWithTab(
  groups: EditorGroup[],
  relPath: string,
): EditorGroup | undefined {
  return groups.find((g) => g.tabs.includes(relPath))
}

function pruneOpenFile(
  openFiles: Record<string, OpenFileMeta>,
  groups: EditorGroup[],
  relPath: string,
): Record<string, OpenFileMeta> {
  if (groups.some((g) => g.tabs.includes(relPath))) return openFiles
  const next = { ...openFiles }
  delete next[relPath]
  return next
}

const INITIAL_GROUP_ID = 'eg_default'

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      groups: [{ id: INITIAL_GROUP_ID, tabs: [], activeTab: null }],
      activeGroupId: INITIAL_GROUP_ID,
      openFiles: {},
      activeChatFile: null,
      savers: {},

      openFile: (relPath, groupId) => {
        set((state) => {
          const existing = findGroupWithTab(state.groups, relPath)
          if (existing) {
            return {
              groups: state.groups.map((g) =>
                g.id === existing.id ? { ...g, activeTab: relPath } : g,
              ),
              activeGroupId: existing.id,
              openFiles: {
                ...state.openFiles,
                [relPath]: {
                  dirty: state.openFiles[relPath]?.dirty ?? false,
                  lastOpenedAt: Date.now(),
                },
              },
            }
          }

          const groups = state.groups.length
            ? state.groups
            : [{ id: INITIAL_GROUP_ID, tabs: [], activeTab: null }]
          const targetId =
            groupId && groups.some((g) => g.id === groupId)
              ? groupId
              : (state.activeGroupId &&
                  groups.some((g) => g.id === state.activeGroupId)
                  ? state.activeGroupId
                  : groups[0].id)

          return {
            groups: groups.map((g) =>
              g.id === targetId
                ? {
                    ...g,
                    tabs: [...g.tabs, relPath],
                    activeTab: relPath,
                  }
                : g,
            ),
            activeGroupId: targetId,
            openFiles: {
              ...state.openFiles,
              [relPath]: {
                dirty: state.openFiles[relPath]?.dirty ?? false,
                lastOpenedAt: Date.now(),
              },
            },
          }
        })
      },

      closeFile: (relPath, groupId) => {
        set((state) => {
          let nextActiveGroupId = state.activeGroupId
          const groups = state.groups.map((g) => {
            if (g.id !== groupId) return g
            const idx = g.tabs.indexOf(relPath)
            if (idx < 0) return g
            const nextTabs = g.tabs.filter((t) => t !== relPath)
            let nextActive: string | null = g.activeTab
            if (g.activeTab === relPath) {
              if (nextTabs.length === 0) {
                nextActive = null
              } else {
                const fallbackIdx = Math.min(idx, nextTabs.length - 1)
                nextActive = nextTabs[fallbackIdx]
              }
            }
            return { ...g, tabs: nextTabs, activeTab: nextActive }
          })

          // Drop empty groups except the last remaining one, so the
          // shell never collapses to zero groups.
          const nonEmpty = groups.filter(
            (g) => g.tabs.length > 0 || groups.length === 1,
          )
          const finalGroups =
            nonEmpty.length === 0
              ? [{ id: INITIAL_GROUP_ID, tabs: [], activeTab: null }]
              : nonEmpty

          if (!finalGroups.some((g) => g.id === nextActiveGroupId)) {
            nextActiveGroupId = finalGroups[0].id
          }

          return {
            groups: finalGroups,
            activeGroupId: nextActiveGroupId,
            openFiles: pruneOpenFile(state.openFiles, finalGroups, relPath),
          }
        })
      },

      setActiveTab: (groupId, relPath) => {
        set((state) => ({
          groups: state.groups.map((g) =>
            g.id === groupId && g.tabs.includes(relPath)
              ? { ...g, activeTab: relPath }
              : g,
          ),
          activeGroupId: groupId,
          openFiles: {
            ...state.openFiles,
            [relPath]: {
              dirty: state.openFiles[relPath]?.dirty ?? false,
              lastOpenedAt: Date.now(),
            },
          },
        }))
      },

      setActiveGroup: (groupId) => {
        set((state) =>
          state.groups.some((g) => g.id === groupId)
            ? { activeGroupId: groupId }
            : {},
        )
      },

      splitRight: () => {
        const id = genGroupId()
        set((state) => {
          if (state.groups.length >= 4) return {}
          return {
            groups: [
              ...state.groups,
              { id, tabs: [], activeTab: null },
            ],
            activeGroupId: id,
          }
        })
        return id
      },

      moveTabToGroup: (relPath, fromGroupId, toGroupId, index) => {
        set((state) => {
          if (fromGroupId === toGroupId) return {}
          const fromGroup = state.groups.find((g) => g.id === fromGroupId)
          const toGroup = state.groups.find((g) => g.id === toGroupId)
          if (!fromGroup || !toGroup) return {}
          if (!fromGroup.tabs.includes(relPath)) return {}
          if (toGroup.tabs.includes(relPath)) return {}

          const groups = state.groups.map((g) => {
            if (g.id === fromGroupId) {
              const nextTabs = g.tabs.filter((t) => t !== relPath)
              const nextActive =
                g.activeTab === relPath
                  ? (nextTabs[0] ?? null)
                  : g.activeTab
              return { ...g, tabs: nextTabs, activeTab: nextActive }
            }
            if (g.id === toGroupId) {
              const insertAt =
                typeof index === 'number'
                  ? Math.max(0, Math.min(index, g.tabs.length))
                  : g.tabs.length
              const nextTabs = [
                ...g.tabs.slice(0, insertAt),
                relPath,
                ...g.tabs.slice(insertAt),
              ]
              return { ...g, tabs: nextTabs, activeTab: relPath }
            }
            return g
          })

          return {
            groups,
            activeGroupId: toGroupId,
          }
        })
      },

      markDirty: (relPath, dirty) => {
        set((state) => {
          const current = state.openFiles[relPath]
          if (!current) return {}
          if (current.dirty === dirty) return {}
          return {
            openFiles: {
              ...state.openFiles,
              [relPath]: { ...current, dirty },
            },
          }
        })
      },

      setActiveChatFile: (relPath) => {
        set({ activeChatFile: relPath })
      },

      registerSaver: (relPath, save) => {
        set((state) => ({
          savers: { ...state.savers, [relPath]: save },
        }))
      },

      unregisterSaver: (relPath, save) => {
        set((state) => {
          // Re-mount races (StrictMode / rapid re-open) can call unregister
          // after a newer saver has already claimed the slot; only delete
          // when the current entry is the one being retired.
          if (state.savers[relPath] !== save) return {}
          const next = { ...state.savers }
          delete next[relPath]
          return { savers: next }
        })
      },
    }),
    {
      name: 'lattice.editor',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        groups: state.groups,
        activeGroupId: state.activeGroupId,
        openFiles: state.openFiles,
        activeChatFile: state.activeChatFile,
      }),
    },
  ),
)

export function selectActiveGroup(state: {
  groups: EditorGroup[]
  activeGroupId: string
}): EditorGroup | undefined {
  return state.groups.find((g) => g.id === state.activeGroupId)
}
