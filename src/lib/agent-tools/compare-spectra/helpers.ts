// Pure helpers for `compare_spectra`: x-range clipping, amplitude
// normalisation, linear resampling onto a target grid, and small path
// utilities. All functions are side-effect-free so they can be unit
// tested in isolation.

import type { ParsedSpectrum } from '@/lib/parsers/types'
import type { NormaliseMode } from './types'

export function clipToXRange(
  spectrum: ParsedSpectrum,
  xRange: [number, number] | undefined,
): ParsedSpectrum {
  if (!xRange) return spectrum
  const [lo, hi] = xRange[0] < xRange[1] ? xRange : [xRange[1], xRange[0]]
  const x: number[] = []
  const y: number[] = []
  const n = Math.min(spectrum.x.length, spectrum.y.length)
  for (let i = 0; i < n; i++) {
    const xv = spectrum.x[i]
    if (xv >= lo && xv <= hi) {
      x.push(xv)
      y.push(spectrum.y[i])
    }
  }
  return { ...spectrum, x, y }
}

export function normaliseSpectrum(
  spectrum: ParsedSpectrum,
  mode: NormaliseMode,
): ParsedSpectrum {
  if (mode === 'none' || spectrum.y.length === 0) return spectrum
  const { y } = spectrum
  let divisor = 1
  if (mode === 'max') {
    let m = -Infinity
    for (const v of y) if (v > m) m = v
    divisor = m > 0 ? m : 1
  } else if (mode === 'area') {
    // Trapezoidal integral on |y| so we get a positive area for
    // spectra that dip below zero (residuals / difference curves).
    let area = 0
    for (let i = 1; i < y.length; i++) {
      const dx = spectrum.x[i] - spectrum.x[i - 1]
      area += Math.abs(dx) * (Math.abs(y[i]) + Math.abs(y[i - 1])) * 0.5
    }
    divisor = area > 0 ? area : 1
  }
  const yn = y.map((v) => v / divisor)
  return { ...spectrum, y: yn }
}

export function linearInterpolate(
  sourceX: number[],
  sourceY: number[],
  targetX: number[],
): number[] {
  const out = new Array<number>(targetX.length)
  const n = sourceX.length
  if (n === 0) return out.fill(0)
  // Assume sourceX monotonic (ascending). If descending, reverse first.
  let xs = sourceX
  let ys = sourceY
  if (sourceX[0] > sourceX[n - 1]) {
    xs = [...sourceX].reverse()
    ys = [...sourceY].reverse()
  }
  for (let i = 0; i < targetX.length; i++) {
    const x = targetX[i]
    if (x <= xs[0]) {
      out[i] = ys[0]
      continue
    }
    if (x >= xs[xs.length - 1]) {
      out[i] = ys[ys.length - 1]
      continue
    }
    // Binary search for x in xs.
    let lo = 0
    let hi = xs.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo])
    out[i] = ys[lo] * (1 - t) + ys[hi] * t
  }
  return out
}

export function globalYRange(spectra: ParsedSpectrum[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const s of spectra) {
    for (const v of s.y) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 1 }
  }
  return { min, max }
}

export function basename(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  const tail = segs[segs.length - 1] || relPath
  const dot = tail.lastIndexOf('.')
  return dot > 0 ? tail.slice(0, dot) : tail
}

export function replaceExt(relPath: string, newExt: string): string {
  const dot = relPath.lastIndexOf('.')
  const slash = Math.max(relPath.lastIndexOf('/'), relPath.lastIndexOf('\\'))
  const stem = dot > slash ? relPath.slice(0, dot) : relPath
  return stem + newExt
}
