// Data-tab definitions for the Curve module. Curve exposes two tabs —
// Features (editable peak table) and Vars (read-only schema). Kept split
// from `index.tsx` so tab-only UI tweaks don't churn the handler surface.

import type { CurveFeature, CurveSubState } from '@/types/artifact'
import ProPeakTable, {
  type PeakColumnDef,
} from '@/components/canvas/artifacts/pro/primitives/ProPeakTable'
import ProVarsTab from '@/components/canvas/artifacts/pro/primitives/ProVarsTab'
import type { ProDataTabDef } from '@/components/canvas/artifacts/pro/ProDataTabs'
import type { ModuleCtx } from '../../types'
import type { CurveActions } from './actions'
import { CURVE_VARS_SCHEMA } from './varsSchema'

const CURVE_FEATURE_COLUMNS = [
  { key: 'position', label: 'x', numeric: true, precision: 3, editable: true, step: 0.01 },
  { key: 'intensity', label: 'y', numeric: true, precision: 2, editable: true, step: 0.1 },
  { key: 'fwhm', label: 'FWHM', numeric: true, precision: 3, editable: true, step: 0.01 },
  { key: 'label', label: 'Label', numeric: false, editable: true },
] as const satisfies ReadonlyArray<PeakColumnDef<CurveFeature>>

export function buildCurveDataTabs(
  ctx: ModuleCtx<CurveSubState>,
  actions: CurveActions,
): ProDataTabDef[] {
  const { sub } = ctx
  return [
    {
      id: 'peaks',
      label: 'Features',
      badge: sub.peaks.length || undefined,
      content: (
        <ProPeakTable<CurveFeature>
          peaks={sub.peaks}
          columns={CURVE_FEATURE_COLUMNS}
          onEdit={actions.handleUpdateFeature}
          onDelete={actions.handleRemoveFeature}
          onAdd={actions.handleAddBlankFeature}
          onFocus={actions.setFocusedPeakIdx}
          emptyMessage="No features — run detect-peaks or add a row."
        />
      ),
    },
    {
      id: 'vars',
      label: 'Vars',
      content: <ProVarsTab<CurveSubState> schema={CURVE_VARS_SCHEMA} ctx={ctx} />,
    },
  ]
}
