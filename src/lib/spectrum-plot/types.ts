// Public types + shared constants for the spectrum-plot renderer.
//
// These are split out so the option builder, series transformers, and
// the render core can all import from a single shared surface without
// creating a circular dependency back into `spectrum-plot.ts`.

import type { JournalStyle } from '../publication-style'

// ── Output format (inferred from file extension by the calling tool) ──

export type OutputFormat = 'png' | 'svg'

// ── Peak / reference / panel specs ──

export interface PeakSpec {
  x: number
  label?: string
}

export interface ReferenceSpec {
  label: string
  x: number[]
  y: number[]
  color?: string
  dashed?: boolean
}

export interface PanelSpec {
  spectrum: import('../parsers/types').ParsedSpectrum
  peaks?: Array<number | PeakSpec>
  references?: ReferenceSpec[]
  title?: string
  logY?: boolean
  reverseX?: boolean
  xLabel?: string
  yLabel?: string
}

// ── Single-panel plot options ──

export interface PlotOptions {
  title?: string
  width: number
  height: number
  pixelRatio?: number
  journalStyle?: JournalStyle
  peaks?: Array<number | PeakSpec>
  references?: ReferenceSpec[]
  backgroundColor?: string
  xLabel?: string
  yLabel?: string
  /** Toggle axis grid lines. Default true. */
  grid?: boolean
  /** Log-scale y-axis. Default false. */
  logY?: boolean
  /** Force-show / force-hide legend. Default auto (show when overlays or
   *  multiple series exist). */
  showLegend?: boolean
  /** Output format. Inferred from the output extension by the calling
   *  tool; callers that set this explicitly bypass extension routing. */
  format?: OutputFormat
}

// ── Render core params / results ──

export interface RenderParams {
  width: number
  height: number
  pixelRatio?: number
  backgroundColor?: string
  format: OutputFormat
}

export type RenderedArtifact =
  | { format: 'png'; bytes: ArrayBuffer }
  | { format: 'svg'; text: string }

// ── Shared dimensional constants ──

export const DEFAULT_WIDTH = 1200
export const DEFAULT_HEIGHT = 720
export const INTER_PANEL_GAP_PX = 32
