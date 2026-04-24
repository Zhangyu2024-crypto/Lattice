// Shape of the action bag returned by the Curve module's `useActions`
// hook. Extracted so sibling `parts/*` files (MainViz, Footer, commands,
// DataTabs) can import the type without pulling on the hook implementation
// in the module's index.

import type { CurveFeature, CurveProPayload } from '@/types/artifact'
import type { useChartExporter } from '@/hooks/useChartExporter'

export interface CurveActions {
  busy: string | null
  chartExporter: ReturnType<typeof useChartExporter>
  focusedPeakIdx: number | null
  setFocusedPeakIdx(idx: number | null): void
  setParams(
    update: (p: CurveProPayload['params']) => CurveProPayload['params'],
  ): void
  handleRestoreParams(snapshot: unknown): void
  handleAssessQuality(): void
  handleSmooth(): void
  handleBaseline(): void
  handleDetectPeaks(): void
  handleUpdateFeature(idx: number, patch: Partial<CurveFeature>): void
  handleRemoveFeature(idx: number): void
  handleAddBlankFeature(): void
  handleExport(): void
}
