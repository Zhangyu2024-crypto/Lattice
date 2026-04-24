// Pure helpers for the XPS analysis card: chart-option builder plus
// the small numeric utilities (pseudo-Voigt synthesis, nearest-index
// lookup, clamp). Keeping these outside the component keeps the
// rendering code stateless and straightforward to unit-test.

import { CHART_PRIMARY } from '../../../../lib/chart-colors'
import { buildPeakMarker } from '../../../../lib/chart-peak-markers'
import { CHART_TEXT_PX } from '../../../../lib/chart-text-px'
import { COMP_COLOR, EXP_COLOR, FIT_COLOR, RES_COLOR } from './constants'
import type { XpsFit, XpsPeak } from './types'

export function pseudoVoigtFromArea(x: number, p: XpsPeak): number {
  const sigma = p.fwhm / (2 * Math.sqrt(2 * Math.LN2))
  const gamma = p.fwhm / 2
  const d = x - p.binding
  const gauss = Math.exp(-(d * d) / (2 * sigma * sigma))
  const lorentz = (gamma * gamma) / (d * d + gamma * gamma)
  const amplitude = (p.area * 4) / (Math.PI * p.fwhm)
  return amplitude * (0.3 * lorentz + 0.7 * gauss)
}

export function nearestIndex(arr: number[], target: number): number {
  if (arr.length === 0) return -1
  let best = 0
  let bestDist = Math.abs(arr[0] - target)
  for (let i = 1; i < arr.length; i++) {
    const d = Math.abs(arr[i] - target)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function buildChartOption(fit: XpsFit) {
  const { experimentalPattern: exp, modelPattern: model, peaks } = fit
  const [xLo, xHi] = fit.bindingRange
  const axisLine = { lineStyle: { color: '#2A2A2A' } }
  const splitLine = { lineStyle: { color: 'rgba(255,255,255,0.04)' } }
  const label10 = { color: '#888888', fontSize: CHART_TEXT_PX.xxs }
  const xCommon = { type: 'value' as const, inverse: true, min: xHi, max: xLo, axisLine, splitLine }
  const yCommon = {
    type: 'value' as const,
    nameLocation: 'middle' as const,
    nameGap: 48,
    nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
    axisLabel: label10,
    axisLine,
    splitLine,
  }

  const componentSeries = peaks.map((p) => ({
    name: p.label,
    type: 'line' as const,
    xAxisIndex: 0,
    yAxisIndex: 0,
    data: exp.x.map((x) => [x, pseudoVoigtFromArea(x, p)]),
    showSymbol: false,
    lineStyle: { color: COMP_COLOR, width: 1, type: 'dashed' as const },
    z: 1,
  }))

  const peakMarkers = peaks.map((p) => {
    const idx = nearestIndex(model.x, p.binding)
    return buildPeakMarker({
      x: p.binding,
      y: idx >= 0 ? model.y[idx] : 0,
      name: p.label,
      color: FIT_COLOR,
      symbolSize: CHART_TEXT_PX.xxs,
      symbolOffsetY: -7,
      labelFontSize: CHART_TEXT_PX['2xs'],
      labelDistance: 6,
    })
  })

  return {
    backgroundColor: 'transparent',
    animation: false,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { top: 16, left: 64, right: 24, height: '62%' },
      { left: 64, right: 24, height: '18%', bottom: 28 },
    ],
    xAxis: [
      { ...xCommon, gridIndex: 0, axisLabel: { show: false } },
      { ...xCommon, gridIndex: 1, name: 'Binding energy (eV)', nameLocation: 'middle' as const, nameGap: 22, nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xs }, axisLabel: label10 },
    ],
    yAxis: [
      { ...yCommon, gridIndex: 0, name: 'Intensity (a.u.)' },
      { ...yCommon, gridIndex: 1, name: 'resid.', axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX['2xs'] } },
    ],
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      axisPointer: { lineStyle: { color: CHART_PRIMARY, width: 1 } },
    },
    series: [
      {
        name: 'Experimental',
        type: 'line' as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: exp.x.map((x, i) => [x, exp.y[i]]),
        showSymbol: false,
        lineStyle: { color: EXP_COLOR, width: 1, opacity: 0.9 },
        z: 2,
      },
      ...componentSeries,
      {
        name: 'Fit envelope',
        type: 'line' as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: model.x.map((x, i) => [x, model.y[i]]),
        showSymbol: false,
        lineStyle: { color: FIT_COLOR, width: 2 },
        markPoint: { data: peakMarkers, animation: false },
        z: 3,
      },
      {
        name: 'Residuals',
        type: 'line' as const,
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: exp.x.map((x, i) => [x, fit.residuals[i] ?? 0]),
        showSymbol: false,
        lineStyle: { color: RES_COLOR, width: 1 },
      },
    ],
  }
}
