import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Download } from 'lucide-react'
import type { Artifact } from '../../../../types/artifact'
import type { PlotPayload } from '../../../../types/artifact'
import { buildPlotOption } from '../../../../lib/plot-chart'
import { toast } from '../../../../stores/toast-store'
import { downloadBinary } from '../../../../lib/pro-export'
import { chartImageToPdf, dataUrlToBytes } from '../../../../lib/chart-pdf'

type ImageFormat = 'png' | 'jpeg' | 'pdf'

interface Props {
  artifact: Artifact
}

export default function PlotInlinePreview({ artifact }: Props) {
  const payload = artifact.payload as unknown as PlotPayload
  const option = useMemo(() => buildPlotOption(payload), [payload])

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleExport = useCallback(
    (format: ImageFormat) => {
      try {
        const root = document.querySelector<HTMLElement>(
          `[data-plot-inline-id="${artifact.id}"]`,
        )
        const canvas = root?.querySelector<HTMLCanvasElement>('canvas')
        if (!canvas) {
          toast.error('Chart not ready.')
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
        toast.error(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      setMenuOpen(false)
    },
    [artifact.id, artifact.title],
  )

  return (
    <div className="plot-inline-preview" data-plot-inline-id={artifact.id}>
      <div className="plot-inline-preview-chart">
        <ReactECharts
          option={option}
          style={{ width: '100%', height: '100%' }}
          notMerge
          lazyUpdate={false}
        />
      </div>
      <div className="plot-inline-preview-actions">
        <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            className="plot-inline-preview-btn"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Download size={11} />
            Export ▾
          </button>
          {menuOpen && (
            <div className="plot-card-export-menu" style={{ bottom: '100%', top: 'auto', marginBottom: 4, marginTop: 0 }}>
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
