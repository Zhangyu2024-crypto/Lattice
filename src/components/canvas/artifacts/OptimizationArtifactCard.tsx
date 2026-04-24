import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  ArrowUpDown, CheckCircle2, Circle, Loader2, Pause, Plus,
  TrendingDown, TrendingUp, XCircle,
} from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import { CHART_PRIMARY, CHART_SECONDARY, CHART_TERTIARY } from '../../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { toast } from '../../../stores/toast-store'
import { Badge, Button, EmptyState, type BadgeVariant } from '../../ui'

interface OptObjective { name: string; direction: 'minimize' | 'maximize'; unit?: string }
interface OptParameter { name: string; type: 'continuous' | 'discrete'; low: number; high: number; unit?: string }
interface OptTrial {
  id: string; iter: number; params: Record<string, number>; objective: number
  timestamp: number; status: 'pending' | 'completed' | 'failed'
}
interface OptNextCandidate { params: Record<string, number>; expectedObjective: number; uncertainty: number }
interface OptimizationPayload {
  strategy: 'bayesian' | 'grid' | 'random'
  objective: OptObjective
  parameters: OptParameter[]
  trials: OptTrial[]
  currentBest: OptTrial | null
  nextCandidates: OptNextCandidate[]
  status: 'running' | 'converged' | 'paused'
}

type SortDir = 'asc' | 'desc'
type SortColumn = 'iter' | 'objective' | 'status' | 'time' | string

const BEST_LINE = CHART_SECONDARY
const DONE = CHART_PRIMARY
const FAILED = '#E0E0E0'
const PENDING = '#666666'
const CONVERGED = CHART_TERTIARY
const SELECTED = '#FFFFFF'

interface Props {
  artifact: Artifact
  /** Persist an in-place payload patch after queueing a candidate trial. */
  onPatchPayload?: (nextPayload: OptimizationPayload) => void
  className?: string
}

