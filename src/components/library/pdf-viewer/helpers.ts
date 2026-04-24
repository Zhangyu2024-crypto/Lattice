import { GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { CSSProperties } from 'react'
import { POLYFILL_SOURCE } from '../../../lib/polyfills/uint8array-tohex'

// Typed container for inline CSS custom properties (per-page / per-
// annotation dimensions + colors). React's DOM style prop only accepts
// string-indexed keys for `--vars`; this narrowing keeps `as any` out.
export type CSSVarStyle = CSSProperties & Record<`--${string}`, string | number>

export type SelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

let workerWrapperUrl: string | null = null

export function ensurePdfWorker(): void {
  if (!workerWrapperUrl) {
    // In Vite dev, `?url` can resolve to `/node_modules/...`. When that
    // string is imported from a `blob:` wrapper module, the worker realm no
    // longer has an HTTP base URL and pdfjs falls back to fake-worker mode.
    // Resolve it against the current location first so the wrapped import is
    // always a fully-qualified URL.
    const resolvedWorkerUrl = new URL(pdfWorkerUrl, window.location.href).href
    const source = `${POLYFILL_SOURCE}\nimport ${JSON.stringify(resolvedWorkerUrl)};\n`
    workerWrapperUrl = URL.createObjectURL(
      new Blob([source], { type: 'text/javascript' }),
    )
  }
  if (GlobalWorkerOptions.workerSrc !== workerWrapperUrl) {
    GlobalWorkerOptions.workerSrc = workerWrapperUrl
  }
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function alphaColor(hex: string, alpha: number): string {
  const value = hex.trim()
  const normalized = value.startsWith('#') ? value.slice(1) : value
  if (normalized.length !== 6) return `rgba(255, 235, 59, ${alpha})`
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    return `rgba(255, 235, 59, ${alpha})`
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function parentElementForNode(node: Node | null): Element | null {
  if (!node) return null
  return node instanceof Element ? node : node.parentElement
}
