// Main chart slot for the Curve technique module. Owns the ECharts mount
// and the (currently empty) overlay builder. Kept split from the module's
// action hook so chart-only changes don't touch handler code.
//
// Curve is the generic X-Y preprocessing lens (no overlays, no fit) — the
// chart shows the current spectrum plus detected peak markers only.

import ReactECharts from 'echarts-for-react'
import { Activity } from 'lucide-react'
import type { CurveSubState } from '@/types/artifact'
import { buildSpectrumChartOption } from '@/lib/pro-chart'
import { EmptyState } from '@/components/ui'
import { S } from '@/components/canvas/artifacts/CurveProWorkbench.styles'
import { buildChartInstanceKey } from '../../chart-instance-key'
import type { ChartOverlay, ModuleCtx } from '../../types'
import type { CurveActions } from './actions'
import { peaksFromSub } from './helpers'

// Curve has no computed overlays — the chart shows the current spectrum +
// detected peak markers only.
export function buildOverlays(_ctx: ModuleCtx<CurveSubState>): ChartOverlay[] {
  return []
}

export function MainViz({
  ctx,
  actions,
}: {
  ctx: ModuleCtx<CurveSubState>
  actions: CurveActions
}) {
  const { spectrum } = ctx.payload
  const chartOption = buildSpectrumChartOption({
    spectrum,
    peaks: peaksFromSub(ctx.sub),
    overlays: [],
    focusedPeakIdx: actions.focusedPeakIdx,
    logY: ctx.sub.params.yScale === 'log',
  })
  const chartKey = buildChartInstanceKey(spectrum)
  return (
    <div className="workbench-curve-main-viz">
      {spectrum ? (
        <div style={S.chartWrap}>
          <ReactECharts
            ref={actions.chartExporter.ref}
            key={chartKey}
            option={chartOption}
            notMerge={false}
            lazyUpdate
            className="workbench-curve-echarts"
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      ) : (
        <div style={S.emptyChart}>
          <EmptyState
            icon={<Activity size={32} strokeWidth={1.2} />}
            title="No curve loaded"
            hint="Drop a CSV or .xy file onto the canvas, or open from the launcher."
          />
        </div>
      )}
    </div>
  )
}
