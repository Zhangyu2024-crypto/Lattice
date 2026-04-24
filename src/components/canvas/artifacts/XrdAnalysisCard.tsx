import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { AtSign, CheckCircle2, FlaskConical, XCircle } from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import type { FocusedElementTarget } from '../../../types/session'
import type { MentionAddRequest } from '../../../lib/composer-bus'
import { buildSeriesChartInstanceKey } from '../../../lib/chart-instance-key'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Separator,
} from '../../ui'
import ContextMenu, { type ContextMenuItem } from '../../common/ContextMenu'
import { CHART_PRIMARY, CHART_SERIES_PALETTE } from '../../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'

interface MatchedPeak { position: number; hkl: string; intensity_obs: number; intensity_calc: number }

interface Phase {
  id: string; name: string; formula: string; spaceGroup: string; cifRef: string | null
  confidence: number; weightFraction: number | null
  matchedPeaks: MatchedPeak[]
  theoreticalPattern?: { x: number[]; y: number[] }
}

interface XrdAnalysisPayload {
  query: {
    range: [number, number]
    method: 'peak-match' | 'rietveld' | 'approximate-fit'
  }
  experimentalPattern: { x: number[]; y: number[]; xLabel: string; yLabel: string }
  phases: Phase[]
  rietveld: { rwp: number; gof: number; converged: boolean } | null
}

interface Props {
  artifact: Artifact
  /** Which phase (elementId) the inspector currently highlights, or null. */
  focusedPhaseId?: string | null
  /** Phase-row click → focus this phase in the inspector rail. */
  onFocusPhase?: (target: FocusedElementTarget) => void
  /** Context-menu "Mention in chat" action. */
  onMentionPhase?: (req: MentionAddRequest) => void
  /** "Open in XRD Lab" button action — host materialises a pro-workbench artifact. */
  onOpenInProWorkbench?: () => void
  className?: string
}

const EXP_COLOR = CHART_PRIMARY
const EXP_NAME = 'Experimental'
const PALETTE = [...CHART_SERIES_PALETTE]

