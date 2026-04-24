// Main chart slot for the Raman/FTIR technique module. Owns the ECharts
// mount and the (currently empty) overlay builder. Kept split from the
// module's action hook so chart-only changes don't touch handler code.
//
// Raman and FTIR share the same viz — the only axis difference is that
// FTIR conventionally reverses the X axis (high wavenumbers on the left).

import ReactECharts from 'echarts-for-react'
import { FlaskConical } from 'lucide-react'
import type { RamanSubState } from '@/types/artifact'
import { buildSpectrumChartOption } from '@/lib/pro-chart'
import { EmptyState } from '@/components/ui'
import { S } from '@/components/canvas/artifacts/RamanProWorkbench.styles'
import ProgressOverlay from '@/components/canvas/artifacts/pro/ProgressOverlay'
import { buildChartInstanceKey } from '../../chart-instance-key'
import type { ChartOverlay, ModuleCtx } from '../../types'
import type { RamanActions } from './actions'

// Raman / FTIR have no calculated curves yet — peaks flow through the
// normalised path and no extra series are needed.
export function buildOverlays(_ctx: ModuleCtx<RamanSubState>): ChartOverlay[] {
  return []
}

export function MainViz({
  ctx,
  actions,
}: {
  ctx: ModuleCtx<RamanSubState>
  actions: RamanActions
}) {
  const { spectrum } = ctx.payload
  const { isFtir } = actions
  const chartOption = buildSpectrumChartOption({
    spectrum,
    peaks: ctx.sub.peaks,
    // FTIR convention: high wavenumbers on the left.
    reverseX: isFtir,
    focusedPeakIdx: actions.focusedPeakIdx,
    logY: ctx.sub.params.yScale === 'log',
  })
  const chartKey = buildChartInstanceKey(spectrum)
  return (
    <div style={{ flex: 1, height: '100%', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {spectrum ? (
        <div style={S.chartWrap}>
          <ReactECharts
            ref={actions.chartExporter.ref}
            key={chartKey}
            option={chartOption}
            notMerge={false}
            lazyUpdate
            className="workbench-raman-echarts"
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
          <ProgressOverlay busy={actions.busy} />
        </div>
      ) : (
        <div style={S.emptyChart}>
          <EmptyState
            icon={<FlaskConical size={32} strokeWidth={1.2} />}
            title={`No ${isFtir ? 'FTIR' : 'Raman'} spectrum loaded`}
            hint="Press Ctrl+K to run a command or drag a file onto the window."
          />
        </div>
      )}
    </div>
  )
}
