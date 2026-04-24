// Shape of the action bag returned by the Raman/FTIR module's `useActions`
// hook. Extracted so sibling `parts/*` files (MainViz, Footer, commands,
// DataTabs) can import the type without pulling on the hook implementation
// in the module's index.

import type { RamanProPayload, XrdProPeak } from '@/types/artifact'
import type { useChartExporter } from '@/hooks/useChartExporter'

export interface RamanActions {
  busy: string | null
  isFtir: boolean
  chartExporter: ReturnType<typeof useChartExporter>
  focusedPeakIdx: number | null
  setFocusedPeakIdx(idx: number | null): void
  setParams(
    update: (p: RamanProPayload['params']) => RamanProPayload['params'],
  ): void
  handleRestoreParams(snapshot: unknown): void
  handleAssessQuality(): void
  handleSmooth(): void
  handleBaseline(): void
  handleDetectPeaks(): void
  handleUpdatePeak(idx: number, patch: Partial<XrdProPeak>): void
  handleRemovePeak(idx: number): void
  handleAddBlankPeak(): void
  handleIdentify(): void
  handleExport(): void
}
