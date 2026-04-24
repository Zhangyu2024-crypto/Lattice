export interface ChartInstanceSeriesLike {
  x: readonly number[]
  y: readonly number[]
  sourceFile?: string | null
  seriesType?: string | null
}

/** Build a stable React `key` for ECharts mounts so switching to a new
 *  spectrum remounts the chart and clears stale zoom / viewport state.
 *  Keep the key stable for ordinary in-place edits by fingerprinting only
 *  the outer series identity plus a few boundary samples. */
export function buildSeriesChartInstanceKey(
  series: ChartInstanceSeriesLike | null,
  extras: ReadonlyArray<string | number | boolean | null | undefined> = [],
): string {
  const parts: Array<string | number> = []
  if (!series) {
    parts.push('empty')
  } else {
    const pointCount = Math.min(series.x.length, series.y.length)
    parts.push(
      series.sourceFile ?? 'inline',
      series.seriesType ?? 'unknown',
      pointCount,
    )
    if (pointCount > 0) {
      const last = pointCount - 1
      parts.push(
        series.x[0],
        series.x[last],
        series.y[0],
        series.y[last],
      )
    }
  }
  for (const extra of extras) parts.push(String(extra ?? ''))
  return parts.join('::')
}
