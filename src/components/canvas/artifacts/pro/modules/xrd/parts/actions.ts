// Shape of the action bag returned by the XRD module's `useActions` hook.
// Extracted so sibling `parts/*` files (MainViz, Footer, commands) can
// import the type without pulling on the hook implementation in the
// module's index.

import type { XrdProPayload, XrdProPeak } from '@/types/artifact'
import type { useChartExporter } from '@/hooks/useChartExporter'

export interface XrdActions {
  busy: string | null
  chartExporter: ReturnType<typeof useChartExporter>
  focusedPeakIdx: number | null
  setFocusedPeakIdx(idx: number | null): void
  setParams(update: (p: XrdProPayload['params']) => XrdProPayload['params']): void
  /** Restore params from a history record's snapshot. Accepts `unknown`
   *  because the rail is shape-agnostic; we narrow at the call site. */
  handleRestoreParams(snapshot: unknown): void
  handleAssessQuality(): void
  handleDetectPeaks(): void
  handleClearPeaks(): void
  handleManualAddPeak(position: number, intensity: number): void
  handleRemovePeak(idx: number): void
  handleUpdatePeak(idx: number, patch: Partial<XrdProPeak>): void
  handleAddBlankPeak(): void
  handleSearchDb(): void
  handleToggleCandidate(idx: number): void
  handleToggleCandidateOverlay(idx: number): void
  handleToggleCandidateSimulate(idx: number): void
  handleAddPatternOverlay(file: File): Promise<void>
  handleToggleOverlayVisibility(id: string): void
  handleRemovePatternOverlay(id: string): void
  handleClearPatternOverlays(): void
  handleAddCif(file: File): Promise<void>
  handleToggleCifSelection(id: string): void
  handleRemoveCif(id: string): void
  handleRefine(): void
  handleExportCif(): void
  handleExportCsv(): void
  handleSnapshot(): void
  handleApplyPreset(key: string): void
}
