/**
 * One entry in the command palette. Kept intentionally flat — anything the
 * user can actually run goes here, regardless of origin (session, demo,
 * cross-workbench bridge, agent prompt).
 *
 * `id` doubles as a DOM id and as the routing key for `categoryOf` in
 * `helpers.ts`; changing an id changes the badge the row renders.
 */
export interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

/**
 * Props for the top-level `CommandPalette` component. Each callback is
 * forwarded verbatim to the matching builder; the palette itself owns no
 * business logic.
 */
export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onLoadDemo: () => void
  onToggleSidebar: () => void
  onToggleChat: () => void
  onOpenFile: () => void
  onNewSession: () => void
  onExportSession: () => void
  onLoadXrdDemo: () => void
  onLoadXpsDemo: () => void
  onLoadRamanDemo: () => void
  onLoadJobDemo: () => void
  onLoadComputeDemo: () => void
  onLoadStructureDemo: () => void
  onLoadResearchDemo: () => void
  onLoadBatchDemo: () => void
  onLoadMaterialCompareDemo: () => void
  onLoadSimilarityDemo: () => void
  onLoadOptimizationDemo: () => void
  onLoadHypothesisDemo: () => void
  onLoadLatexDemo?: () => void
  onOpenLibrary: () => void
  onExportSessionZip: () => void
  onMockAgentStream?: () => void
  onRunAgent: (prompt: string) => void
  onStartResearch: () => void
  canRunDomainCommand: boolean
  onOpenProWorkbench: (
    kind: 'xrd-pro' | 'xps-pro' | 'raman-pro' | 'spectrum-pro' | 'compute-pro',
    technique?: 'xrd' | 'xps' | 'raman' | 'ftir',
  ) => void
}

/** Callback-only subset used by builders that don't need the full props object. */
export type OpenProWorkbench = CommandPaletteProps['onOpenProWorkbench']
