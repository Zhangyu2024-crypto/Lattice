// Data-tab definitions for the Raman/FTIR module. The peak-column config
// branches on `actions.isFtir` so the same module can serve both techniques
// with technique-appropriate axis labels ("Shift" vs "Wavenumber"). Kept
// split from `index.tsx` so tab-only UI tweaks don't churn the handler
// surface.

import type { RamanSubState, XrdProPeak } from '@/types/artifact'
import ProPeakTable, {
  type PeakColumnDef,
} from '@/components/canvas/artifacts/pro/primitives/ProPeakTable'
import ProVarsTab from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'
import { S } from '@/components/canvas/artifacts/RamanProWorkbench.styles'
import type { ProDataTabDef } from '@/components/canvas/artifacts/pro/ProDataTabs'
import type { ModuleCtx } from '../../types'
import type { RamanActions } from './actions'
import { RAMAN_VARS_SCHEMA } from './varsSchema'

const RAMAN_PEAK_COLUMNS_RAMAN = [
  { key: 'position', label: 'Shift', unit: 'cm⁻¹', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'intensity', label: 'I', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'fwhm', label: 'FWHM', unit: 'cm⁻¹', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'snr', label: 'SNR', numeric: true, precision: 1, editable: false },
] as const satisfies ReadonlyArray<PeakColumnDef<XrdProPeak>>

const RAMAN_PEAK_COLUMNS_FTIR = [
  { key: 'position', label: 'Wavenumber', unit: 'cm⁻¹', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'intensity', label: 'I', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'fwhm', label: 'FWHM', unit: 'cm⁻¹', numeric: true, precision: 1, editable: true, step: 1 },
  { key: 'snr', label: 'SNR', numeric: true, precision: 1, editable: false },
] as const satisfies ReadonlyArray<PeakColumnDef<XrdProPeak>>

export function buildRamanDataTabs(
  ctx: ModuleCtx<RamanSubState>,
  actions: RamanActions,
): ProDataTabDef[] {
  const { sub } = ctx
  const { isFtir } = actions
  return [
    {
      id: 'peaks',
      label: 'Peaks',
      badge: sub.peaks.length || undefined,
      content: (
        <ProPeakTable<XrdProPeak>
          peaks={sub.peaks}
          columns={isFtir ? RAMAN_PEAK_COLUMNS_FTIR : RAMAN_PEAK_COLUMNS_RAMAN}
          onEdit={actions.handleUpdatePeak}
          onDelete={actions.handleRemovePeak}
          onAdd={actions.handleAddBlankPeak}
          onFocus={actions.setFocusedPeakIdx}
          emptyMessage={
            isFtir
              ? 'No bands — run detect-peaks or add a row.'
              : 'No peaks — run detect-peaks or add a row.'
          }
        />
      ),
    },
    {
      id: 'matches',
      label: 'Matches',
      badge: sub.matches.length || undefined,
      content: (
        <div style={S.tabPlaceholder}>
          {sub.matches.length === 0
            ? isFtir
              ? 'FTIR identify is not wired on the backend yet.'
              : 'Run identify to get database matches.'
            : `${sub.matches.length} matches. See Inspector for the list.`}
        </div>
      ),
    },
    {
      id: 'vars',
      label: 'Vars',
      content: <ProVarsTab<RamanSubState> schema={RAMAN_VARS_SCHEMA} ctx={ctx} />,
    },
  ]
}
