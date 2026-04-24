import { getDocument } from 'pdfjs-dist/build/pdf.mjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from 'pdfjs-dist/types/src/display/api'
import type { PaperAnnotation } from '../../types/library-api'
import { PdfPage } from './pdf-viewer/PdfPage'
import { ensurePdfWorker } from './pdf-viewer/helpers'
import { TEXT_LAYER_CSS } from './pdf-viewer/text-layer-css'
import type { SelectionInfo } from './pdf-viewer/types'

// Re-exported so existing `import type { SelectionInfo } from
// '.../PdfContinuousViewer'` sites keep working after the split.
export type { SelectionInfo } from './pdf-viewer/types'

interface Props {
  url?: string
  data?: Uint8Array
  paperId: number | string
  annotations?: PaperAnnotation[]
  onTextSelect?: (info: SelectionInfo) => void
  onClearSelection?: () => void
}

export default function PdfContinuousViewer({
  url,
  data,
  paperId,
  annotations,
  onTextSelect,
  onClearSelection,
}: Props) {
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `targetScale` is the instantaneous value driven by UI controls (buttons,
  // wheel) — used for the zoom readout and pointer-anchor math so the user
  // sees feedback without jitter. `renderScale` is debounced and is what
  // actually re-renders every PDF page (expensive: getPage + canvas paint +
  // textLayer rebuild happen per-page per change). Before this split, a
  // single Ctrl+wheel gesture fired 15+ setState calls and each triggered
  // 50–100 full page renders concurrently — the source of the reported
  // zoom jank.
  const [targetScale, setTargetScale] = useState(1.25)
  const [renderScale, setRenderScale] = useState(1.25)
  const pendingZoomAnchorRef = useRef<{
    left: number
    top: number
    prevScale: number
  } | null>(null)

  useEffect(() => {
    if (targetScale === renderScale) return
    const timer = window.setTimeout(() => {
      setRenderScale(targetScale)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [targetScale, renderScale])

  const updateScale = useCallback(
    (updater: number | ((current: number) => number)) => {
      setTargetScale((current) => {
        const next =
          typeof updater === 'function'
            ? updater(current)
            : updater
        return Math.min(2.5, Math.max(0.75, Number(next.toFixed(3))))
      })
      onClearSelection?.()
    },
    [onClearSelection],
  )

  useEffect(() => {
    if (!url && !data) {
      setPdf(null)
      setError(null)
      setLoading(false)
      return
    }

    ensurePdfWorker()
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    let loadedPdf: PDFDocumentProxy | null = null

    async function loadPdf() {
      setLoading(true)
      setError(null)
      setPdf(null)
      onClearSelection?.()

      try {
        const loadingTask = getDocument(
          data
            ? {
                data: data.slice(0),
              }
            : {
                url,
              },
        )
        task = loadingTask
        const nextPdf = await loadingTask.promise
        if (cancelled) {
          await nextPdf.destroy()
          return
        }
        loadedPdf = nextPdf
        setPdf(nextPdf)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      if (loadedPdf) void loadedPdf.destroy()
      if (task) void task.destroy()
    }
  }, [data, onClearSelection, paperId, url])

  const pageNumbers = useMemo(
    () => (pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : []),
    [pdf],
  )

  useEffect(() => {
    const pending = pendingZoomAnchorRef.current
    const viewer = viewerRef.current
    if (!pending || !viewer) return

    // Re-anchor once the debounced render has actually resized the pages —
    // using `targetScale` here would scroll while the layout is still at
    // the old `renderScale`.
    const ratio = renderScale / pending.prevScale
    viewer.scrollLeft = pending.left * ratio - (pending.left - viewer.scrollLeft)
    viewer.scrollTop = pending.top * ratio - (pending.top - viewer.scrollTop)
    pendingZoomAnchorRef.current = null
  }, [renderScale])

  const handleScrollerWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return

      const viewer = viewerRef.current
      if (!viewer) return

      event.preventDefault()
      const rect = viewer.getBoundingClientRect()
      const pointerLeft = event.clientX - rect.left
      const pointerTop = event.clientY - rect.top
      // Anchor against `renderScale` (the scale the pages are actually laid
      // out at right now), not the pending `targetScale` the user is
      // currently steering toward — otherwise the scrollLeft/Top correction
      // after debounce is computed against a stale ratio and the page drifts.
      pendingZoomAnchorRef.current = {
        left: viewer.scrollLeft + pointerLeft,
        top: viewer.scrollTop + pointerTop,
        prevScale: renderScale,
      }

      const zoomFactor = Math.exp(-event.deltaY * 0.0025)
      updateScale((current) => current * zoomFactor)
    },
    [renderScale, updateScale],
  )

  if (!url && !data) {
    return (
      <div className="pdf-viewer-wrapper">
        <div className="pdf-viewer-empty">No PDF attached.</div>
      </div>
    )
  }

  return (
    <div className="pdf-viewer-wrapper">
      <style>{TEXT_LAYER_CSS}</style>
      <div className="pdf-viewer-toolbar">
        <button
          type="button"
          className="pdf-viewer-toolbar-btn"
          onClick={() => updateScale((prev) => prev - 0.1)}
        >
          -
        </button>
        <div className="pdf-viewer-zoom-label">
          {Math.round(targetScale * 100)}%
        </div>
        <button
          type="button"
          className="pdf-viewer-toolbar-btn"
          onClick={() => updateScale((prev) => prev + 0.1)}
        >
          +
        </button>
        <button
          type="button"
          className="pdf-viewer-secondary-btn"
          onClick={() => updateScale(1.25)}
          title="Reset zoom"
        >
          Reset
        </button>
        <div className="pdf-viewer-hint-label">
          Pinch or Ctrl/Cmd + wheel to zoom
        </div>
        <div className="pdf-viewer-page-count">
          {pdf ? `${pdf.numPages} pages` : loading ? 'Loading PDF...' : 'PDF'}
        </div>
      </div>

      <div
        ref={viewerRef}
        className="pdf-viewer-scroller"
        onWheel={handleScrollerWheel}
      >
        {loading && <div className="pdf-viewer-loading">Loading PDF...</div>}
        {error && (
          <div className="pdf-viewer-error">
            PDF preview unavailable: {error}
          </div>
        )}
        {/* Instant-feedback zoom layer. `targetScale` tracks live wheel /
            button input at 60 fps; `renderScale` is debounced 150 ms and
            actually drives canvas re-render. During the gap we GPU-scale
            the already-rendered pages via CSS transform so the user sees
            immediate visual feedback instead of staring at a frozen page.
            On settle, the transform is 1 and the real canvas is crisp
            at the new density. */}
        {!loading && !error && pdf && (
          <div
            className="pdf-viewer-pages-wrap"
            style={{
              transform:
                targetScale !== renderScale
                  ? `scale(${targetScale / renderScale})`
                  : undefined,
              transformOrigin: '0 0',
              // `willChange` hints the compositor to keep this subtree on
              // its own layer so scale transitions don't trigger a whole-
              // tree repaint.
              willChange:
                targetScale !== renderScale ? 'transform' : undefined,
            }}
          >
            {pageNumbers.map((pageNumber) => (
              <PdfPage
                key={`${paperId}-${pageNumber}`}
                pdf={pdf}
                pageNumber={pageNumber}
                scale={renderScale}
                viewerRef={viewerRef}
                annotations={annotations ?? []}
                onTextSelect={onTextSelect}
                onClearSelection={onClearSelection}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
