import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ComposerMode } from '../types/llm'
import { genShortId } from '../lib/id-gen'
import type { PermissionMode } from '../types/permission-mode'
import { PERMISSION_MODES } from '../types/permission-mode'

export interface ParamPreset {
  id: string
  name: string
  description?: string
  params: Record<string, unknown>
  createdAt: number
}

export type Theme = 'dark' | 'light'

export type SidebarView =
  | 'session'
  | 'library'
  | 'knowledge'
  | 'writing'
  | 'explorer'
  | 'data'
  | 'artifact-db'

/** Right-rail inner tab. Mirrors `WorkspaceRailTab` in components/layout;
 *  duplicated here as a string literal to avoid a store→component import. */
export type RightRailTab = 'agent' | 'details'

/** Per-Pro-workbench panel sizes, persisted so users don't have to
 *  re-tune the inspector / data-tabs split on every session. */
export interface ProWorkbenchLayout {
  inspectorWidth: number
  dataTabsHeight: number
}

export interface LayoutPrefs {
  activeView: SidebarView
  sidebarVisible: boolean
  chatVisible: boolean
  sidebarWidth: number
  chatWidth: number
  editorPaneHeight: number
  inspectorVisible: boolean
  inspectorWidth: number
  /** Last user-selected inner tab of the right rail. Persisted so toggling
   *  the rail closed/open restores the previous sub-view, and so rapid
   *  keyboard toggles read a single store snapshot (no React-state race). */
  lastRightRailTab: RightRailTab
  /** Pro workbench inspector / data-tabs split, shared across all Pro
   *  workbench instances (XRD / XPS / Raman). */
  proWorkbench: ProWorkbenchLayout
}

/** Phase B+ · approval gate policy. Maps TrustLevel → "auto"|"ask".
 *  Default: safe+sandboxed auto, localWrite auto (but orchestrator still
 *  surfaces a tag in TaskTimeline), hostExec ask. Users can tighten
 *  localWrite to "ask" or loosen hostExec to "auto" for trusted sessions. */
export interface AgentApprovalPrefs {
  localWrite: 'auto' | 'ask'
  hostExec: 'auto' | 'ask'
}

interface PrefsState {
  theme: Theme
  presets: ParamPreset[]
  composerMode: ComposerMode
  layout: LayoutPrefs
  agentApproval: AgentApprovalPrefs
  /** Session-level approval preset; a single dropdown overrides per-tool
   *  ask/auto behavior for everything in the chat. See
   *  `src/types/permission-mode.ts` for the 4 modes and their matrix. */
  permissionMode: PermissionMode

  setTheme: (theme: Theme) => void
  setComposerMode: (mode: ComposerMode) => void
  setLayout: (patch: Partial<LayoutPrefs>) => void
  setActiveView: (view: SidebarView) => void
  addPreset: (preset: Omit<ParamPreset, 'id' | 'createdAt'>) => string
  removePreset: (id: string) => void
  renamePreset: (id: string, name: string) => void
  setAgentApproval: (patch: Partial<AgentApprovalPrefs>) => void
  setPermissionMode: (mode: PermissionMode) => void
}

const DEFAULT_AGENT_APPROVAL: AgentApprovalPrefs = {
  localWrite: 'auto',
  hostExec: 'ask',
}

const genId = () => genShortId('prs', 4)

// Layout width bounds mirror the App.tsx drag-resize clamps. Defined once
// here so the store and the drag handler can't drift apart.
export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 500
export const CHAT_WIDTH_MIN = 260
export const CHAT_WIDTH_MAX = 520
export const EDITOR_PANE_HEIGHT_MIN = 180
export const EDITOR_PANE_HEIGHT_MAX = 2400
export const INSPECTOR_WIDTH_MIN = 220
export const INSPECTOR_WIDTH_MAX = 420

// Pro workbench inspector / data-tabs clamp bounds. Match the defaults
// baked into ProWorkbenchShell so persist() migrations round-trip
// cleanly.
export const PRO_INSPECTOR_WIDTH_MIN = 220
export const PRO_INSPECTOR_WIDTH_MAX = 520
export const PRO_DATA_TABS_HEIGHT_MIN = 120
export const PRO_DATA_TABS_HEIGHT_MAX = 600

const DEFAULT_PRO_WORKBENCH: ProWorkbenchLayout = {
  inspectorWidth: 320,
  dataTabsHeight: 280,
}

