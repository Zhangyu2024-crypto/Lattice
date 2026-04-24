import { CHART_FONT_MONO } from './chart-font-stacks'

interface PeakMarkerInput {
  x: number
  y: number
  name: string
  color: string
  symbolSize?: number
  symbolOffsetY?: number
  labelFontSize?: number
  labelDistance?: number
}

export function buildPeakMarker({
  x,
  y,
  name,
  color,
  symbolSize = 12,
  symbolOffsetY = -8,
  labelFontSize = 10,
  labelDistance = 7,
}: PeakMarkerInput) {
  const stroke = mixHex(color, '#888888', 0.45)
  const labelText = mixHex(color, '#D0D0D0', 0.52)
  return {
    coord: [x, y],
    name,
    // Hollow diamond: visually lighter than `pin`, still reads as a
    // deliberate scientific annotation and stays crisp over dense traces.
    symbol: 'diamond',
    symbolSize,
    symbolOffset: [0, symbolOffsetY],
    itemStyle: {
      color: '#171A1F',
      borderColor: stroke,
      borderWidth: 1.6,
      shadowBlur: 4,
      shadowColor: alphaHex(stroke, 0.18),
    },
    label: {
      show: true,
      position: 'top',
      distance: labelDistance,
      formatter: '{b}',
      fontSize: labelFontSize,
      fontFamily: CHART_FONT_MONO,
      fontWeight: 500,
      color: labelText,
      backgroundColor: 'rgba(16,20,26,0.84)',
      borderColor: alphaHex(stroke, 0.3),
      borderWidth: 1,
      borderRadius: 4,
      padding: [2, 6, 2, 6],
    },
  }
}

function mixHex(left: string, right: string, amount: number): string {
  const a = hexToRgb(left)
  const b = hexToRgb(right)
  const t = clamp01(amount)
  return rgbToHex({
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  })
}

function alphaHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 148, g: 163, b: 184 }
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function rgbToHex({
  r,
  g,
  b,
}: {
  r: number
  g: number
  b: number
}): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function toHex(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0')
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
