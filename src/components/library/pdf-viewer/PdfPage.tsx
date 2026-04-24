import { OutputScale, TextLayer } from 'pdfjs-dist/build/pdf.mjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api'
import type { PaperAnnotation } from '../../../types/library-api'
import {
  alphaColor,
  clamp01,
  parentElementForNode,
  type CSSVarStyle,
} from './helpers'
import type { SelectionInfo } from './types'

export type PdfPageProps = {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  viewerRef: RefObject<HTMLDivElement | null>
  annotations: PaperAnnotation[]
  onTextSelect?: (info: SelectionInfo) => void
  onClearSelection?: () => void
}

export function PdfPage({
  pdf,
  pageNumber,
  scale,
  viewerRef,
  annotations,
  onTextSelect,
  onClearSelection,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(
    null,
  )
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let page: PDFPageProxy | null = null
    let renderTask: RenderTask | null = null
    let textLayer: TextLayer | null = null

    async function renderPage() {
      const canvas = canvasRef.current
      const textLayerEl = textLayerRef.current
      if (!canvas || !textLayerEl) return

      setRenderError(null)
      textLayerEl.replaceChildren()

      try {
        page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const viewport = page.getViewport({ scale })
        setPageSize({ width: viewport.width, height: viewport.height })

        // OutputScale reads `window.devicePixelRatio`, which under WSL /
        // Electron on non-HiDPI panels often reports 1. Rendering a PDF
        // canvas at 1× pixel density makes text look washed out and edges
        // mushy. Force a floor of 2× so glyphs stay crisp regardless of
        // the reported DPR. Capped at 3 so a 4K screen with DPR=2 doesn't
        // double-amplify into 6MB canvases per page.
        const outputScale = new OutputScale()
        const MIN_RENDER_DENSITY = 2
        const MAX_RENDER_DENSITY = 3
        outputScale.sx = Math.min(
          MAX_RENDER_DENSITY,
          Math.max(outputScale.sx, MIN_RENDER_DENSITY),
        )
        outputScale.sy = Math.min(
          MAX_RENDER_DENSITY,
          Math.max(outputScale.sy, MIN_RENDER_DENSITY),
        )
        const canvasWidth = Math.max(1, Math.floor(viewport.width * outputScale.sx))
        const canvasHeight = Math.max(1, Math.floor(viewport.height * outputScale.sy))
        canvas.width = canvasWidth
        canvas.height = canvasHeight
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) throw new Error('Canvas 2D context unavailable')

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: outputScale.scaled
            ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0]
            : undefined,
        })
        await renderTask.promise
        if (cancelled) return

        textLayer = new TextLayer({
          textContentSource: await page.getTextContent(),
          container: textLayerEl,
          viewport,
        })
        await textLayer.render()
      } catch (err) {
        if (cancelled) return
        const name =
          err && typeof err === 'object' && 'name' in err
            ? String((err as { name?: unknown }).name)
            : ''
        if (name === 'RenderingCancelledException' || name === 'AbortException') {
          return
        }
        setRenderError(err instanceof Error ? err.message : String(err))
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      page?.cleanup()
    }
  }, [pdf, pageNumber, scale])

  const pageAnnotations = useMemo(
    () => annotations.filter((ann) => ann.page === pageNumber),
    [annotations, pageNumber],
  )

  const emitSelection = useCallback(() => {
    const viewerEl = viewerRef.current
    const pageEl = pageRef.current
    const textLayerEl = textLayerRef.current
    if (!viewerEl || !pageEl || !textLayerEl) return

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onClearSelection?.()
      return
    }

    const anchorEl = parentElementForNode(selection.anchorNode)
    const focusEl = parentElementForNode(selection.focusNode)
    if (
      !anchorEl ||
      !focusEl ||
      !textLayerEl.contains(anchorEl) ||
      !textLayerEl.contains(focusEl)
    ) {
      // Selection is alive but its endpoints aren't inside this page's
      // textLayer (common when mouseup lands on the margin / annotation
      // layer / another page). We simply can't compute rects for it from
      // here — leave the toolbar as-is and let the next selectionchange
      // from the correct page handle it. Previously we called
      // onClearSelection() which made the toolbar blink-disappear any
      // time the user released the mouse slightly outside the text.
      return
    }

    const range = selection.getRangeAt(0)
    const text = selection.toString().trim()
    if (!text) {
      onClearSelection?.()
      return
    }

    const pageRect = pageEl.getBoundingClientRect()
    const viewerRect = viewerEl.getBoundingClientRect()
    const clientRects = Array.from(range.getClientRects()).filter(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > pageRect.top &&
        rect.right > pageRect.left &&
        rect.top < pageRect.bottom &&
        rect.left < pageRect.right,
    )
    if (clientRects.length === 0 || pageRect.width <= 0 || pageRect.height <= 0) {
      onClearSelection?.()
      return
    }

    const rects = clientRects.map((rect) => {
      const left = clamp01((rect.left - pageRect.left) / pageRect.width)
      const top = clamp01((rect.top - pageRect.top) / pageRect.height)
      const right = clamp01((rect.right - pageRect.left) / pageRect.width)
      const bottom = clamp01((rect.bottom - pageRect.top) / pageRect.height)
      return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      }
    })

    const top = Math.min(...clientRects.map((rect) => rect.top)) - viewerRect.top - 12
    const left =
      (Math.min(...clientRects.map((rect) => rect.left)) +
        Math.max(...clientRects.map((rect) => rect.right))) /
        2 -
      viewerRect.left

    // Anchor the new toolbar to the LAST rect of the selection — so the
    // toolbar lands below the selection (natural gaze direction) instead of
    // covering the first line the user just started from. For single-line
    // selects this is identical to rects[0]; for multi-line it hugs the
    // user's final cursor position.
    const last = clientRects[clientRects.length - 1]!
    const anchorRect = {
      top: last.top,
      bottom: last.bottom,
      left: last.left,
      right: last.right,
    }

    onTextSelect?.({
      text,
      page: pageNumber,
      rects,
      menuTop: Math.max(8, top),
      menuLeft: left,
      anchorRect,
    })
  }, [onClearSelection, onTextSelect, pageNumber, viewerRef])

  const scheduleSelectionEmit = useCallback(() => {
    window.requestAnimationFrame(() => {
      emitSelection()
    })
  }, [emitSelection])

  if (renderError) {
    return (
      <div className="pdf-viewer-page-shell pdf-viewer-page-error">
        Failed to render page {pageNumber}: {renderError}
      </div>
    )
  }

  const pageShellStyle: CSSVarStyle = {
    '--pw': `${pageSize?.width ?? 720}px`,
    '--ph': `${pageSize?.height ?? 920}px`,
  }
  // pdfjs 5.x TextLayer span positions are absolute pixels computed from
  // `viewport.scale`, while the span font-size is
  // `--total-scale-factor * --min-font-size * --font-height` (CSS).
  // These CSS vars MUST equal the current viewport scale — otherwise glyphs
  // shrink/grow independently of their positions and the invisible selection
  // spans misalign with the rendered canvas, breaking hit-testing,
  // multi-line dragging, and copy.
  const textLayerStyle: CSSVarStyle = {
    '--total-scale-factor': scale,
    '--scale-factor': scale,
    '--min-font-size': 1,
  }

  return (
    <div
      ref={pageRef}
      data-page-number={pageNumber}
      className="pdf-viewer-page-shell"
      style={pageShellStyle}
      onMouseUp={scheduleSelectionEmit}
      onKeyUp={scheduleSelectionEmit}
    >
      <canvas ref={canvasRef} className="pdf-viewer-canvas" />
      <div
        ref={textLayerRef}
        className="lt-pdf-textLayer pdf-viewer-text-layer"
        style={textLayerStyle}
      />
      <div className="pdf-viewer-annotation-layer">
        {pageAnnotations.flatMap((ann) =>
          ann.rects.map((rect, idx) => {
            // Different annotation types paint differently:
            //   highlight / note → filled tint
            //   underline        → bottom border only (transparent fill)
            //   strike           → tint + pseudo-element line-through
            //   todo             → highlight tint + small checkbox badge
            // CSS selectors read `data-ann-type` to branch.
            const isUnderline = ann.type === 'underline'
            const fillAlpha = ann.type === 'note' ? 0.16 : isUnderline ? 0 : 0.3
            const rectStyle: CSSVarStyle = {
              '--ax': `${rect.x * 100}%`,
              '--ay': `${rect.y * 100}%`,
              '--aw': `${rect.width * 100}%`,
              '--ah': `${rect.height * 100}%`,
              '--abg': alphaColor(ann.color, fillAlpha),
              '--abc': alphaColor(ann.color, isUnderline ? 0.85 : 0.65),
            }
            return (
              <div
                key={`${ann.id}-${idx}`}
                title={ann.content || `${ann.type} annotation`}
                className={`pdf-viewer-annotation-rect pdf-viewer-annotation-rect--${
                  ann.type === 'highlight' ||
                  ann.type === 'note' ||
                  ann.type === 'underline' ||
                  ann.type === 'strike' ||
                  ann.type === 'todo'
                    ? ann.type
                    : 'highlight'
                }${ann.type === 'todo' && ann.todoDone ? ' is-done' : ''}`}
                data-ann-type={ann.type}
                style={rectStyle}
              />
            )
          }),
        )}
        {pageAnnotations
          .filter((ann) => ann.type === 'note' && ann.rects.length > 0)
          .map((ann) => {
            const first = ann.rects[0]
            const noteStyle: CSSVarStyle = {
              '--nx': `${first.x * 100}%`,
              '--ny': `${Math.max(0, first.y * 100 - 2)}%`,
              '--nbg': ann.color || '#D4D4D4',
            }
            return (
              <div
                key={`note-${ann.id}`}
                title={ann.content}
                className="pdf-viewer-note-badge"
                style={noteStyle}
              >
                N
              </div>
            )
          })}
      </div>
    </div>
  )
}
