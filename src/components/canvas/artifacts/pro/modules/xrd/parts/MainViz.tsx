// Main chart slot for the XRD technique module. Owns the ECharts mount
// and the overlay builder (calculated pattern, residuals, candidate
// tick / simulate overlays, user-loaded secondary patterns). Kept split
// from the module's action hook so chart-only changes don't touch
// handler code.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { FlaskConical } from 'lucide-react'
import type { XrdSubState } from '@/types/artifact'
import {
  CHART_SECONDARY,
  CHART_TERTIARY,
  GRAYSCALE_OVERLAY_COLORS,
} from '@/lib/chart-colors'
import { buildSpectrumChartOption } from '@/lib/pro-chart'
import { synthesizePattern } from '@/lib/xrd-pattern-synthesis'
import { EmptyState } from '@/components/ui'
import { S } from '@/components/canvas/artifacts/XrdProWorkbench.styles'
import ProgressOverlay from '@/components/canvas/artifacts/pro/ProgressOverlay'
import { buildChartInstanceKey } from '../../chart-instance-key'
import type { ChartOverlay, ModuleCtx } from '../../types'
import type { XrdActions } from './actions'

const DRAG_PICK_RADIUS_PX = 14
const PEAK_POSITION_DP = 4
const PEAK_INTENSITY_DP = 2

/**
 * Single-pass extrema over paired numeric arrays. Replaces
 * `Math.max(...array)` which both allocates and can blow the call-stack
 * argument cap on large spectra (tested spectra routinely hit 5–10k
 * points). Returns `null` when either input array is empty so callers
 * can short-circuit without a `NaN` branch.
 */
function arrayExtent(
  xs: readonly number[],
  ys: readonly number[],
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const n = Math.min(xs.length, ys.length)
  if (n === 0) return null
  let xMin = xs[0]
  let xMax = xs[0]
  let yMin = ys[0]
  let yMax = ys[0]
  for (let i = 1; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x < xMin) xMin = x
    else if (x > xMax) xMax = x
    if (y < yMin) yMin = y
    else if (y > yMax) yMax = y
  }
  return { xMin, xMax, yMin, yMax }
}

export function buildOverlays(ctx: ModuleCtx<XrdSubState>): ChartOverlay[] {
  const out: ChartOverlay[] = []
  const ref = ctx.sub.refineResult
  // Residuals default to ON — pros want to see them. Gate behind an
  // explicit `false` so persisted artifacts without the flag still render
  // the Δ curve.
  // Log-Y cannot represent the residual series because Δ commonly crosses
  // zero. Hide it automatically on log scale instead of emitting an
  // invalid negative-valued overlay.
  const showResiduals =
    ctx.sub.params.showResiduals !== false &&
    ctx.sub.params.yScale !== 'log'
  if (ref && ref.x && ref.y_calc) {
    out.push({
      name: 'Calculated',
      x: ref.x,
      y: ref.y_calc,
      color: CHART_SECONDARY,
      width: 1.2,
    })
    if (ref.y_diff && showResiduals) {
      out.push({
        name: 'Δ',
        x: ref.x,
        y: ref.y_diff,
        color: CHART_TERTIARY,
        width: 0.8,
        dashed: true,
      })
    }
  }

  // Reference-pattern overlays for every candidate whose 👁 (ticks) or
  // "~" (simulated continuous pattern) is toggled. Ticks are encoded as
  // a zig-zag NaN-broken line; simulated patterns come from
  // `synthesizePattern` (pseudo-Voigt broadening). Both can be on at
  // once — a user commonly leaves ticks on and flips simulate when they
  // want to see what a full pattern would look like.
  const spectrum = ctx.payload.spectrum
  // Precompute extents with a single pass. `Math.max(...spectrum.y)` is
  // O(N) *and* spreads a 5k-point array through the call stack — a loop
  // avoids both the allocation and the argument-count risk for huge
  // spectra.
  const extents = spectrum ? arrayExtent(spectrum.x, spectrum.y) : null
  const scale = extents && extents.yMax > 0 ? extents.yMax * 0.9 : 1
  let colorIdx = 0
  for (const c of ctx.sub.candidates) {
    if (!c.refPeaks || c.refPeaks.length === 0) continue
    if (!c.showOverlay && !c.showSimulate) continue
    const color =
      GRAYSCALE_OVERLAY_COLORS[
        colorIdx++ % GRAYSCALE_OVERLAY_COLORS.length
      ]
    const label = c.name ?? c.formula ?? c.material_id ?? 'cand'
    if (c.showOverlay) {
      const x: number[] = []
      const y: number[] = []
      for (const rp of c.refPeaks) {
        x.push(rp.twoTheta, rp.twoTheta, rp.twoTheta, NaN)
        y.push(0, rp.relIntensity * scale, 0, NaN)
      }
      out.push({
        name: `ref: ${label}`,
        x,
        y,
        color,
        width: 1,
      })
    }
    if (c.showSimulate) {
      // Use the spectrum's 2θ range when available (matches what the user
      // sees on the chart); fall back to the refinement window otherwise.
      const twoThetaMin =
        extents?.xMin ?? ctx.sub.params.refinement.twoThetaMin
      const twoThetaMax =
        extents?.xMax ?? ctx.sub.params.refinement.twoThetaMax
      const fwhmDeg = ctx.sub.params.scherrer.instrumentalFwhm ?? 0.1
      const synth = synthesizePattern(c.refPeaks, {
        twoThetaMin,
        twoThetaMax,
        nPoints: 2000,
        fwhmDeg,
        eta: 0.5,
        scale,
      })
      if (synth.x.length > 0) {
        out.push({
          name: `sim: ${label}`,
          x: synth.x,
          y: synth.y,
          color,
          width: 1,
          dashed: true,
        })
      }
    }
  }

  // User-loaded secondary patterns (in-situ / operando / VT series).
  // Rendered as continuous line overlays with their stored colour token;
  // hidden rows simply get skipped rather than rendered at opacity 0 so
  // ECharts doesn't waste a series slot on invisible data.
  for (const ov of ctx.sub.patternOverlays ?? []) {
    if (!ov.visible) continue
    if (!ov.x || ov.x.length === 0) continue
    out.push({
      name: `ovl: ${ov.name}`,
      x: ov.x,
      y: ov.y,
      color: ov.color,
      width: 1,
    })
  }
  return out
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function minPositive(values: readonly number[]): number | null {
  let out: number | null = null
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (!(value > 0)) continue
    if (out == null || value < out) out = value
  }
  return out
}