function XrdAnalysisCardImpl({
  artifact,
  focusedPhaseId = null,
  onFocusPhase,
  onMentionPhase,
  onOpenInProWorkbench,
  className,
}: Props) {
  const payload = artifact.payload as unknown as XrdAnalysisPayload
  const phases = payload.phases
  const initialPhaseId = phases[0]?.id ?? null
  const phaseColors = useMemo<Record<string, string>>(
    () => Object.fromEntries(phases.map((p, i) => [p.id, PALETTE[i % PALETTE.length]])),
    [phases],
  )
  const [hiddenPhaseIds, setHiddenPhaseIds] = useState<Set<string>>(() => new Set())
  const [localSelectedPhaseId, setLocalSelectedPhaseId] = useState<string | null>(
    initialPhaseId,
  )
  useEffect(() => {
    setLocalSelectedPhaseId(initialPhaseId)
    setHiddenPhaseIds(new Set())
  }, [artifact.id, initialPhaseId])
  // The host-provided focus wins when present; otherwise fall back to the
  // local state so the chart still highlights a default phase on first
  // render before the user has interacted.
  const selectedPhaseId = focusedPhaseId ?? localSelectedPhaseId
  const handleSelectPhase = (id: string) => {
    setLocalSelectedPhaseId(id)
    if (!onFocusPhase) return
    const phase = phases.find((p) => p.id === id)
    onFocusPhase({
      artifactId: artifact.id,
      elementKind: 'phase',
      elementId: id,
      label: phase?.name,
    })
  }
  const chartOption = useMemo(
    () => buildChartOption(payload, phaseColors, hiddenPhaseIds),
    [payload, phaseColors, hiddenPhaseIds],
  )
  const chartKey = useMemo(
    () =>
      buildSeriesChartInstanceKey({
        x: payload.experimentalPattern.x,
        y: payload.experimentalPattern.y,
        sourceFile: artifact.sourceFile ?? artifact.id,
        seriesType: 'xrd-analysis',
      }),
    [
      artifact.id,
      artifact.sourceFile,
      payload.experimentalPattern.x,
      payload.experimentalPattern.y,
    ],
  )
  const onEvents = useMemo(
    () => ({
      legendselectchanged: (e: { selected: Record<string, boolean> }) => {
        const next = new Set<string>()
        for (const p of phases) if (e.selected[p.name] === false) next.add(p.id)
        setHiddenPhaseIds(next)
      },
    }),
    [phases],
  )
  const selectedPhase = phases.find((p) => p.id === selectedPhaseId) ?? null

  // Right-click → "Mention in chat" on a phase row. Same single-action menu
  // as PeakFitArtifactCard — keep the two implementations shape-compatible so
  // we can extract a shared `useRowMentionMenu` hook later if more artifact
  // kinds grow the affordance.
  const [menuState, setMenuState] = useState<{
    x: number
    y: number
    phase: Phase
  } | null>(null)
  const openPhaseMenu = useCallback(
    (phase: Phase, e: React.MouseEvent) => {
      if (!onMentionPhase) return
      e.preventDefault()
      setMenuState({ x: e.clientX, y: e.clientY, phase })
    },
    [onMentionPhase],
  )
  const closeMenu = useCallback(() => setMenuState(null), [])
  const menuPhase = menuState?.phase ?? null
  const menuItems: ContextMenuItem[] = menuPhase && onMentionPhase
    ? [
        {
          label: 'Mention in chat',
          icon: <AtSign size={12} />,
          onClick: () => {
            onMentionPhase({
              ref: {
                type: 'artifact-element',
                sessionId: '',
                artifactId: artifact.id,
                elementKind: 'phase',
                elementId: menuPhase.id,
                label: menuPhase.name,
              },
              label: menuPhase.name,
            })
          },
        },
      ]
    : []

  const rootClassName = className ? `card-xrd-root ${className}` : 'card-xrd-root'

  return (
    <Card borderless className={rootClassName}>
      <CardHeader
        title={
          <span className="card-xrd-title">
            <Badge variant="type-xrd" size="sm">XRD</Badge>
            <span>{phases.length} phase{phases.length === 1 ? '' : 's'}</span>
          </span>
        }
        subtitle={`method · ${payload.query.method}`}
        actions={
          onOpenInProWorkbench ? (
            <Button
              variant="primary"
              size="sm"
              leading={<FlaskConical size={12} />}
              onClick={onOpenInProWorkbench}
              title="Clone this snapshot into an interactive Pro workbench"
            >
              Open in XRD Lab
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        <div className="card-xrd-chart-wrap">
          <ReactECharts
            key={chartKey}
            option={chartOption}
            onEvents={onEvents}
            notMerge
            className="card-xrd-chart"
            opts={{ renderer: 'canvas' }}
          />
        </div>
        <div className="card-xrd-split-row">
          <PhaseList
            phases={phases}
            phaseColors={phaseColors}
            selectedPhaseId={selectedPhaseId}
            onSelect={handleSelectPhase}
            onRowContextMenu={openPhaseMenu}
          />
          <Separator orientation="vertical" className="card-xrd-separator" />
          <DetailPane selectedPhase={selectedPhase} rietveld={payload.rietveld} />
        </div>
      </CardBody>
      <ContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        items={menuItems}
        onClose={closeMenu}
      />
    </Card>
  )
}

const AXIS_STYLE = {
  type: 'value' as const,
  nameLocation: 'middle' as const,
  nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.sm },
  axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
  axisLine: { lineStyle: { color: '#2A2A2A' } },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
}

function buildChartOption(
  payload: XrdAnalysisPayload,
  phaseColors: Record<string, string>,
  hidden: Set<string>,
) {
  const exp = payload.experimentalPattern
  const phaseSeries = payload.phases
    .filter((p) => p.theoreticalPattern)
    .map((p) => ({
      name: p.name,
      type: 'line' as const,
      data: p.theoreticalPattern!.x.map((x, i) => [x, p.theoreticalPattern!.y[i]]),
      showSymbol: false,
      lineStyle: { color: phaseColors[p.id], width: 1.25, opacity: 0.9 },
      itemStyle: { color: phaseColors[p.id] },
      z: 2,
    }))
  const legendSelected: Record<string, boolean> = { [EXP_NAME]: true }
  for (const p of payload.phases) legendSelected[p.name] = !hidden.has(p.id)
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 36, right: 24, bottom: 60, left: 64 },
    legend: {
      data: [EXP_NAME, ...payload.phases.map((p) => p.name)],
      selected: legendSelected,
      right: 24, top: 6, itemWidth: 14, itemHeight: 8,
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      inactiveColor: '#4a4a5a',
    },
    xAxis: { ...AXIS_STYLE, name: exp.xLabel, nameGap: 32 },
    yAxis: { ...AXIS_STYLE, name: exp.yLabel, nameGap: 48 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      {
        type: 'slider', xAxisIndex: 0, bottom: 8, height: 18,
        borderColor: '#2A2A2A', fillerColor: 'rgba(232,232,232,0.12)',
        textStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
      },
    ],
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.sm },
      axisPointer: { lineStyle: { color: EXP_COLOR, width: 1 } },
    },
    series: [
      {
        name: EXP_NAME,
        type: 'line' as const,
        data: exp.x.map((x, i) => [x, exp.y[i]]),
        showSymbol: false,
        lineStyle: { color: EXP_COLOR, width: 1.5 },
        itemStyle: { color: EXP_COLOR },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(232,232,232,0.16)' },
              { offset: 1, color: 'rgba(232,232,232,0)' },
            ],
          },
        },
        z: 1,
      },
      ...phaseSeries,
    ],
  }
}

