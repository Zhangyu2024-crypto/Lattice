// Bottom action bar for the XPS module. Owns the fit / quantify primary
// buttons plus the PNG / JSON / markdown export trio. Pulled out of
// `index.tsx` so footer-only tweaks don't churn the module file.

import type { ReactNode } from 'react'
import { FileDown, Sigma, Target } from 'lucide-react'
import type { XpsSubState } from '@/types/artifact'
import { ProActionBar, ProButton, ProChartExportButton } from '@/components/common/pro'
import { exportArtifactSnapshot, snapshotFilename } from '@/lib/pro-export'
import type { ModuleCtx } from '../../types'
import type { XpsActions } from './actions'

export function renderXpsFooter(
  ctx: ModuleCtx<XpsSubState>,
  actions: XpsActions,
): ReactNode {
  const baseName = snapshotFilename(ctx.artifact, 'xps').replace(/\.json$/, '')
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
                snapshotFilename(ctx.artifact, 'xps'),
              )
            }
            title="Download the full workbench state as a JSON snapshot file"
          >
            <FileDown size={11} />
            JSON
          </ProButton>
          <ProButton variant="ghost" onClick={actions.handleExport}>
            <FileDown size={11} />
            Export
          </ProButton>
        </>
      }
    >
      <ProButton
        variant="primary"
        onClick={actions.handleFit}
        loading={actions.busy === 'fit'}
      >
        <Sigma size={11} /> Fit Peaks
      </ProButton>
      <ProButton
        onClick={actions.handleQuantify}
        loading={actions.busy === 'quantify'}
      >
        <Target size={11} /> Quantify
      </ProButton>
    </ProActionBar>
  )
}
