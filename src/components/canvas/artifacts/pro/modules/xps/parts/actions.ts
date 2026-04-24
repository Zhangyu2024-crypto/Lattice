// Shape of the action bag returned by the XPS module's `useActions` hook.
// Extracted so sibling `parts/*` files (MainViz, Footer, commands) can
// import the type without pulling on the hook implementation in the
// module's index.

import type { XpsProPayload, XpsProPeakDef, XrdProPeak } from '@/types/artifact'
import type { useChartExporter } from '@/hooks/useChartExporter'

export interface XpsActions {
  busy: string | null
  chartExporter: ReturnType<typeof useChartExporter>
  focusedPeakIdx: number | null
  setFocusedPeakIdx(idx: number | null): void
  setParams(update: (p: XpsProPayload['params']) => XpsProPayload['params']): void
  handleRestoreParams(snapshot: unknown): void
  handleAssessQuality(): void
  handleChargeCorrect(): void
  handleDetectPeaks(): void
  handleUpdateDetectedPeak(idx: number, patch: Partial<XrdProPeak>): void
  handleRemoveDetectedPeak(idx: number): void
  handleAddBlankDetectedPeak(): void
  handleAddPeakDef(type: 'single' | 'doublet'): void
  handleRemovePeakDef(id: string): void
  handleUpdatePeakDef(id: string, patch: Partial<XpsProPeakDef>): void
  handleFit(): void
  handleQuantify(): void
  handleLookup(): void
  handleAddPatternOverlay(file: File): Promise<void>
  handleToggleOverlayVisibility(id: string): void
  handleRemovePatternOverlay(id: string): void
  handleClearPatternOverlays(): void
  handleResetEnergyWindow(): void
  handleExport(): void
}
