// Main chart slot for the XPS technique module. Owns the energy-window
// strip, the ECharts mount, and the fit-overlay builder. Kept split from
// the module's action hook so chart-only changes don't touch handler code.

import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { FlaskConical } from 'lucide-react'
import type { XpsSubState } from '@/types/artifact'
import { buildSpectrumChartOption, PRO_CHART_COLORS } from '@/lib/pro-chart'
import { GRAYSCALE_OVERLAY_COLORS } from '@/lib/chart-colors'
import { ProButton, ProNumber } from '@/components/common/pro'
import { EmptyState } from '@/components/ui'
import { S } from '@/components/canvas/artifacts/XpsProWorkbench.styles'
import ProgressOverlay from '@/components/canvas/artifacts/pro/ProgressOverlay'
import { buildChartInstanceKey } from '../../chart-instance-key'
import type { ChartOverlay, ModuleCtx } from '../../types'
import type { XpsActions } from './actions'

export function buildOverlays(ctx: ModuleCtx<XpsSubState>): ChartOverlay[] {
  const out: ChartOverlay[] = []
  const curves = ctx.sub.fitResult?.curves
  const showResidual = ctx.sub.params.yScale !== 'log'
  if (curves) {
    out.push({
      name: 'Background',
      x: curves.x,
      y: curves.y_background,
      color: '#666',
      width: 1,
      dashed: true,
    })
    out.push({
      name: 'Envelope',
      x: curves.x,
      y: curves.y_envelope,
      color: PRO_CHART_COLORS.model,
      width: 1.4,
    })
    for (const [name, y] of Object.entries(curves.components)) {
      out.push({
        name,
        x: curves.x,
        y,
        color: 'rgba(232, 178, 113, 0.45)',
        width: 1,
      })
    }
    if (curves.y_residual && showResidual) {
      out.push({
        name: 'Residual',
        x: curves.x,
        y: curves.y_residual,
        color: PRO_CHART_COLORS.residual,
        width: 0.8,
        dashed: true,
      })
    }
  }

  // User-loaded secondary XPS patterns (depth-profile / angle-resolved /
  // before-after series). Rendered as continuous line overlays with the
  // stored colour token; hidden rows are skipped rather than pushed at
  // opacity 0 so ECharts doesn't waste a series slot on invisible data.
  let fallbackIdx = 0
  for (const ov of ctx.sub.patternOverlays ?? []) {
    if (!ov.visible) continue
    if (!ov.x || ov.x.length === 0) continue
    out.push({
      name: `ovl: ${ov.name}`,
      x: ov.x,
      y: ov.y,
      color:
        ov.color ||
        GRAYSCALE_OVERLAY_COLORS[
          fallbackIdx++ % GRAYSCALE_OVERLAY_COLORS.length
        ],
      width: 1,
    })
  }
  return out
}

export function MainViz({
  ctx,
  actions,
}: {
  ctx: ModuleCtx<XpsSubState>
  actions: XpsActions
}) {
  const { spectrum } = ctx.payload
  const params = ctx.sub.params
  // Memoise against the actual inputs buildOverlays reads — fit curves
  // + user-loaded pattern overlays. Focus / hover re-renders otherwise
  // re-walk the entire fit-components object.
  const overlays = useMemo(
    () => buildOverlays(ctx),
    [ctx.sub.fitResult, ctx.sub.patternOverlays],
  )
  const chartOption = buildSpectrumChartOption({
    spectrum,
    peaks: ctx.sub.detectedPeaks,
    overlays,
    reverseX: true, // XPS convention
    focusedPeakIdx: actions.focusedPeakIdx,
    logY: ctx.sub.params.yScale === 'log',
  })
  // Reset the chart instance when a different spectrum lands so stale
  // zoom/viewport state from the previous trace cannot clip the new one.
  const chartKey = buildChartInstanceKey(spectrum, overlays)
  return (
    <div style={S.left}>
      {/* Energy window strip — XPS-specific. */}
      <div style={S.energyStrip}>
        <span style={S.energyLabel}>Energy Window:</span>
        <ProNumber
          value={params.energyWindow.min ?? ''}
          step={0.5}
          placeholder="Min eV"
          width={90}
          onChange={(v) =>
            actions.setParams((p) => ({
              ...p,
              energyWindow: { ...p.energyWindow, min: v === '' ? null : v },
            }))
          }
        />
        <span style={S.energySep}>to</span>
        <ProNumber
          value={params.energyWindow.max ?? ''}
          step={0.5}
          placeholder="Max eV"
          width={90}
          onChange={(v) =>
            actions.setParams((p) => ({
              ...p,
              energyWindow: { ...p.energyWindow, max: v === '' ? null : v },
            }))
          }
        />
        <span style={S.energyUnit}>eV</span>
        <ProButton compact onClick={actions.handleResetEnergyWindow}>
          Full Range
        </ProButton>
      </div>
      {spectrum ? (
        <div style={S.chartWrap}>
          <ReactECharts
            ref={actions.chartExporter.ref}
            key={chartKey}
            option={chartOption}
            notMerge={false}
            lazyUpdate
            className="workbench-xps-echarts"
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
          <ProgressOverlay busy={actions.busy} />
        </div>
      ) : (
        <div style={S.emptyChart}>
          <EmptyState
            icon={<FlaskConical size={32} strokeWidth={1.2} />}
            title="No XPS spectrum loaded"
          />
        </div>
      )}
    </div>
  )
}
