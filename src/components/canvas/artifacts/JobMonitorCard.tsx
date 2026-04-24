import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import {
  Ban,
  CheckCircle2,
  Cpu,
  FileText,
  HardDrive,
  Loader2,
  Network,
  XCircle,
} from 'lucide-react'
import type { Artifact } from '../../../types/artifact'
import { CHART_QUATERNARY, CHART_SERIES_PALETTE } from '../../../lib/chart-colors'
import { CHART_TEXT_PX } from '../../../lib/chart-text-px'
import { Badge, Button, EmptyState, type BadgeVariant } from '../../ui'

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
type JobBackend = 'cp2k' | 'vasp' | 'lammps' | 'ase' | 'qe' | 'abinit'

interface JobConvergencePoint {
  iter: number
  metric: string
  value: number
}

interface JobLogLine {
  ts: number
  level: 'info' | 'warn' | 'error' | 'debug'
  text: string
}

interface JobMonitorPayload {
  jobId: string
  jobName: string
  backend: JobBackend
  command: string
  status: JobStatus
  progress: number
  startedAt: number
  endedAt: number | null
  convergence: JobConvergencePoint[]
  log: JobLogLine[]
  resultArtifactIds: string[]
  resources?: { cpuHours?: number; memGb?: number; nodes?: number }
}

interface Props {
  artifact: Artifact
}

const METRIC_PALETTE = Array.from(CHART_SERIES_PALETTE).slice(0, 5)

const LEVEL_COLORS: Record<JobLogLine['level'], string> = {
  info: 'var(--color-text-secondary)',
  warn: 'var(--color-yellow)',
  error: 'var(--color-red)',
  debug: 'var(--color-text-muted)',
}

const BACKEND_LABELS: Record<JobBackend, string> = {
  cp2k: 'CP2K',
  vasp: 'VASP',
  lammps: 'LAMMPS',
  ase: 'ASE',
  qe: 'Quantum ESPRESSO',
  abinit: 'ABINIT',
}

