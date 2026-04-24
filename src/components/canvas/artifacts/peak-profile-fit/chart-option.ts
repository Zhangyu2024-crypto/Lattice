import { CHART_COLOR_DATA, CHART_COLOR_MODEL } from './constants'

// Builds the ECharts option for the two-series preview (observed data +
// live pseudo-Voigt model). Isolated from the modal component so we can
// tweak axis styling without re-rendering the whole form during prop
// churn. The caller supplies the already-windowed observed sample and
// the model curve evaluated at the same x values.

export function buildChartOption(
  windowed: { x: number[]; y: number[] },
  modelCurve: number[],
) {
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 20, right: 16, bottom: 40, left: 56 },
    xAxis: {
      type: 'value' as const,
      name: '2θ (°)',
      nameGap: 24,
      axisLine: { lineStyle: { color: 'var(--color-border)' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLine: { lineStyle: { color: 'var(--color-border)' } },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    },
    tooltip: {
      trigger: 'axis' as const,
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
    },
    series: [
      {
        name: 'Observed',
        type: 'line' as const,
        data: windowed.x.map((x, i) => [x, windowed.y[i]]),
        showSymbol: false,
        lineStyle: { color: CHART_COLOR_DATA, width: 1.3 },
        z: 1,
      },
      {
        name: 'Model',
        type: 'line' as const,
        data: windowed.x.map((x, i) => [x, modelCurve[i]]),
        showSymbol: false,
        lineStyle: {
          color: CHART_COLOR_MODEL,
          width: 1.2,
          type: 'dashed' as const,
        },
        z: 2,
      },
    ],
  }
}
