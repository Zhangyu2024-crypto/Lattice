// Preview resolver for `xrd_search_phases`. Renders the LLM-adjudication
// verdict, element filter chips, interactive phase selection with
// stick-pattern comparison chart, and the candidate list.

import { useState, type ReactNode } from 'react'
import type { XrdProCandidate } from '../../../../types/artifact'
import type { ToolPreviewResolver } from '../preview-registry'
import { confidenceBar } from './helpers'

interface ExperimentalPeak {
  position: number
  intensity: number
}

interface SpectrumCurve {
  x: number[]
  y: number[]
}

interface XrdSearchOutput {
  candidates?: XrdProCandidate[]
  source?: string
  elements?: string[]
  experimentalPeaks?: ExperimentalPeak[]
  spectrumCurve?: SpectrumCurve
  identification?: {
    predictedPhases?: string[]
    confidence?: number
    reasoning?: string
    model?: string
    elements?: string[]
  } | null
}

export const xrdSearchPhasesPreview: ToolPreviewResolver = (step) => {
  const out = (step.output ?? {}) as XrdSearchOutput
  const candidates = out.candidates ?? []
  const ident = out.identification ?? null
  const picked = ident?.predictedPhases ?? []
  const elements = out.elements ?? ident?.elements ?? []
  const expPeaks = out.experimentalPeaks ?? []

  const verdictChip =
    picked.length > 0
      ? `${picked.length} phase${picked.length === 1 ? '' : 's'} @ ${(
          (ident?.confidence ?? 0) * 100
        ).toFixed(0)}%`
      : ident
        ? 'no verdict'
        : null
  const oneLiner = [
    verdictChip,
    `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`,
    out.source ? out.source : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const compact: ReactNode | undefined =
    candidates.length > 0 || ident ? (
      <XrdSearchCompact
        candidates={candidates}
        ident={ident}
        elements={elements}
        spectrumCurve={out.spectrumCurve}
        expPeaks={expPeaks}
        predictedPhases={picked}
      />
    ) : undefined

  return { oneLiner, compact }
}

// ── Interactive compact card ─────────────────────────────────────────

function XrdSearchCompact({
  candidates,
  ident,
  elements,
  expPeaks,
  predictedPhases,
  spectrumCurve,
}: {
  candidates: XrdProCandidate[]
  ident: XrdSearchOutput['identification']
  elements: string[]
  expPeaks: ExperimentalPeak[]
  predictedPhases: string[]
  spectrumCurve?: SpectrumCurve
}) {
  const predictedSet = new Set(predictedPhases)
  // Ensure LLM-predicted phases always appear in the list, even if
  // they ranked beyond position 8 in the retriever output.
  const predicted = candidates.filter(
    (c) => c.material_id != null && predictedSet.has(c.material_id),
  )
  const rest = candidates.filter(
    (c) => !c.material_id || !predictedSet.has(c.material_id),
  )
  const top = [
    ...predicted,
    ...rest.slice(0, Math.max(8 - predicted.length, 4)),
  ]

  // Track user-selected phases (initialized from LLM prediction)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(predictedPhases))

  const togglePhase = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const chartPhases = candidates.filter(
    (c) => c.material_id != null && selected.has(c.material_id) && (c.refPeaks?.length ?? 0) > 0,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Element chips */}
      {elements.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {elements.map((el) => (
            <span key={el} style={S.elementChip}>
              {el}
            </span>
          ))}
        </div>
      ) : null}

      {/* Assessment */}
      {ident ? (
        <div style={S.verdictBox}>
          <div style={S.verdictHeader}>
            <span>Assessment</span>
            <span>{((ident.confidence ?? 0) * 100).toFixed(0)}%</span>
            {ident.model ? (
              <span style={{ color: 'var(--color-text-muted)' }}>· {ident.model}</span>
            ) : null}
          </div>
          {predictedPhases.length > 0 ? (
            <div style={{ fontSize: 'var(--text-xs)' }}>
              {predictedPhases.join(', ')}
            </div>
          ) : (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              No phase was selected.
            </div>
          )}
          {ident.reasoning ? (
            <div style={S.reasoning}>{ident.reasoning}</div>
          ) : null}
        </div>
      ) : null}

      {/* Spectrum chart — responds to user selection */}
      {(spectrumCurve || expPeaks.length > 0) && chartPhases.length > 0 ? (
        <MatchChart curve={spectrumCurve} expPeaks={expPeaks} phases={chartPhases} />
      ) : expPeaks.length > 0 || spectrumCurve ? (
        <div style={S.chartHint}>
          Select phases below to see peak matching
        </div>
      ) : null}

      {/* Candidate list with checkboxes */}
      {top.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={S.listHeader}>
            <span style={{ width: 20 }} />
            <span style={{ flex: 1 }}>Phase</span>
            <span style={{ width: 50, textAlign: 'right' }}>Score</span>
            <span style={{ width: 45, textAlign: 'right' }}>Match</span>
          </div>
          {top.map((c) => {
            const id = c.material_id ?? ''
            const isLlmPick = predictedSet.has(id)
            const isSelected = selected.has(id)
            return (
              <button
                key={id || Math.random()}
                type="button"
                onClick={() => id && togglePhase(id)}
                style={{
                  ...S.candidateRow,
                  ...(isSelected ? S.candidateRowSelected : {}),
                  ...(isLlmPick ? S.candidateRowLlmPick : {}),
                }}
              >
                <span style={S.checkbox}>
                  {isSelected ? '☑' : '☐'}
                </span>
                <span style={S.candidateMain}>
                  {c.formula ?? c.name ?? id ?? '—'}
                  {c.space_group ? (
                    <span style={S.spaceGroup}> {c.space_group}</span>
                  ) : null}
                </span>
                <span style={S.candidateScore}>
                  {c.score != null ? c.score.toFixed(2) : '—'}
                  {confidenceBar(c.score)}
                </span>
                <span style={S.candidateMatch}>
                  {c.refPeaks ? `${countMatched(c, expPeaks)}/${Math.min(c.refPeaks.length, 8)}` : '—'}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function countMatched(candidate: XrdProCandidate, expPeaks: ExperimentalPeak[]): number {
  const refs = candidate.refPeaks ?? []
  let matched = 0
  for (const ref of refs.slice(0, 8)) {
    if (expPeaks.some((p) => Math.abs(p.position - ref.twoTheta) <= 0.3)) matched++
  }
  return matched
}

// ── Spectrum + reference peak matching chart ─────────────────────────

const PHASE_COLORS = [
  '#7eb0d5',
  '#e8a07a',
  '#a0c4a8',
  '#c9a9cc',
  '#d4a574',
]

const CHART_W = 340
const CHART_H = 120
const PAD_X = 6
const PAD_TOP = 6
const CURVE_H = 75
const REF_H = 25
const GAP = 4

function MatchChart({
  curve,
  expPeaks,
  phases,
}: {
  curve?: SpectrumCurve
  expPeaks: ExperimentalPeak[]
  phases: XrdProCandidate[]
}) {
  // Determine x range from curve or peaks
  const allX: number[] = []
  if (curve && curve.x.length > 0) {
    allX.push(curve.x[0], curve.x[curve.x.length - 1])
  }
  for (const p of expPeaks) allX.push(p.position)
  for (const ph of phases) {
    for (const rp of ph.refPeaks ?? []) allX.push(rp.twoTheta)
  }
  if (allX.length === 0) return null

  const xMin = Math.min(...allX) - 0.5
  const xMax = Math.max(...allX) + 0.5
  const xRange = xMax - xMin || 1
  const toX = (v: number) => PAD_X + ((v - xMin) / xRange) * (CHART_W - 2 * PAD_X)

  const curveBottom = PAD_TOP + CURVE_H
  const refTop = curveBottom + GAP
  const totalH = refTop + REF_H + 4

  // Build spectrum curve path
  let curvePath = ''
  if (curve && curve.x.length > 1) {
    const yMin = Math.min(...curve.y)
    const yMax = Math.max(...curve.y)
    const yRange = yMax - yMin || 1
    const toY = (v: number) => curveBottom - ((v - yMin) / yRange) * (CURVE_H - 4)
    curvePath = curve.x
      .map((xi, i) => `${i === 0 ? 'M' : 'L'}${toX(xi).toFixed(1)},${toY(curve.y[i]).toFixed(1)}`)
      .join(' ')
  }

  // Peak markers on the curve
  const peakMarkers = expPeaks.map((p) => {
    let cy = curveBottom - 4
    if (curve && curve.x.length > 1) {
      const yMin = Math.min(...curve.y)
      const yMax = Math.max(...curve.y)
      const yRange = yMax - yMin || 1
      // Find nearest y on curve for this peak position
      let nearest = curve.y[0]
      let bestDist = Infinity
      for (let i = 0; i < curve.x.length; i++) {
        const d = Math.abs(curve.x[i] - p.position)
        if (d < bestDist) { bestDist = d; nearest = curve.y[i] }
      }
      cy = curveBottom - ((nearest - yMin) / yRange) * (CURVE_H - 4)
    }
    return { x: toX(p.position), y: cy }
  })

  // Reference peak sticks (below the curve, inverted)
  const refGroups = phases.map((ph, idx) => {
    const refs = ph.refPeaks ?? []
    const maxRef = Math.max(...refs.map((r) => r.relIntensity), 1)
    const color = PHASE_COLORS[idx % PHASE_COLORS.length]
    const lines = refs.map((r) => {
      const x = toX(r.twoTheta)
      const h = (r.relIntensity / maxRef) * (REF_H - 2)
      return { x, y1: refTop, y2: refTop + h }
    })
    return { label: ph.formula ?? ph.name ?? '?', color, lines }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${totalH}`}
        width="100%"
        style={{
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Divider between curve area and ref sticks */}
        <line
          x1={PAD_X} y1={curveBottom + GAP / 2}
          x2={CHART_W - PAD_X} y2={curveBottom + GAP / 2}
          stroke="var(--color-border)" strokeWidth={0.5}
        />

        {/* Spectrum curve */}
        {curvePath ? (
          <path
            d={curvePath}
            fill="none"
            stroke="var(--color-text-secondary)"
            strokeWidth={1}
            opacity={0.8}
          />
        ) : null}

        {/* Peak position markers */}
        {peakMarkers.map((m, i) => (
          <circle
            key={`pm${i}`}
            cx={m.x} cy={m.y} r={2}
            fill="var(--color-text-primary)"
            opacity={0.7}
          />
        ))}

        {/* Reference peak sticks */}
        {refGroups.map((g) =>
          g.lines.map((l, i) => (
            <line
              key={`${g.label}-${i}`}
              x1={l.x} y1={l.y1} x2={l.x} y2={l.y2}
              stroke={g.color} strokeWidth={1.4} opacity={0.85}
            />
          )),
        )}

        {/* Labels */}
        <text x={CHART_W - PAD_X - 2} y={PAD_TOP + 8} fontSize={7}
          fill="var(--color-text-muted)" fontFamily="var(--font-sans)"
          textAnchor="end">
          Experimental
        </text>
        <text x={CHART_W - PAD_X - 2} y={totalH - 2} fontSize={7}
          fill="var(--color-text-muted)" fontFamily="var(--font-sans)"
          textAnchor="end">
          Reference
        </text>
      </svg>

      {/* Legend */}
      {refGroups.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 'var(--text-2xs)', color: 'var(--color-text-muted)' }}>
          {refGroups.map((g) => (
            <span key={g.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 8, height: 3, borderRadius: 1, background: g.color, flexShrink: 0 }} />
              {g.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────

import type { CSSProperties } from 'react'

const S: Record<string, CSSProperties> = {
  elementChip: {
    display: 'inline-block',
    padding: '1px 7px',
    borderRadius: 999,
    border: '1px solid var(--color-border)',
    background: 'rgba(255, 255, 255, 0.04)',
    fontSize: 'var(--text-xxs)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-text-primary)',
  },
  verdictBox: {
    padding: '6px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(255, 255, 255, 0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  verdictHeader: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    fontSize: 'var(--text-xxs)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-muted)',
  },
  reasoning: {
    fontSize: 'var(--text-xxs)',
    color: 'var(--color-text-muted)',
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
  },
  chartHint: {
    fontSize: 'var(--text-xxs)',
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
    padding: '4px 0',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 4px',
    fontSize: 'var(--text-2xs)',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    borderBottom: '1px solid var(--color-border)',
  },
  candidateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 4px',
    fontSize: 'var(--text-xs)',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
    color: 'var(--color-text-primary)',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    width: '100%',
    borderRadius: 0,
  },
  candidateRowSelected: {
    background: 'rgba(255, 255, 255, 0.04)',
    fontWeight: 600,
  },
  candidateRowLlmPick: {
    borderLeft: '2px solid color-mix(in srgb, var(--color-accent) 70%, var(--color-border))',
    paddingLeft: 2,
  },
  checkbox: {
    width: 20,
    flexShrink: 0,
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    textAlign: 'center',
  },
  candidateMain: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spaceGroup: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xxs)',
  },
  candidateScore: {
    width: 50,
    textAlign: 'right',
    flexShrink: 0,
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xxs)',
  },
  candidateMatch: {
    width: 45,
    textAlign: 'right',
    flexShrink: 0,
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xxs)',
  },
}
