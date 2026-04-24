// Williamson-Hall analysis — isolates size vs strain broadening by
// plotting β·cosθ against 4·sinθ across the detected peak set. In the
// Uniform Deformation Model the result is a straight line whose
// intercept = Kλ/D (crystallite size) and slope = ε (microstrain).
//
// The linear fit is done purely client-side; the backend doesn't need to
// be involved. The SVG plot is hand-rolled (rather than ECharts) because
// W-H is a 3–20 point scatter in a side panel — raw SVG keeps the bundle
// small and the render deterministic.

import { useMemo } from 'react'
import {
  WAVELENGTH_TO_ANGSTROM,
  deconvolveInstrumentalFwhm,
} from '../../../../lib/xrd-instruments'
import type { XrdProPeak } from '../../../../types/artifact'
import { ProEmpty, ProSection } from '../../../common/pro'

interface WilliamsonHallPoint {
  fourSinTheta: number
  betaCos: number
  pos: number
}

interface WilliamsonHallFitResult {
  points: WilliamsonHallPoint[]
  sizeNm: number | null
  microstrainPct: number | null
  rSquared: number | null
}

function williamsonHallFit(
  peaks: XrdProPeak[],
  wavelengthAngstrom: number,
  instrumentalFwhm: number,
  kFactor: number,
): WilliamsonHallFitResult {
  const points = peaks
    .filter((p) => p.fwhm != null && p.fwhm > 0)
    .map((p) => {
      const obs = p.fwhm as number
      const corrected = deconvolveInstrumentalFwhm(obs, instrumentalFwhm)
      if (corrected <= 0) return null
      const theta = (p.position * Math.PI) / 180 / 2
      const betaRad = (corrected * Math.PI) / 180
      return {
        fourSinTheta: 4 * Math.sin(theta),
        betaCos: betaRad * Math.cos(theta),
        pos: p.position,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (points.length < 3) {
    return {
      points,
      sizeNm: null,
      microstrainPct: null,
      rSquared: null,
    }
  }

  // Ordinary least-squares: y = m·x + b
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.fourSinTheta, 0)
  const sumY = points.reduce((s, p) => s + p.betaCos, 0)
  const sumXX = points.reduce((s, p) => s + p.fourSinTheta * p.fourSinTheta, 0)
  const sumXY = points.reduce((s, p) => s + p.fourSinTheta * p.betaCos, 0)
  const meanX = sumX / n
  const meanY = sumY / n
  const denom = sumXX - n * meanX * meanX
  if (Math.abs(denom) < 1e-12) {
    return { points, sizeNm: null, microstrainPct: null, rSquared: null }
  }
  const slope = (sumXY - n * meanX * meanY) / denom
  const intercept = meanY - slope * meanX

  // R² for the fit quality
  const ssTot = points.reduce((s, p) => s + (p.betaCos - meanY) ** 2, 0)
  const ssRes = points.reduce(
    (s, p) => s + (p.betaCos - (slope * p.fourSinTheta + intercept)) ** 2,
    0,
  )
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null

  // Size from intercept (convert Å to nm). Intercept = Kλ/D ⇒ D = Kλ/intercept
  const sizeNm =
    intercept > 0 ? (kFactor * wavelengthAngstrom) / intercept / 10 : null
  // Microstrain ε (dimensionless) expressed as percent
  const microstrainPct = slope * 100

  return { points, sizeNm, microstrainPct, rSquared }
}

interface WilliamsonHallSectionProps {
  peaks: XrdProPeak[]
  kFactor: number
  instrumentalFwhm: number
  wavelength: string
}

export default function WilliamsonHallSection({
  peaks,
  kFactor,
  instrumentalFwhm,
  wavelength,
}: WilliamsonHallSectionProps) {
  const result = useMemo(
    () =>
      williamsonHallFit(
        peaks,
        WAVELENGTH_TO_ANGSTROM[wavelength] ?? 1.5406,
        instrumentalFwhm,
        kFactor,
      ),
    [peaks, kFactor, instrumentalFwhm, wavelength],
  )

  const { points, sizeNm, microstrainPct, rSquared } = result

  return (
    <ProSection title="Williamson-Hall (size + strain)" defaultOpen={false}>
      {points.length < 3 ? (
        <ProEmpty compact>
          Need ≥3 peaks with FWHM across a wide 2θ range
        </ProEmpty>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6,
              padding: '4px 0 8px',
            }}
          >
            <WhMetric
              label="D"
              value={sizeNm != null ? `${sizeNm.toFixed(1)} nm` : '—'}
            />
            <WhMetric
              label="ε"
              value={
                microstrainPct != null
                  ? `${(microstrainPct * 1).toFixed(3)} %`
                  : '—'
              }
            />
            <WhMetric
              label="R²"
              value={rSquared != null ? rSquared.toFixed(3) : '—'}
            />
          </div>
          <WilliamsonHallPlot points={points} />
          <div
            style={{
              fontSize: 'var(--text-xxs)',
              color: 'var(--color-text-muted)',
              lineHeight: 1.4,
              padding: '6px 2px 0',
            }}
          >
            Uniform Deformation Model: β·cosθ = Kλ/D + 4ε·sinθ. Intercept →
            size, slope → microstrain. Relative values; treat as comparative.
          </div>
        </>
      )}
    </ProSection>
  )
}

function WhMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '6px 8px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-base)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-xxs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function WilliamsonHallPlot({
  points,
}: {
  points: Array<{ fourSinTheta: number; betaCos: number }>
}) {
  const W = 260
  const H = 120
  const PAD = { l: 30, r: 8, t: 6, b: 20 }
  const xs = points.map((p) => p.fourSinTheta)
  const ys = points.map((p) => p.betaCos)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(0, ...ys)
  const yMax = Math.max(...ys)
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1
  const toX = (x: number) =>
    PAD.l + ((x - xMin) / xSpan) * (W - PAD.l - PAD.r)
  const toY = (y: number) =>
    H - PAD.b - ((y - yMin) / ySpan) * (H - PAD.t - PAD.b)

  // Recompute regression for plotting (same math as williamsonHallFit)
  const n = points.length
  const mX = xs.reduce((s, v) => s + v, 0) / n
  const mY = ys.reduce((s, v) => s + v, 0) / n
  const denom = xs.reduce((s, v) => s + (v - mX) ** 2, 0)
  const slope =
    denom > 1e-12
      ? xs.reduce((s, v, i) => s + (v - mX) * (ys[i] - mY), 0) / denom
      : 0
  const intercept = mY - slope * mX
  const lineX1 = xMin
  const lineX2 = xMax
  const lineY1 = slope * lineX1 + intercept
  const lineY2 = slope * lineX2 + intercept

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-base)',
      }}
    >
      <line
        x1={PAD.l}
        y1={H - PAD.b}
        x2={W - PAD.r}
        y2={H - PAD.b}
        stroke="var(--color-border)"
      />
      <line
        x1={PAD.l}
        y1={PAD.t}
        x2={PAD.l}
        y2={H - PAD.b}
        stroke="var(--color-border)"
      />
      <line
        x1={toX(lineX1)}
        y1={toY(lineY1)}
        x2={toX(lineX2)}
        y2={toY(lineY2)}
        stroke="var(--color-accent)"
        strokeWidth={1.5}
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={toX(p.fourSinTheta)}
          cy={toY(p.betaCos)}
          r={2.5}
          fill="var(--color-text-primary)"
        />
      ))}
      <text
        x={W - PAD.r}
        y={H - 4}
        fontSize="9"
        textAnchor="end"
        fill="var(--color-text-muted)"
      >
        4 sin θ
      </text>
      <text
        x={4}
        y={PAD.t + 8}
        fontSize="9"
        fill="var(--color-text-muted)"
      >
        β cos θ
      </text>
    </svg>
  )
}