const DEFAULT_LAYOUT: LayoutPrefs = {
  activeView: 'explorer',
  sidebarVisible: true,
  chatVisible: false,
  sidebarWidth: 260,
  chatWidth: 320,
  editorPaneHeight: 320,
  inspectorVisible: false,
  inspectorWidth: 280,
  lastRightRailTab: 'agent',
  proWorkbench: { ...DEFAULT_PRO_WORKBENCH },
}

const VALID_SIDEBAR_VIEWS: readonly SidebarView[] = [
  'session',
  'library',
  'knowledge',
  'writing',
  'explorer',
  'data',
  'artifact-db',
]

const VALID_RIGHT_RAIL_TABS: readonly RightRailTab[] = ['agent', 'details']

const normalizeActiveView = (value: unknown): SidebarView =>
  VALID_SIDEBAR_VIEWS.includes(value as SidebarView)
    ? (value as SidebarView)
    : DEFAULT_LAYOUT.activeView

const normalizeRightRailTab = (value: unknown): RightRailTab =>
  VALID_RIGHT_RAIL_TABS.includes(value as RightRailTab)
    ? (value as RightRailTab)
    : DEFAULT_LAYOUT.lastRightRailTab

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.max(min, Math.min(max, value)))
}

// Coerce an untrusted layout patch (from migrate or setLayout) into a
// fully-populated, in-range LayoutPrefs. Tolerant of missing fields and
// out-of-range numbers so persisted state from older versions never lands
// a bad value into the live store.
const normalizeLayout = (layout?: Partial<LayoutPrefs>): LayoutPrefs => ({
  activeView: normalizeActiveView(layout?.activeView),
  sidebarVisible:
    typeof layout?.sidebarVisible === 'boolean'
      ? layout.sidebarVisible
      : DEFAULT_LAYOUT.sidebarVisible,
  chatVisible:
    typeof layout?.chatVisible === 'boolean'
      ? layout.chatVisible
      : DEFAULT_LAYOUT.chatVisible,
  inspectorVisible:
    typeof layout?.inspectorVisible === 'boolean'
      ? layout.inspectorVisible
      : DEFAULT_LAYOUT.inspectorVisible,
  sidebarWidth: clampInt(
    layout?.sidebarWidth,
    DEFAULT_LAYOUT.sidebarWidth,
    SIDEBAR_WIDTH_MIN,
    SIDEBAR_WIDTH_MAX,
  ),
  chatWidth: clampInt(
    layout?.chatWidth,
    DEFAULT_LAYOUT.chatWidth,
    CHAT_WIDTH_MIN,
    CHAT_WIDTH_MAX,
  ),
  editorPaneHeight: clampInt(
    layout?.editorPaneHeight,
    DEFAULT_LAYOUT.editorPaneHeight,
    EDITOR_PANE_HEIGHT_MIN,
    EDITOR_PANE_HEIGHT_MAX,
  ),
  inspectorWidth: clampInt(
    layout?.inspectorWidth,
    DEFAULT_LAYOUT.inspectorWidth,
    INSPECTOR_WIDTH_MIN,
    INSPECTOR_WIDTH_MAX,
  ),
  lastRightRailTab: normalizeRightRailTab(layout?.lastRightRailTab),
  proWorkbench: {
    inspectorWidth: clampInt(
      layout?.proWorkbench?.inspectorWidth,
      DEFAULT_PRO_WORKBENCH.inspectorWidth,
      PRO_INSPECTOR_WIDTH_MIN,
      PRO_INSPECTOR_WIDTH_MAX,
    ),
    dataTabsHeight: clampInt(
      layout?.proWorkbench?.dataTabsHeight,
      DEFAULT_PRO_WORKBENCH.dataTabsHeight,
      PRO_DATA_TABS_HEIGHT_MIN,
      PRO_DATA_TABS_HEIGHT_MAX,
    ),
  },
})

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      presets: [],
      composerMode: 'agent',
      layout: { ...DEFAULT_LAYOUT },
      agentApproval: { ...DEFAULT_AGENT_APPROVAL },
      permissionMode: 'normal',

      setTheme: (theme) => set({ theme }),
      setPermissionMode: (permissionMode) => {
        // Persisted values could theoretically drift (older serialized
        // state, hand-edited localStorage) — guard the setter so only a
        // known mode lands in the store.
        if (!PERMISSION_MODES.includes(permissionMode)) return
        set({ permissionMode })
      },
      setComposerMode: (composerMode) =>
        set({
          composerMode: composerMode === 'dialog' ? 'agent' : composerMode,
        }),
      setAgentApproval: (patch) =>
        set((state) => ({
          agentApproval: { ...state.agentApproval, ...patch },
        })),

      // Accepts a partial patch; normalises so callers can't persist NaN /
      // out-of-range widths from bugs in drag-resize logic.
      setLayout: (patch) =>
        set((s) => ({ layout: normalizeLayout({ ...s.layout, ...patch }) })),

      setActiveView: (activeView) =>
        set((s) => ({ layout: normalizeLayout({ ...s.layout, activeView }) })),

      addPreset: (preset) => {
        const full: ParamPreset = {
          ...preset,
          id: genId(),
          createdAt: Date.now(),
        }
        set((s) => ({ presets: [...s.presets, full] }))
        return full.id
      },

      removePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      renamePreset: (id, name) =>
        set((s) => ({
          presets: s.presets.map((p) => (p.id === id ? { ...p, name } : p)),
        })),
    }),
    {
      name: 'lattice.prefs',
      version: 17,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        ...state,
        permissionMode: 'normal' as PermissionMode,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PrefsState>),
        permissionMode: 'normal' as PermissionMode,
      }),
      // v2 introduces `layout`. v3 extends with inspector visibility + width.
      // v4 adds `layout.activeView`. v5 drops `agentModel` (moved to
      // llm-config-store.agent.{providerId,modelId}). v6 removes the old
      // library/knowledge pseudo-sidebar views and normalises them back to
      // the real shell views (`session` / `compute`). v7 adds
      // `layout.lastRightRailTab` so toggling the right rail or hammering
      // Ctrl+Shift+I reads a persisted snapshot instead of React state.
      // v8 adds `layout.proWorkbench` (inspectorWidth / dataTabsHeight).
      // v9 restores first-class sidebar spaces for library / knowledge /
      // research. v10 defaults the right rail to closed — the inspector
      // panel is empty on cold start and would waste a wide rail.
      // v11 drops dialog-only composer UI: coerce persisted `dialog` to
      // `agent`.
      // v12 replaces activity-bar `research` sidebar with `spectrum`
      // (spectral analysis); research flows remain in the workspace rail.
      // v13 adds 'explorer' sidebar view for the new file-centric
      // workspace; `normalizeActiveView` falls back to 'session' for
      // any unknown value in older persisted states.
      // v14 adds 'data' sidebar view for the data management panel.
      // v15 adds `permissionMode`. It now resets to Normal on hydrate via
      // merge/partialize so risky modes never persist across app restarts.
      // v16 adds `layout.editorPaneHeight` for the workspace editor/chat
      // vertical splitter.
      // v17 retires Creator as a sidebar view. The activity-bar Creator
      // button now opens the dedicated LaTeX document surface directly.
      // migrate-forward fills defaults via normalizeLayout so legacy
      // persisted states round-trip cleanly.
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<PrefsState> & {
          agentModel?: unknown
          layout?: Partial<LayoutPrefs>
        }
        const { agentModel: _legacyAgentModel, ...rest } = state
        void _legacyAgentModel
        const composerMode =
          rest.composerMode === 'dialog' ? 'agent' : rest.composerMode ?? 'agent'
        // Legacy values map forward: `research` (v11) and `spectrum` (v14,
        // the floating Spectrum-analysis launcher) were both retired once
        // the Pro workbench moved to its own window. `writing` (v17) is
        // likewise a dedicated Creator surface now, not a sidebar. Route
        // all retired sidebar preferences to the file-first explorer.
        const rawView = state.layout?.activeView as
          | SidebarView
          | 'research'
          | 'spectrum'
          | undefined
        const activeView =
          rawView === 'research' ||
          rawView === 'spectrum' ||
          rawView === 'writing'
            ? 'explorer'
            : rawView === 'session'
              ? 'explorer'
              : normalizeActiveView(rawView)
        return {
          ...rest,
          composerMode,
          layout: normalizeLayout({
            ...state.layout,
            activeView,
            chatVisible: false,
          }),
        }
      },
    },
  ),
)