export function MainViz({
  ctx,
  actions,
}: {
  ctx: ModuleCtx<XrdSubState>
  actions: XrdActions
}) {
  const { spectrum } = ctx.payload
  const chartRef = useRef<ReactECharts | null>(null)
  const [dragPeakIdx, setDragPeakIdx] = useState<number | null>(null)
  const peaksRef = useRef(ctx.sub.peaks)
  const focusRef = useRef(actions.setFocusedPeakIdx)
  const patchPeakRef = useRef(actions.handleUpdatePeak)
  const dragPeakIdxRef = useRef<number | null>(null)
  const spectrumBounds = useMemo(
    () => (spectrum ? arrayExtent(spectrum.x, spectrum.y) : null),
    [spectrum],
  )
  const spectrumBoundsRef = useRef(spectrumBounds)
  const logYFloor = useMemo(
    () =>
      ctx.sub.params.yScale === 'log'
        ? Math.max(minPositive(spectrum?.y ?? []) ?? 1e-3, 1e-6)
        : 0,
    [ctx.sub.params.yScale, spectrum],
  )
  const logYFloorRef = useRef(logYFloor)
  // Build overlays on every render (no memo) to rule out stale-cache bugs.
  const overlays = buildOverlays(ctx)
  const chartKey = buildChartInstanceKey(spectrum, overlays)

  useEffect(() => {
    peaksRef.current = ctx.sub.peaks
  }, [ctx.sub.peaks])

  useEffect(() => {
    focusRef.current = actions.setFocusedPeakIdx
    patchPeakRef.current = actions.handleUpdatePeak
  }, [actions.handleUpdatePeak, actions.setFocusedPeakIdx])

  useEffect(() => {
    spectrumBoundsRef.current = spectrumBounds
  }, [spectrumBounds])

  useEffect(() => {
    logYFloorRef.current = logYFloor
  }, [logYFloor])

  useEffect(() => {
    if (ctx.sub.peaks.length > 0) return
    dragPeakIdxRef.current = null
    setDragPeakIdx(null)
  }, [ctx.sub.peaks.length])

  const assignChartRef = useCallback(
    (node: ReactECharts | null) => {
      chartRef.current = node
      actions.chartExporter.ref.current = node
    },
    [actions.chartExporter.ref],
  )

  const pickPeakAtPixel = useCallback(
    (instance: any, offsetX: number, offsetY: number): number | null => {
      const pixel = [offsetX, offsetY]
      if (
        typeof instance?.containPixel === 'function' &&
        !instance.containPixel({ gridIndex: 0 }, pixel)
      ) {
        return null
      }
      let bestIdx: number | null = null
      let bestDistance = DRAG_PICK_RADIUS_PX
      const peaks = peaksRef.current
      for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i]
        const peakPixel = instance.convertToPixel(
          { gridIndex: 0 },
          [peak.position, peak.intensity],
        ) as [number, number] | undefined
        if (
          !Array.isArray(peakPixel) ||
          peakPixel.length < 2 ||
          !Number.isFinite(peakPixel[0]) ||
          !Number.isFinite(peakPixel[1])
        ) {
          continue
        }
        const dx = peakPixel[0] - offsetX
        const dy = peakPixel[1] - offsetY
        const distance = Math.hypot(dx, dy)
        if (distance <= bestDistance) {
          bestDistance = distance
          bestIdx = i
        }
      }
      return bestIdx
    },
    [],
  )

  useEffect(() => {
    const instance = chartRef.current?.getEchartsInstance()
    if (!instance || !spectrum) return
    const zr = instance.getZr()
    const dom = instance.getDom() as HTMLElement

    const toPeakPoint = (
      clientX: number,
      clientY: number,
    ): [number, number] | null => {
      const rect = dom.getBoundingClientRect()
      const pixel = [clientX - rect.left, clientY - rect.top]
      const point = instance.convertFromPixel(
        { gridIndex: 0 },
        pixel,
      ) as [number, number] | undefined
      if (
        !Array.isArray(point) ||
        point.length < 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
      ) {
        return null
      }
      const bounds = spectrumBoundsRef.current
      let nextX = point[0]
      if (bounds) {
        nextX = Math.max(bounds.xMin, Math.min(bounds.xMax, nextX))
      }
      const nextY =
        ctx.sub.params.yScale === 'log'
          ? Math.max(logYFloorRef.current, point[1])
          : Math.max(0, point[1])
      return [
        roundTo(nextX, PEAK_POSITION_DP),
        roundTo(nextY, PEAK_INTENSITY_DP),
      ]
    }

    const setCursor = (cursor: string) => {
      dom.style.cursor = cursor
    }

    const handleMouseDown = (evt: {
      offsetX: number
      offsetY: number
      event?: { preventDefault?: () => void }
    }) => {
      const idx = pickPeakAtPixel(instance, evt.offsetX, evt.offsetY)
      if (idx == null) return
      dragPeakIdxRef.current = idx
      setDragPeakIdx(idx)
      focusRef.current(idx)
      setCursor('grabbing')
      evt.event?.preventDefault?.()
    }

    const handleHoverMove = (evt: { offsetX: number; offsetY: number }) => {
      if (dragPeakIdxRef.current != null) return
      const idx = pickPeakAtPixel(instance, evt.offsetX, evt.offsetY)
      setCursor(idx != null ? 'grab' : '')
    }

    const handleWindowMove = (evt: MouseEvent) => {
      const idx = dragPeakIdxRef.current
      if (idx == null) return
      const next = toPeakPoint(evt.clientX, evt.clientY)
      if (!next) return
      patchPeakRef.current(idx, {
        position: next[0],
        intensity: next[1],
      })
      evt.preventDefault()
    }

    const stopDrag = () => {
      if (dragPeakIdxRef.current == null) return
      dragPeakIdxRef.current = null
      setDragPeakIdx(null)
      setCursor('')
    }

    const handleGlobalOut = () => {
      if (dragPeakIdxRef.current == null) setCursor('')
    }

    zr.on('mousedown', handleMouseDown)
    zr.on('mousemove', handleHoverMove)
    zr.on('globalout', handleGlobalOut)
    window.addEventListener('mousemove', handleWindowMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('blur', stopDrag)

    return () => {
      zr.off('mousedown', handleMouseDown)
      zr.off('mousemove', handleHoverMove)
      zr.off('globalout', handleGlobalOut)
      window.removeEventListener('mousemove', handleWindowMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('blur', stopDrag)
      setCursor('')
    }
  }, [chartKey, ctx.sub.params.yScale, pickPeakAtPixel, spectrum])

  const chartOption = buildSpectrumChartOption({
    spectrum,
    peaks: ctx.sub.peaks,
    overlays,
    focusedPeakIdx: dragPeakIdx ?? actions.focusedPeakIdx,
    logY: ctx.sub.params.yScale === 'log',
  })
  return (
    <div style={S.left}>
      {spectrum ? (
        <div style={S.chartWrap}>
          <ReactECharts
            ref={assignChartRef}
            key={chartKey}
            option={chartOption}
            notMerge
            lazyUpdate={false}
            className="workbench-xrd-echarts"
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
          <ProgressOverlay busy={actions.busy} />
        </div>
      ) : (
        <div style={S.emptyChart}>
          <EmptyState
            icon={<FlaskConical size={32} strokeWidth={1.2} />}
            title="No spectrum loaded"
            hint="Drag a spectrum file onto the window to get started."
          />
        </div>
      )}
    </div>
  )
}