export default function JobMonitorCard({ artifact }: Props) {
  const payload = artifact.payload as unknown as JobMonitorPayload
  const statusColor = statusColorFor(payload.status)
  const isTerminal = payload.status !== 'running' && payload.status !== 'queued'
  const [autoScroll, setAutoScroll] = useState(payload.status === 'running')
  const [now, setNow] = useState(() => Date.now())
  const logScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (payload.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [payload.status])

  useEffect(() => {
    if (!autoScroll) return
    const el = logScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [autoScroll, payload.log.length])

  const { metrics, dominantMetric, chartOption } = useMemo(
    () => buildChartOption(payload.convergence),
    [payload.convergence],
  )

  const elapsedMs =
    (payload.endedAt ?? (payload.status === 'running' ? now : payload.startedAt)) -
    payload.startedAt
  const progressPct = Math.max(0, Math.min(1, payload.progress)) * 100

  const showCancel = payload.status === 'running'
  const showViewOutput =
    payload.status === 'succeeded' && payload.resultArtifactIds.length > 0

  return (
    <div className="card-job-root">
      <div className="card-job-top-bar">
        <StatusChip status={payload.status} />
        <div className="card-job-title-col">
          <div className="card-job-title">{payload.jobName}</div>
          <div className="card-job-id" title={payload.command}>{payload.jobId}</div>
        </div>
        <Badge variant="neutral">{BACKEND_LABELS[payload.backend]}</Badge>
        {showCancel && (
          <Button
            variant="danger"
            size="sm"
            leading={<Ban size={12} />}
            onClick={() => {}}
            title="Cancel (wire-up pending)"
          >
            Cancel
          </Button>
        )}
        {showViewOutput && (
          <Button
            variant="secondary"
            size="sm"
            leading={<FileText size={12} />}
            onClick={() => {}}
            title={`View ${payload.resultArtifactIds.length} output artifact(s)`}
          >
            View Output
          </Button>
        )}
      </div>

      <div className="card-job-progress-track">
        <div
          className="card-job-progress-fill"
          style={{ '--prog-w': `${progressPct}%`, '--prog-bg': statusColor } as React.CSSProperties}
        />
      </div>

      <div className="card-job-elapsed-row">
        <span>elapsed {formatDuration(elapsedMs)}</span>
        <span>{progressPct.toFixed(0)}%</span>
      </div>

      <div className="card-job-middle">
        <div className="card-job-chart-column">
          {metrics.length === 0 ? (
            <EmptyState compact title="No convergence data yet" />
          ) : (
            <ReactECharts
              option={chartOption}
              notMerge
              className="card-job-echarts"
              opts={{ renderer: 'canvas' }}
            />
          )}
          {dominantMetric && (
            <div className="card-job-dominant-foot">dominant metric: {dominantMetric}</div>
          )}
        </div>

        <div className="card-job-log-panel">
          <div className="card-job-log-header">
            <span>Log ({payload.log.length})</span>
            {!isTerminal && (
              <label className="card-job-auto-scroll-label">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={() => setAutoScroll((v) => !v)}
                  className="card-job-auto-scroll-input"
                />
                auto-scroll
              </label>
            )}
          </div>
          <div ref={logScrollRef} className="card-job-log-body">
            {payload.log.length === 0 ? (
              <EmptyState compact title="No log output" />
            ) : (
              payload.log.map((line, i) => (
                <div key={i} className="card-job-log-row">
                  <span className="card-job-log-time">{formatClock(line.ts)}</span>
                  <span
                    className="card-job-log-level"
                    style={{ '--log-level-color': LEVEL_COLORS[line.level] } as React.CSSProperties}
                  >
                    {line.level}
                  </span>
                  <span className="card-job-log-text" title={line.text}>{line.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {payload.resources && <ResourcesRow resources={payload.resources} />}
    </div>
  )
}

function StatusChip({ status }: { status: JobStatus }) {
  const iconMap = {
    queued: Loader2,
    running: Loader2,
    succeeded: CheckCircle2,
    failed: XCircle,
    cancelled: Ban,
  } as const
  const variantMap: Record<JobStatus, BadgeVariant> = {
    queued: 'neutral',
    running: 'info',
    succeeded: 'success',
    failed: 'danger',
    cancelled: 'neutral',
  }
  const Icon = iconMap[status]
  return (
    <Badge
      variant={variantMap[status]}
      leading={<Icon size={12} className={status === 'running' ? 'spin' : undefined} />}
      className="card-job-status-badge"
    >
      {status}
    </Badge>
  )
}

function ResourcesRow({
  resources,
}: {
  resources: NonNullable<JobMonitorPayload['resources']>
}) {
  const items: Array<[React.ReactNode, string, string]> = []
  if (resources.cpuHours != null)
    items.push([<Cpu size={13} />, 'CPU-h', resources.cpuHours.toFixed(1)])
  if (resources.memGb != null)
    items.push([<HardDrive size={13} />, 'Mem', `${resources.memGb} GB`])
  if (resources.nodes != null)
    items.push([<Network size={13} />, 'Nodes', String(resources.nodes)])
  return (
    <div className="card-job-resources-row">
      {items.map(([icon, label, value], i) => (
        <div key={i} className="card-job-resource-item">
          <span className="card-job-resource-icon">{icon}</span>
          <span className="card-job-resource-label">{label}</span>
          <span className="card-job-resource-value">{value}</span>
        </div>
      ))}
    </div>
  )
}

function buildChartOption(convergence: JobConvergencePoint[]) {
  const metrics = Array.from(new Set(convergence.map((p) => p.metric)))
  if (metrics.length === 0) return { metrics, dominantMetric: null, chartOption: {} }

  const counts = new Map<string, number>()
  for (const p of convergence) counts.set(p.metric, (counts.get(p.metric) ?? 0) + 1)
  const dominantMetric = metrics
    .slice()
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0]

  const series = metrics.map((metric, i) => {
    const color = METRIC_PALETTE[i % METRIC_PALETTE.length]
    const data = convergence
      .filter((p) => p.metric === metric)
      .sort((a, b) => a.iter - b.iter)
      .map((p) => [p.iter, p.value])
    return {
      name: metric, type: 'line' as const, data, showSymbol: false,
      lineStyle: { color, width: 1.5 }, itemStyle: { color },
    }
  })

  const values = convergence.map((p) => p.value)
  const allPositive = values.every((v) => v > 0)
  const spread = allPositive ? Math.log10(Math.max(...values) / Math.min(...values)) : 0
  const useLog = allPositive && spread > 3

  const axisBase = {
    nameTextStyle: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
    axisLabel: { color: '#888888', fontSize: CHART_TEXT_PX.xxs },
    axisLine: { lineStyle: { color: '#2A2A2A' } },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
  }

  const chartOption = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: 32, right: 20, bottom: 34, left: 56 },
    legend: metrics.length > 1
      ? { data: metrics, right: 20, top: 4, textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xxs }, inactiveColor: '#4a4a5a', itemWidth: 12, itemHeight: 6 }
      : undefined,
    title: { text: dominantMetric, left: 14, top: 4, textStyle: { color: '#999999', fontSize: CHART_TEXT_PX.xs, fontWeight: 500 } },
    xAxis: { type: 'value' as const, name: 'iter', nameLocation: 'middle' as const, nameGap: 22, ...axisBase },
    yAxis: { type: useLog ? ('log' as const) : ('value' as const), scale: true, ...axisBase },
    dataZoom: [{ type: 'inside' as const, xAxisIndex: 0 }],
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: 'rgba(20,20,20,0.96)',
      borderColor: '#2A2A2A',
      extraCssText: 'z-index: 10 !important; pointer-events: none;',
      textStyle: { color: '#cccccc', fontSize: CHART_TEXT_PX.xs },
      axisPointer: { lineStyle: { color: CHART_QUATERNARY, width: 1 } },
    },
    series,
  }

  return { metrics, dominantMetric, chartOption }
}

function statusColorFor(status: JobStatus): string {
  switch (status) {
    case 'running':
      return 'var(--color-accent)'
    case 'succeeded':
      return 'var(--color-green)'
    case 'failed':
      return 'var(--color-red)'
    case 'queued':
    case 'cancelled':
    default:
      return 'var(--color-text-muted)'
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function formatClock(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
