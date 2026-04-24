// Ref-based helper for downloading an ECharts instance as PNG / JPG / PDF.
//
// Every Pro Workbench chart wants the same "Save chart as image"
// affordance. Rather than repeating the ECharts-ref → getDataURL plumbing
// per module, they call `useChartExporter()` once, pass the ref to
// `<ReactECharts ref={exporter.ref}>`, and trigger `exporter.download()`
// from a toolbar button.
//
// Design defaults (match the app's grayscale chrome):
//   - Background: `#191919` (`--color-bg-base`) so the exported image looks
//     like the on-screen render rather than a transparent film over white.
//   - Pixel ratio: 2 for retina-sharp embedding in reports / slides.

import { useCallback, useRef } from 'react'
import type ReactEChartsClass from 'echarts-for-react'
import { downloadBinary, downloadDataUrl } from '@/lib/pro-export'
import { chartImageToPdf, dataUrlToBytes } from '@/lib/chart-pdf'

export type ChartExportFormat = 'png' | 'jpeg' | 'pdf'

export interface ChartExporterOptions {
  /** Default `<filename>`. Extension is added automatically. */
  defaultFilename?: string
  /** Image background. Defaults to the app's base surface. */
  backgroundColor?: string
  /** ECharts renderer density multiplier. Defaults to 2. */
  pixelRatio?: number
}

const EXT: Record<ChartExportFormat, string> = {
  png: '.png',
  jpeg: '.jpg',
  pdf: '.pdf',
}

export function useChartExporter(opts: ChartExporterOptions = {}) {
  const ref = useRef<ReactEChartsClass | null>(null)

  const download = useCallback(
    (filename?: string, format: ChartExportFormat = 'png') => {
      const inst = ref.current?.getEchartsInstance()
      if (!inst) return false

      const pixelRatio = opts.pixelRatio ?? 2
      const backgroundColor = opts.backgroundColor ?? '#191919'
      const base = filename ?? opts.defaultFilename ?? 'chart'
      const stripped = base.replace(/\.(png|jpe?g|pdf)$/i, '')
      const outName = `${stripped}${EXT[format]}`

      if (format === 'pdf') {
        const url = inst.getDataURL({
          type: 'jpeg',
          pixelRatio,
          backgroundColor,
        })
        const jpegBytes = dataUrlToBytes(url)
        const w = inst.getWidth() as number
        const h = inst.getHeight() as number
        const blob = chartImageToPdf(
          jpegBytes,
          w * pixelRatio,
          h * pixelRatio,
          w,
          h,
        )
        downloadBinary(outName, blob)
        return true
      }

      const url = inst.getDataURL({
        type: format,
        pixelRatio,
        backgroundColor,
      })
      downloadDataUrl(outName, url)
      return true
    },
    [opts.defaultFilename, opts.backgroundColor, opts.pixelRatio],
  )

  return { ref, download }
}
