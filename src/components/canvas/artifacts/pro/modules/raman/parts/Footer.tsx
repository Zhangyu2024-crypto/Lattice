// Bottom action bar for the Raman/FTIR module. Owns the re-detect / assign
// primary buttons plus the PNG / JSON / CSV export trio. Pulled out of
// `index.tsx` so footer-only tweaks don't churn the module file.
//
// The Assign button is gated on `getCapability('ftir-identify')` when the
// module is serving FTIR — the FTIR identify path isn't wired on the
// backend yet, so the button disables itself with an explanatory tooltip.

import type { ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import type { RamanSubState } from '@/types/artifact'
import { ProActionBar, ProButton, ProChartExportButton } from '@/components/common/pro'
import { getCapability } from '@/lib/pro-capabilities'
import { exportArtifactSnapshot, snapshotFilename } from '@/lib/pro-export'
import type { ModuleCtx } from '../../types'
import type { RamanActions } from './actions'

export function renderRamanFooter(
  ctx: ModuleCtx<RamanSubState>,
  actions: RamanActions,
): ReactNode {
  const slug = actions.isFtir ? 'ftir' : 'raman'
  const baseName = snapshotFilename(ctx.artifact, slug).replace(/\.json$/, '')
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
                snapshotFilename(ctx.artifact, slug),
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
        onClick={actions.handleDetectPeaks}
        loading={actions.busy === 'detect-peaks'}
      >
        Re-Detect
      </ProButton>
      <ProButton
        onClick={actions.handleIdentify}
        loading={actions.busy === 'identify'}
        disabled={actions.isFtir && !getCapability('ftir-identify').available}
        title={
          actions.isFtir && !getCapability('ftir-identify').available
            ? getCapability('ftir-identify').reason
            : undefined
        }
      >
        Assign
      </ProButton>
    </ProActionBar>
  )
}
