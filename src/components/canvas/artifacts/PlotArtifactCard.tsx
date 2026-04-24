// Interactive plot artifact — rendered on the canvas when a
// `plot_spectrum` or `compare_spectra` tool produces a `PlotArtifact`.
//
// Left pane: ECharts chart bound to `buildPlotOption(payload)`. Updates
// instantly when the user tweaks params via the right drawer — no
// backend round-trip, no file re-read.
//
// Right pane: `ParamsDrawer` that mutates `payload.params` via the
// standard artifact patch flow. Collapses into a narrow strip on
// smaller cards so the chart retains priority.
//
// Header: mode chip + source chip + Export PNG + (optional) Dismiss.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Download, PanelLeftClose, PanelRightOpen, X } from 'lucide-react'
import type { PlotArtifact, PlotPayload } from '../../../types/artifact'
import { buildPlotOption } from '../../../lib/plot-chart'
import { toast } from '../../../stores/toast-store'
import { downloadBinary } from '../../../lib/pro-export'
import { chartImageToPdf, dataUrlToBytes } from '../../../lib/chart-pdf'
import ParamsDrawer from './plot/ParamsDrawer'

type ImageFormat = 'png' | 'jpeg' | 'pdf'

interface Props {
  artifact: PlotArtifact
  className?: string
  /** Standard payload-patch hook mirrored from other canvas artifact
   *  cards. The drawer routes every tweak through here. Undefined
   *  when the host didn't wire it — drawer hides editable controls
   *  and the card becomes read-only. */
  onPatchPayload?: (next: PlotPayload) => void
  /** Optional dismiss affordance (e.g. from canvas overlay host). */
  onDismiss?: () => void
}

const MODE_LABEL: Record<PlotPayload['mode'], string> = {
  single: 'Single',
  overlay: 'Overlay',
  offset: 'Offset',
  stacked: 'Stacked',
  difference: 'Difference',
}

export default function PlotArtifactCard({
  artifact,
  className,
  onPatchPayload,
  onDismiss,
}: Props) {
  const payload = artifact.payload
  const [drawerOpen, setDrawerOpen] = useState(true)

  const option = useMemo(() => buildPlotOption(payload), [payload])

  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  const handleExport = useCallback(
    (format: ImageFormat = 'png') => {
      try {
        const root = document.querySelector<HTMLElement>(
          `[data-plot-artifact-id="${artifact.id}"]`,
        )
        const canvas = root?.querySelector<HTMLCanvasElement>('canvas')
        if (!canvas) {
          toast.error('Chart canvas not found — try again after the chart renders.')
          return
        }
        const slug = safeSlug(artifact.title)
        if (format === 'pdf') {
          const url = canvas.toDataURL('image/jpeg', 0.92)
          const bytes = dataUrlToBytes(url)
          const blob = chartImageToPdf(
            bytes,
            canvas.width,
            canvas.height,
            canvas.width / 2,
            canvas.height / 2,
          )
          downloadBinary(`${slug}.pdf`, blob)
        } else {
          const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
          const ext = format === 'jpeg' ? '.jpg' : '.png'
          const url = canvas.toDataURL(mime, 0.92)
          const a = document.createElement('a')
          a.href = url
          a.download = `${slug}${ext}`
          a.click()
        }
        toast.success(`${format.toUpperCase()} downloaded.`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Export failed: ${msg}`)
      }
      setExportOpen(false)
    },
    [artifact.id, artifact.title],
  )

  const rootClass = ['plot-card-root', className].filter(Boolean).join(' ')

  return (
    <div className={rootClass} data-plot-artifact-id={artifact.id}>
      <div className="plot-card-header">
        <span className="plot-card-title">{artifact.title}</span>
        <span className="plot-card-mode-chip">{MODE_LABEL[payload.mode]}</span>
        {payload.sourceRelPaths.length > 0 && (
          <span
            className="plot-card-source-chip"
            title={payload.sourceRelPaths.join(' + ')}
          >
            from {payload.sourceRelPaths.length} file
            {payload.sourceRelPaths.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="plot-card-spacer" />
        <button
          type="button"
          className="plot-card-icon-btn"
          onClick={() => setDrawerOpen((v) => !v)}
          title={drawerOpen ? 'Hide params' : 'Show params'}
          aria-label={drawerOpen ? 'Hide params' : 'Show params'}
        >
          {drawerOpen ? (
            <PanelLeftClose size={13} aria-hidden />
          ) : (
            <PanelRightOpen size={13} aria-hidden />
          )}
        </button>
        <div ref={exportRef} style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="plot-card-icon-btn"
            onClick={() => setExportOpen((v) => !v)}
            title="Export image"
            aria-label="Export image"
          >
            <Download size={13} aria-hidden />
          </button>
          {exportOpen && (
            <div className="plot-card-export-menu">
              {(['png', 'jpeg', 'pdf'] as ImageFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="plot-card-export-item"
                  onClick={() => handleExport(f)}
                >
                  {f === 'jpeg' ? 'JPG' : f.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="plot-card-icon-btn"
            onClick={onDismiss}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={13} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="plot-card-body">
        <div className="plot-card-chart-wrap">
          <ReactECharts
            option={option}
            style={{ width: '100%', height: '100%' }}
            notMerge={true}
            lazyUpdate={false}
          />
        </div>
        {drawerOpen && onPatchPayload ? (
          <ParamsDrawer
            payload={payload}
            onPatchPayload={onPatchPayload}
          />
        ) : null}
      </div>
    </div>
  )
}

function safeSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'plot'
  )
}