function PhaseList({
  phases, phaseColors, selectedPhaseId, onSelect, onRowContextMenu,
}: {
  phases: Phase[]
  phaseColors: Record<string, string>
  selectedPhaseId: string | null
  onSelect: (id: string) => void
  onRowContextMenu?: (phase: Phase, e: React.MouseEvent) => void
}) {
  if (phases.length === 0)
    return (
      <div className="card-xrd-col">
        <EmptyState compact title="No phases identified" />
      </div>
    )
  return (
    <div className="card-xrd-col">
      {phases.map((phase) => {
        const isSelected = phase.id === selectedPhaseId
        return (
          <button
            key={phase.id}
            type="button"
            className={`card-xrd-phase-row${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(phase.id)}
            onContextMenu={(e) => onRowContextMenu?.(phase, e)}
          >
            <span
              className="card-xrd-dot"
              style={{ '--dot-color': phaseColors[phase.id] } as React.CSSProperties}
            />
            <div className="card-xrd-phase-body">
              <div className="card-xrd-phase-head">
                <strong className="card-xrd-phase-name">{phase.name}</strong>
                <span className="card-xrd-meta-mono">{phase.formula}</span>
                <span className="card-xrd-meta-muted">SG: {phase.spaceGroup}</span>
                {phase.weightFraction != null && (
                  <span className="card-xrd-meta-mono">wt% {(phase.weightFraction * 100).toFixed(0)}</span>
                )}
              </div>
              <ConfidenceBar value={phase.confidence} />
            </div>
          </button>
        )
      })}
    </div>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value))
  const color = pct >= 0.8 ? 'var(--color-green)' : pct >= 0.6 ? 'var(--color-accent)' : 'var(--color-yellow)'
  // Width + color are both dynamic here: the width goes to --val, the
  // green/yellow/accent threshold goes to --conf-color. Each confidence bar
  // is a stateless presentation of one phase's value.
  const fillStyle = {
    '--val': `${pct * 100}%`,
    '--conf-color': color,
  } as React.CSSProperties
  return (
    <div className="card-xrd-conf-wrap">
      <div className="card-xrd-conf-track">
        <div className="card-xrd-conf-fill" style={fillStyle} />
      </div>
      <span className="card-xrd-conf-pct">{(pct * 100).toFixed(0)}%</span>
    </div>
  )
}

function DetailPane({
  selectedPhase, rietveld,
}: {
  selectedPhase: Phase | null
  rietveld: XrdAnalysisPayload['rietveld']
}) {
  return (
    <div className="card-xrd-col">
      {selectedPhase ? (
        <MatchedPeaksTable peaks={selectedPhase.matchedPeaks} />
      ) : rietveld ? (
        <RietveldMetrics rietveld={rietveld} />
      ) : (
        <EmptyState compact title="No Rietveld refinement" />
      )}
    </div>
  )
}

function MatchedPeaksTable({ peaks }: { peaks: Phase['matchedPeaks'] }) {
  if (peaks.length === 0) return <EmptyState compact title="No matched peaks" />
  return (
    <table className="card-xrd-table">
      <thead>
        <tr className="card-xrd-table-head-row">
          <th className="card-xrd-th">Position</th>
          <th className="card-xrd-th">hkl</th>
          <th className="card-xrd-th">I_obs</th>
          <th className="card-xrd-th">I_calc</th>
        </tr>
      </thead>
      <tbody>
        {peaks.map((peak, i) => (
          <tr key={`${peak.hkl}-${i}`} className="card-xrd-peak-row">
            <td className="card-xrd-td">{peak.position.toFixed(2)}</td>
            <td className="card-xrd-td card-xrd-td--hkl">{peak.hkl}</td>
            <td className="card-xrd-td">{peak.intensity_obs.toFixed(1)}</td>
            <td className="card-xrd-td">{peak.intensity_calc.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RietveldMetrics({ rietveld }: { rietveld: NonNullable<XrdAnalysisPayload['rietveld']> }) {
  const converged = rietveld.converged ? (
    <span className="card-xrd-metric-span is-ok">
      <CheckCircle2 size={13} /> yes
    </span>
  ) : (
    <span className="card-xrd-metric-span is-bad">
      <XCircle size={13} /> no
    </span>
  )
  return (
    <div className="card-xrd-metrics-box">
      <MetricRow label="Rwp" value={`${rietveld.rwp.toFixed(2)}%`} />
      <MetricRow label="GoF" value={rietveld.gof.toFixed(2)} />
      <MetricRow label="Converged" value={converged} />
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card-xrd-metric-row">
      <span className="card-xrd-metric-label">{label}</span>
      <span className="card-xrd-metric-value">{value}</span>
    </div>
  )
}

// `artifact` is referentially stable via Zustand's immutable updates, so
// default shallow-prop compare on this single-prop component is effectively
// a per-artifact cache. A write to any sibling artifact no longer re-renders
// this card.
export default memo(XrdAnalysisCardImpl)
