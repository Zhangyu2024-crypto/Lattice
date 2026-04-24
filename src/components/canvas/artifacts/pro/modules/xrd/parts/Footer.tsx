// Bottom action bar for the XRD module. Owns the search / refine primary
// buttons plus the PNG / JSON / snapshot / CIF / CSV export cluster.
// Pulled out of `index.tsx` so footer-only tweaks don't churn the module
// file.

import type { ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import type { XrdSubState } from '@/types/artifact'
import { ProActionBar, ProButton, ProChartExportButton } from '@/components/common/pro'
import { getCapability } from '@/lib/pro-capabilities'
import { exportArtifactSnapshot, snapshotFilename } from '@/lib/pro-export'
import type { ModuleCtx } from '../../types'
import type { XrdActions } from './actions'

export function renderXrdFooter(
  ctx: ModuleCtx<XrdSubState>,
  actions: XrdActions,
): ReactNode {
  const baseName = snapshotFilename(ctx.artifact, 'xrd').replace(/\.json$/, '')
  const hasElements = ctx.sub.params.phaseSearch.elements.trim().length > 0
  const canSearch = hasElements && ctx.sub.peaks.length > 0
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
                snapshotFilename(ctx.artifact, 'xrd'),
              )
            }
            title="Download the full workbench state as a JSON snapshot file"
          >
            <FileDown size={11} />
            JSON
          </ProButton>
          <ProButton variant="ghost" onClick={actions.handleSnapshot}>
            <FileDown size={11} />
            Save Snapshot
          </ProButton>
        </>
      }
    >
      <ProButton
        onClick={actions.handleSearchDb}
        loading={actions.busy === 'xrd-search'}
        disabled={!canSearch}
        title={
          !hasElements
            ? 'Add element symbols (e.g. "Fe, O") to enable retrieval'
            : !ctx.sub.peaks.length
              ? 'Detect or add peaks first'
              : 'Element-subset retrieval + LLM phase identification'
        }
      >
        Search DB
      </ProButton>
      <ProButton
        variant="primary"
        onClick={actions.handleRefine}
        loading={actions.busy === 'xrd-refine'}
      >
        Refine
      </ProButton>
      <ProButton
        onClick={actions.handleExportCif}
        disabled={!getCapability('xrd-cif-export').available}
        title={getCapability('xrd-cif-export').reason}
      >
        Export CIF
      </ProButton>
      <ProButton onClick={actions.handleExportCsv}>Export CSV</ProButton>
    </ProActionBar>
  )
}
