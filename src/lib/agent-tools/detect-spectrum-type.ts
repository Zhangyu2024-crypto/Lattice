// `detect_spectrum_type` — port of lattice-cli's `tools/detect_type.py`.
//
// Pure-TS heuristic (no worker call) so it stays cheap and synchronous.
// Three signal layers:
//   1. file-extension (strong, used first when present)
//   2. x-axis range + monotonicity (mid-strength)
//   3. column-header keywords (weak, currently optional)
//
// Returns the best-guess type with a confidence score and the reasons
// the classifier picked it, so the agent can show its work.

import type { LocalTool } from '../../types/agent-tool'

type CurveType = 'xrd' | 'xps' | 'raman' | 'ftir' | 'curve'

interface Input {
  /** Source filename, with or without path. Optional. */
  filename?: string
  /** Sample of x values (full or first ~512). */
  xValues: number[]
  /** Sample of y values matching xValues. */
  yValues?: number[]
  /** Optional column headers from a CSV/TSV. */
  headers?: string[]
}

interface Output {
  type: CurveType
  confidence: number
  reasons: string[]
}

const EXT_MAP: Record<string, CurveType> = {
  xrdml: 'xrd',
  raw: 'xrd',
  uxd: 'xrd',
  chi: 'xrd',
  vms: 'xps',
  vamas: 'xps',
  spe: 'xps',
  npl: 'xps',
  wdf: 'raman',
  spc: 'raman',
  rruf: 'raman',
  spa: 'ftir',
  jdx: 'ftir',
}

const HEADER_HINTS: Array<{ pattern: RegExp; type: CurveType; weight: number }> =
  [
    { pattern: /two[\s_-]?theta|2\s*theta|2θ/i, type: 'xrd', weight: 0.4 },
    { pattern: /binding\s*energy|kinetic\s*energy|\bbe\b/i, type: 'xps', weight: 0.4 },
    { pattern: /raman\s*shift|cm\s*\^?-?1|wavenumber/i, type: 'raman', weight: 0.3 },
    { pattern: /transmittance|absorbance|FT-?IR/i, type: 'ftir', weight: 0.3 },
  ]

function extension(filename?: string): string | null {
  if (!filename) return null
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)(?:\?.*)?$/)
  return m ? m[1] : null
}

function isMonotone(arr: number[]): 'up' | 'down' | 'mixed' {
  if (arr.length < 2) return 'mixed'
  let up = 0
  let down = 0
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[i - 1]) up++
    else if (arr[i] < arr[i - 1]) down++
  }
  const tot = up + down || 1
  if (up / tot > 0.95) return 'up'
  if (down / tot > 0.95) return 'down'
  return 'mixed'
}

export const detectSpectrumTypeTool: LocalTool<Input, Output> = {
  name: 'detect_spectrum_type',
  description:
    'Heuristically classify a curve as xrd / xps / raman / ftir / curve from filename + x-range + headers. Use when the agent has just received a spectrum file and needs to pick the right Pro workbench technique.',
  trustLevel: 'safe',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string' },
      xValues: {
        type: 'array',
        description: 'X-axis sample (numbers).',
      },
      yValues: { type: 'array' },
      headers: {
        type: 'array',
        description: 'Optional column headers from a CSV/TSV.',
      },
    },
    required: ['xValues'],
  },
  async execute(input) {
    const reasons: string[] = []
    if (!input?.xValues || input.xValues.length < 4) {
      throw new Error('detect_spectrum_type: need at least 4 x values')
    }

    // Layer 1 — extension
    const ext = extension(input.filename)
    if (ext && ext in EXT_MAP) {
      const t = EXT_MAP[ext]
      reasons.push(`file extension .${ext} → ${t}`)
      return { type: t, confidence: 0.95, reasons }
    }
    if (ext === 'cif') {
      // Crystal structure → tag as xrd-related so users land in XRD tooling.
      reasons.push('file extension .cif (crystal structure → XRD)')
      return { type: 'xrd', confidence: 0.85, reasons }
    }

    // Layer 2 — x-axis range + monotonicity
    const xs = input.xValues
    const min = Math.min(...xs)
    const max = Math.max(...xs)
    const dir = isMonotone(xs)
    reasons.push(
      `x range ${min.toFixed(1)} → ${max.toFixed(1)} (${dir}, n=${xs.length})`,
    )

    // XRD: 5–90° 2θ, monotonic up
    if (dir === 'up' && min >= 2 && max <= 130 && max - min >= 10) {
      reasons.push('range matches XRD 2θ window')
      return { type: 'xrd', confidence: 0.7, reasons }
    }
    // XPS: binding-energy axis runs descending in eV, ~0–1500
    if (dir === 'down' && min >= 0 && max <= 1500 && max - min >= 50) {
      reasons.push('range matches XPS binding-energy window (descending)')
      return { type: 'xps', confidence: 0.7, reasons }
    }
    // FTIR: ~400–4000 cm⁻¹, often descending in spectroscope output
    if (
      (dir === 'up' || dir === 'down') &&
      min >= 200 &&
      max <= 5000 &&
      max - min >= 500
    ) {
      reasons.push('range matches IR / Raman cm⁻¹ window')
      // Layer 3 — header hints to disambiguate FTIR vs Raman
      let ftirScore = 0
      let ramanScore = 0
      for (const h of input.headers ?? []) {
        for (const hint of HEADER_HINTS) {
          if (hint.pattern.test(h)) {
            if (hint.type === 'ftir') ftirScore += hint.weight
            if (hint.type === 'raman') ramanScore += hint.weight
          }
        }
      }
      if (ftirScore > ramanScore && ftirScore > 0) {
        reasons.push(`header hints favour FTIR (score ${ftirScore.toFixed(2)})`)
        return { type: 'ftir', confidence: 0.65, reasons }
      }
      if (ramanScore > 0) {
        reasons.push(`header hints favour Raman (score ${ramanScore.toFixed(2)})`)
        return { type: 'raman', confidence: 0.65, reasons }
      }
      // Tie-break: peaks at low cm⁻¹ → Raman (most Raman ranges 100-3500),
      // wide FTIR-like span → FTIR.
      if (max <= 3500) {
        reasons.push('default in IR window → raman')
        return { type: 'raman', confidence: 0.55, reasons }
      }
      return { type: 'ftir', confidence: 0.5, reasons }
    }

    // Header hints alone (Layer 3) — weakest signal, used only when
    // x-range is ambiguous.
    for (const h of input.headers ?? []) {
      for (const hint of HEADER_HINTS) {
        if (hint.pattern.test(h)) {
          reasons.push(`header "${h}" → ${hint.type}`)
          return { type: hint.type, confidence: 0.5, reasons }
        }
      }
    }

    reasons.push('no strong signals — falling back to generic curve')
    return { type: 'curve', confidence: 0.4, reasons }
  },
}
