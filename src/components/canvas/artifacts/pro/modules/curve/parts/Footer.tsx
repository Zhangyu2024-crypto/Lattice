// Bottom action bar for the Curve module. Owns the Smooth / Baseline /
// Detect primary buttons plus the PNG / JSON / CSV export trio. Pulled out
// of `index.tsx` so footer-only tweaks don't churn the module file.

import type { ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import type { CurveSubState } from '@/types/artifact'
import { ProActionBar, ProButton, ProChartExportButton } from '@/components/common/pro'
import { exportArtifactSnapshot, snapshotFilename } from '@/lib/pro-export'
import type { ModuleCtx } from '../../types'
import type { CurveActions } from './actions'

export function renderCurveFooter(
  ctx: ModuleCtx<CurveSubState>,
  actions: CurveActions,
): ReactNode {
  const baseName = snapshotFilename(ctx.artifact, 'curve').replace(/\.json$/, '')
  return (
    <ProActionBar
      right={
        <>
          <ProChartExportButton
            onExport={(fmt) => actions.chartExporter.download(baseName, fmt)}
          />
          <ProButton
            variant="ghost"
            onClick={() =>
              exportArtifactSnapshot(
                ctx.artifact,
                snapshotFilename(ctx.artifact, 'curve'),
              )
            }
            title="Download the full workbench state as a JSON snapshot file"
          >
            <FileDown size={11} /> JSON
          </ProButton>
          <ProButton variant="ghost" onClick={actions.handleExport}>
            <FileDown size={11} /> Export
          </ProButton>
        </>
      }
    >
      <ProButton onClick={actions.handleSmooth} loading={actions.busy === 'smooth'}>
        Smooth
      </ProButton>
      <ProButton
        onClick={actions.handleBaseline}
        loading={actions.busy === 'baseline'}
      >
        Baseline
      </ProButton>
      <ProButton
        variant="primary"
        onClick={actions.handleDetectPeaks}
        loading={actions.busy === 'detect-peaks'}
      >
        Detect peaks
      </ProButton>
    </ProActionBar>
  )
}