export default function OptimizationArtifactCard({
  artifact,
  onPatchPayload,
  className,
}: Props) {
  const payload = artifact.payload as unknown as OptimizationPayload
  const { strategy, objective, parameters, trials, currentBest, nextCandidates, status } = payload

  const [sortColumn, setSortColumn] = useState<SortColumn>('iter')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null)

  const bestRunning = useMemo(() => computeRunningBest(trials, objective.direction), [trials, objective.direction])
  const chartOption = useMemo(
    () => buildChartOption(trials, bestRunning, objective, selectedTrialId),
    [trials, bestRunning, objective, selectedTrialId],
  )
  const sortedTrials = useMemo(() => sortTrials(trials, sortColumn, sortDir), [trials, sortColumn, sortDir])

  const onHeaderClick = (col: SortColumn) => {
    if (sortColumn === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortColumn(col); setSortDir(col === 'iter' ? 'desc' : 'asc') }
  }
  const onChartEvent = useMemo(() => ({
    click: (e: { seriesType: string; data: unknown }) => {
      if (e.seriesType !== 'scatter') return
      const id = (e.data as { value?: [number, number, string] } | undefined)?.value?.[2]
      if (typeof id !== 'string') return
      setSelectedTrialId((prev) => (prev === id ? null : id))
    },
  }), [])
  const handleQueueCandidate = useCallback((candidate: OptNextCandidate, candidateIndex: number) => {
    if (!onPatchPayload) return
    const nextIter = trials.reduce((maxIter, trial) => Math.max(maxIter, trial.iter), -1) + 1
    const nextTrial: OptTrial = {
      id: `trial_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      iter: nextIter,
      params: { ...candidate.params },
      objective: 0,
      timestamp: Date.now(),
      status: 'pending',
    }

    onPatchPayload({
      ...payload,
      trials: [...trials, nextTrial],
      nextCandidates: nextCandidates.filter((_, idx) => idx !== candidateIndex),
      status: 'running',
    })

    setSelectedTrialId(nextTrial.id)
    toast.success(`Queued trial ${nextIter} for ${formatParamPreview(candidate.params, parameters)}`)
  }, [nextCandidates, onPatchPayload, parameters, payload, trials])

  const DirIcon = objective.direction === 'maximize' ? TrendingUp : TrendingDown
  const objUnit = objective.unit ? ` ${objective.unit}` : ''
  const objLabel = `${objective.name}${objective.unit ? ` (${objective.unit})` : ''}`
  const now = Date.now()
  const { Icon: StatusIcon, spin: statusSpin, variant: statusVariant } = statusVisual(status)

  const rootClassName = className
    ? `card-optimization-root ${className}`
    : 'card-optimization-root'

  return (
    <div className={rootClassName}>
      <div className="card-optimization-top-bar">
        <div className="card-optimization-objective-block">
          <DirIcon size={14} className="card-optimization-dir-icon" />
          <span className="card-optimization-objective-name">{objective.name}</span>
          <span className="card-optimization-objective-dir">{objective.direction}</span>
        </div>
        <Badge variant="neutral" className="card-optimization-meta-badge">{strategy}</Badge>
        <Badge
          variant={statusVariant}
          leading={<StatusIcon size={11} className={statusSpin ? 'spin' : undefined} />}
          className="card-optimization-meta-badge"
        >
          {status}
        </Badge>
        <span className="card-optimization-spacer" />
        {currentBest ? (
          <div className="card-optimization-best-block">
            <span className="card-optimization-best-label">Current best</span>
            <span className="card-optimization-best-value">{currentBest.objective.toFixed(3)}{objUnit}</span>
            <span className="card-optimization-best-iter">iter {currentBest.iter}</span>
          </div>
        ) : (
          <span className="card-optimization-best-label">No completed trials</span>
        )}
      </div>

      <div className="card-optimization-main-split">
        <div className="card-optimization-chart-wrap">
          <ReactECharts option={chartOption} onEvents={onChartEvent} notMerge className="card-optimization-echarts" opts={{ renderer: 'canvas' }} />
        </div>

        <div className="card-optimization-candidates-panel">
          <div className="card-optimization-legend">
            {parameters.map((p) => (
              <div key={p.name} className="card-optimization-legend-item" title={`${p.low} – ${p.high}${p.unit ?? ''}`}>
                <span className="card-optimization-legend-name">{p.name}</span>
                <span className="card-optimization-legend-range">
                  {p.low}–{p.high}
                  {p.unit && <span className="card-optimization-legend-unit"> {p.unit}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="card-optimization-candidates-header">
            <span>#</span><span>parameters</span>
            <span className="card-optimization-text-right">expected</span><span />
          </div>
          <div className="card-optimization-candidates-body">
            {nextCandidates.length === 0 ? (
              <EmptyState compact title="No candidates queued" />
            ) : nextCandidates.map((cand, i) => {
              const preview = formatParamPreview(cand.params, parameters)
              return (
                <div key={i} className="card-optimization-candidate-row">
                  <span className="card-optimization-cand-idx">{i + 1}</span>
                  <span className="card-optimization-cand-preview" title={preview}>{preview}</span>
                  <span className="card-optimization-cand-expected">
                    {cand.expectedObjective.toFixed(3)}
                    <span className="card-optimization-cand-uncertainty"> ±{cand.uncertainty.toFixed(3)}</span>
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    leading={<Plus size={11} />}
                    onClick={() => handleQueueCandidate(cand, i)}
                    title="Queue trial"
                    className="card-optimization-queue-btn"
                  >
                    Queue
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="card-optimization-trials-wrap">
        <div className="card-optimization-trials-header">Trials ({sortedTrials.length})</div>
        <div className="card-optimization-trials-scroll">
          <table className="card-optimization-table">
            <thead>
              <tr className="card-optimization-thead-row">
                <SortTh col="iter" label="iter" sortColumn={sortColumn} dir={sortDir} onClick={onHeaderClick} />
                {parameters.map((p) => (
                  <SortTh key={p.name} col={p.name} label={p.name} sortColumn={sortColumn} dir={sortDir} onClick={onHeaderClick} />
                ))}
                <SortTh col="objective" label={objLabel} sortColumn={sortColumn} dir={sortDir} onClick={onHeaderClick} />
                <SortTh col="status" label="status" sortColumn={sortColumn} dir={sortDir} onClick={onHeaderClick} />
                <SortTh col="time" label="time" sortColumn={sortColumn} dir={sortDir} onClick={onHeaderClick} />
              </tr>
            </thead>
            <tbody>
              {sortedTrials.map((t) => {
                const isSel = selectedTrialId === t.id
                return (
                  <tr
                    key={t.id}
                    className={`card-optimization-body-row${isSel ? ' is-selected' : ''}`}
                    onClick={() => setSelectedTrialId(isSel ? null : t.id)}
                  >
                    <td className="card-optimization-td">{t.iter}</td>
                    {parameters.map((p) => (
                      <td key={p.name} className="card-optimization-td">{formatParamValue(t.params[p.name])}</td>
                    ))}
                    <td className="card-optimization-td">{t.status === 'completed' && Number.isFinite(t.objective) ? t.objective.toFixed(3) : '—'}</td>
                    <td className="card-optimization-td"><TrialGlyph status={t.status} /></td>
                    <td className="card-optimization-td card-optimization-td--time">{formatRelativeTime(t.timestamp, now)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SortTh({
  col, label, sortColumn, dir, onClick,
}: { col: SortColumn; label: string; sortColumn: SortColumn; dir: SortDir; onClick: (c: SortColumn) => void }) {
  const active = sortColumn === col
  const arrowClass = [
    'card-optimization-sort-arrow',
    active ? 'is-active' : '',
    active && dir === 'desc' ? 'is-desc' : '',
  ].filter(Boolean).join(' ')
  return (
    <th className="card-optimization-th" onClick={() => onClick(col)}>
      <span className="card-optimization-th-inner"><span>{label}</span><ArrowUpDown size={10} className={arrowClass} /></span>
    </th>
  )
}

function TrialGlyph({ status }: { status: OptTrial['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={12} className="card-optimization-glyph card-optimization-glyph--done" />
  if (status === 'failed') return <XCircle size={12} className="card-optimization-glyph card-optimization-glyph--failed" />
  return <Circle size={12} className="card-optimization-glyph card-optimization-glyph--pending spin" />
}

function statusVisual(status: OptimizationPayload['status']): { Icon: typeof Loader2; spin: boolean; variant: BadgeVariant } {
  if (status === 'running') return { Icon: Loader2, spin: true, variant: 'info' }
  if (status === 'converged') return { Icon: CheckCircle2, spin: false, variant: 'success' }
  return { Icon: Pause, spin: false, variant: 'neutral' }
}

function computeRunningBest(trials: OptTrial[], direction: OptObjective['direction']): number[] {
  const ordered = [...trials].sort((a, b) => a.iter - b.iter)
  const out: number[] = []
  let best: number | null = null
  for (const t of ordered) {
    if (t.status === 'completed' && Number.isFinite(t.objective)) {
      if (best == null) best = t.objective
      else if (direction === 'maximize') best = Math.max(best, t.objective)
      else best = Math.min(best, t.objective)
    }
    out.push(best ?? Number.NaN)
  }
  return out
}

function buildChartOption(
  trials: OptTrial[], bestRunning: number[], objective: OptObjective, selectedTrialId: string | null,
) {
  const ordered = [...trials].sort((a, b) => a.iter - b.iter)
  const trialById = new Map(ordered.map((t) => [t.id, t]))
  // Failed/pending trials have no valid objective; pin them to the running best
  // line so the marker stays visible without distorting the y-axis scale.
  const scatterData = ordered.map((t, i) => {
    const isSel = t.id === selectedTrialId
    const color = t.status === 'failed' ? FAILED : t.status === 'pending' ? PENDING : DONE
    const y = t.status === 'completed' && Number.isFinite(t.objective) ? t.objective : (Number.isFinite(bestRunning[i]) ? bestRunning[i] : 0)
    return {
      value: [t.iter, y, t.id],
      itemStyle: { color, borderColor: isSel ? SELECTED : undefined, borderWidth: isSel ? 2 : 0 },
      symbolSize: isSel ? 12 : 8,
    }
  })
  const bestLineData = ordered.map((t, i) => [t.iter, bestRunning[i]])
  const unit = objective.unit ? ` (${objective.unit})` : ''
  const AX = {
    axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
    axisLine: { lineStyle: { color: '#2A2A2A' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xs },
  }
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 28, right: 24, bottom: 44, left: 58 },
    legend: {
      data: ['running best', 'trials'], right: 20, top: 4, itemWidth: 14, itemHeight: 8,
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xxs }, inactiveColor: '#4a4a5a',
    },
    xAxis: { type: 'value' as const, name: 'iter', nameLocation: 'middle' as const, nameGap: 26, minInterval: 1, ...AX },
    yAxis: { type: 'value' as const, name: `${objective.name}${unit}`, nameLocation: 'middle' as const, nameGap: 44, scale: true, ...AX },
    dataZoom: [{ type: 'inside' as const, xAxisIndex: 0 }],
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: 'rgba(20,20,20,0.96)', borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      formatter: (p: { seriesType: string; data: unknown }) => {
        if (p.seriesType === 'line') {
          const v = p.data as [number, number]
          return `running best @ iter ${v[0]}<br/><strong>${Number.isFinite(v[1]) ? v[1].toFixed(3) : '—'}</strong>${unit}`
        }
        const trial = trialById.get((p.data as { value: [number, number, string] }).value[2])
        if (!trial) return ''
        const lines = Object.entries(trial.params).map(([k, val]) => `${k} = ${formatParamValue(val)}`).join('<br/>')
        const obj = trial.status === 'failed' ? '<em>failed</em>' : trial.status === 'pending' ? '<em>pending</em>' : `${trial.objective.toFixed(3)}${unit}`
        return `<strong>iter ${trial.iter}</strong><br/>${lines}<br/>${objective.name}: ${obj}`
      },
    },
    series: [
      {
        name: 'running best', type: 'line' as const, data: bestLineData, showSymbol: false,
        lineStyle: { color: BEST_LINE, width: 2 }, itemStyle: { color: BEST_LINE }, z: 3, connectNulls: true,
      },
      { name: 'trials', type: 'scatter' as const, data: scatterData, z: 2, emphasis: { scale: 1.2 } },
    ],
  }
}

function sortTrials(trials: OptTrial[], col: SortColumn, dir: SortDir): OptTrial[] {
  const mul = dir === 'asc' ? 1 : -1
  const get = (t: OptTrial): number | string => {
    if (col === 'iter') return t.iter
    if (col === 'objective') return Number.isFinite(t.objective) ? t.objective : -Infinity
    if (col === 'status') return t.status
    if (col === 'time') return t.timestamp
    return t.params[col] ?? -Infinity
  }
  return [...trials].sort((a, b) => {
    const va = get(a), vb = get(b)
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
    return String(va).localeCompare(String(vb)) * mul
  })
}

function formatParamValue(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 100) return v.toFixed(0)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

function formatParamPreview(params: Record<string, number>, defs: OptParameter[]): string {
  const parts: string[] = []
  for (const def of defs) {
    const v = params[def.name]
    if (v == null) continue
    parts.push(`${def.name.split('_')[0]}=${formatParamValue(v)}${def.unit ?? ''}`)
  }
  return parts.join(', ')
}

function formatRelativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
