// TechniqueModule — declarative per-technique plug-in for UnifiedProWorkbench.
//
// Each technique (XRD / XPS / Raman / FTIR / Curve) exports one module. The
// unified workbench is technique-agnostic: it hosts the `ProWorkbenchShell`
// and pulls chart overlays, data tabs, inspector panel, footer, and command
// definitions from whichever module matches `payload.technique`.
//
// Modules do NOT construct `ProWorkbenchShell` themselves — the shell lives
// in UnifiedProWorkbench so the ribbon / technique switcher / chart mount
// stay shared. Modules provide content slots only.

import type { ReactNode } from 'react'
import type {
  Artifact,
  SpectrumProPayload,
  SpectrumTechnique,
  XrdProPeak,
} from '../../../../../types/artifact'
import type { ProDataTabDef } from '../ProDataTabs'
import type { CommandDef } from '../commandRegistry'

/** The subset of SpectrumProPayload every technique can mutate freely. */
export type SharedPayloadFields = Pick<
  SpectrumProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>

/** Runtime context handed to a module on every render. `patchSubState`
 *  writes to the current technique's slot only (`payload.xrd`, `.xps`, …);
 *  `patchShared` writes to the cross-technique fields.
 *
 *  For legacy artifact kinds (`xrd-pro` / `xps-pro` / …) the two patch
 *  functions are wired so writes land on the matching fields of the legacy
 *  payload shape — the adapter layer inside `UnifiedProWorkbench` hides
 *  this from the module. */
export interface ModuleCtx<Sub = unknown> {
  artifact: Artifact
  sessionId: string
  /** Unified-shaped view of the payload (`technique`, `spectrum`, `xrd`,
   *  `xps`, `raman`, `curve`, and the shared status fields). Legacy kinds
   *  are projected into this shape on read. */
  payload: SpectrumProPayload
  /** The sub-state slot for the active technique (e.g. `payload.xrd`).
   *  Already narrowed for the module author. */
  sub: Sub
  patchShared(partial: Partial<SharedPayloadFields>): void
  patchSubState(partial: Partial<Sub>): void
}

/** Opaque bag returned by a module's `useActions` hook. Modules typically
 *  include both action handlers (functions) and a bit of per-render UI
 *  state (busy key, active inner tab, setters). Kept as `unknown` values
 *  so modules can shape the bag freely via their own `Actions` generic. */
export type ModuleActions = Record<string, unknown>

/** A chart series overlay (background, envelope, residual, etc.) matching
 *  `BuildChartOptionsParams.overlays` in `src/lib/pro-chart.ts`. Re-declared
 *  locally to avoid a module→lib type import cycle. */
export interface ChartOverlay {
  name: string
  x: number[]
  y: number[]
  color: string
  width?: number
  dashed?: boolean
}

/** Shape fed to `buildSpectrumChartOption` for peak markers. XRD/XPS/Raman
 *  already use this shape natively; Curve's `CurveFeature` gets normalised
 *  by the module's `peaksFromSub`. */
export type NormalisedPeak = XrdProPeak

export interface TechniqueModule<Sub = unknown, Actions = ModuleActions> {
  technique: SpectrumTechnique
  /** Display label for the technique switcher, ribbon, and toasts. */
  label: string
  /** Optional icon shown in the technique switcher; if omitted the label
   *  is shown on its own. */
  icon?: ReactNode
  /** Return a fresh sub-state for a brand-new artifact. Matches the
   *  `defaultXrdSubState` / `defaultXpsSubState` / … helpers already in
   *  `src/lib/pro-workbench.ts`. */
  defaultSubState(): Sub
  /** React hook that composes the module's action handlers. Runs on every
   *  render of UnifiedProWorkbench — closures over `ctx` are fresh each
   *  time, so the hook can safely call `useState` / `useCallback` / etc. */
  useActions(ctx: ModuleCtx<Sub>): Actions
  /** Overlays for the primary chart. Pure function of current state. */
  buildOverlays(ctx: ModuleCtx<Sub>): ChartOverlay[]
  /** Main visualisation slot — the chart + any technique-specific
   *  decorations (XPS energy-window strip, Raman waterfall, etc.). The
   *  module owns this so each technique can compose the right layout. */
  renderMainViz(ctx: ModuleCtx<Sub>, actions: Actions): ReactNode
  /** Tab definitions for `ProDataTabs`. The module owns the tab contents. */
  buildDataTabs(ctx: ModuleCtx<Sub>, actions: Actions): ProDataTabDef[]
  /** Right-side inspector pane (parameters, buttons). */
  renderInspector(ctx: ModuleCtx<Sub>, actions: Actions): ReactNode
  /** Bottom footer actions (snapshot, export, …). Return `null` for none. */
  renderFooter(ctx: ModuleCtx<Sub>, actions: Actions): ReactNode | null
  /** Optional right-side content for the top ribbon (action buttons, etc.).
   *  Return `null` or omit for no content. */
  renderRibbonRight?(ctx: ModuleCtx<Sub>, actions: Actions): ReactNode
  /** Commands registered on the palette while this technique is active. */
  commands(ctx: ModuleCtx<Sub>, actions: Actions): CommandDef[]
  /** Normalise peaks for the shared chart option builder. Many modules
   *  return `sub.peaks` directly; Curve flattens its `CurveFeature[]`. */
  peaksFromSub(sub: Sub): NormalisedPeak[]
  /** When true, the technique switcher can toggle into this technique on
   *  a `spectrum-pro` artifact. Legacy kinds (xrd-pro / xps-pro / …)
   *  filter to a single module regardless of this flag. Default: true. */
  selectable?: boolean
}

/** Registry shape exposed by `modules/registry.ts`. Keyed by technique so
 *  UnifiedProWorkbench can pick a module in O(1) on every switch. FTIR
 *  intentionally shares the Raman module instance. */
export type ModuleRegistry = Record<SpectrumTechnique, TechniqueModule<unknown, ModuleActions>>
