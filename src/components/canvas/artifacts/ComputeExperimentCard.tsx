// Renderer for `compute-experiment` artifacts (parameter sweeps).
//
// Layout mirrors `ComputeArtifactCard` at a high level — a header with
// the experiment objective + status badge + run controls, a per-point
// table, and a collapsible output panel. The script editor is left
// out: the per-point `pointScriptTemplate` is currently authored via
// `compute_experiment_create` (agent) or future template-picker UI;
// editing it inline would silently invalidate every point's metrics.

import { useMemo, useState } from 'react'
import type {
  ComputeExperimentArtifact,
  ComputeExperimentPoint,
  ComputeExperimentPointStatus,
  ComputeExperimentStatus,
} from '../../../types/artifact'
import { Badge, Button, type BadgeVariant } from '../../ui'

interface Props {
  artifact: ComputeExperimentArtifact
  onRun: () => void | Promise<void>
  onStop: () => void | Promise<void>
  onRerunFailed: () => void | Promise<void>
}

const STATUS_VARIANTS: Record<ComputeExperimentStatus, BadgeVariant> = {
  draft: 'neutral',
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
}

const POINT_VARIANTS: Record<ComputeExperimentPointStatus, BadgeVariant> = {
  pending: 'neutral',
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  skipped: 'neutral',
}

function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function formatParamValue(v: string | number | boolean): string {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return v
}

function tail(s: string, n: number): string {
  if (!s) return ''
  return s.length <= n ? s : '…' + s.slice(-n)
}

export default function ComputeExperimentCard({
  artifact,
  onRun,
  onStop,
  onRerunFailed,
}: Props) {
  const payload = artifact.payload
  const [outputOpen, setOutputOpen] = useState(false)
  const isRunning = payload.status === 'running'

  const counts = useMemo(() => {
    const out = { pending: 0, succeeded: 0, failed: 0, running: 0, other: 0 }
    for (const p of payload.points ?? []) {
      if (p.status === 'pending' || p.status === 'queued') out.pending += 1
      else if (p.status === 'succeeded') out.succeeded += 1
      else if (p.status === 'failed') out.failed += 1
      else if (p.status === 'running') out.running += 1
      else out.other += 1
    }
    return out
  }, [payload.points])

  const progressPct =
    payload.progress && payload.progress.total > 0
      ? Math.round((payload.progress.current / payload.progress.total) * 100)
      : null

  const paramColumns = payload.parameters?.filter((p) => p.role !== 'derived') ?? []
  const metricColumns = payload.metrics ?? []

  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 6,
        background: 'var(--color-surface, #fafafa)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Badge variant={STATUS_VARIANTS[payload.status] ?? 'neutral'}>
          {payload.status}
        </Badge>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {payload.objective || 'Compute experiment'}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {isRunning ? (
            <Button variant="secondary" onClick={() => void onStop()}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void onRun()}
              disabled={counts.pending === 0}
              title={counts.pending === 0 ? 'No pending points' : undefined}
            >
              Run pending ({counts.pending})
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void onRerunFailed()}
            disabled={isRunning || counts.failed === 0}
            title={counts.failed === 0 ? 'No failed points' : undefined}
          >
            Rerun failed ({counts.failed})
          </Button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, opacity: 0.8 }}>
        <span>engine: {payload.engine}</span>
        <span>points: {payload.points?.length ?? 0}</span>
        <span style={{ color: 'var(--color-success, #2a7a2a)' }}>
          succeeded: {counts.succeeded}
        </span>
        <span style={{ color: 'var(--color-danger, #b03a2e)' }}>
          failed: {counts.failed}
        </span>
        <span>pending: {counts.pending}</span>
      </div>

      {progressPct != null && (
        <div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
            {payload.progress!.current} / {payload.progress!.total} ({progressPct}%)
          </div>
          <div
            style={{
              height: 4,
              background: 'var(--color-border, #ddd)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: '100%',
                background: 'var(--color-fg, #333)',
                transition: 'width 200ms ease',
              }}
            />
          </div>
        </div>
      )}

      <PointsTable
        points={payload.points ?? []}
        paramNames={paramColumns.map((p) => p.name)}
        metricNames={metricColumns.map((m) => m.name)}
      />

      {(payload.stdout || payload.stderr) && (
        <details
          open={outputOpen}
          onToggle={(e) => setOutputOpen((e.target as HTMLDetailsElement).open)}
          style={{ fontSize: 12 }}
        >
          <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
            Output
          </summary>
          {payload.stdout && (
            <pre
              style={{
                marginTop: 8,
                padding: 8,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 4,
                maxHeight: 240,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
              }}
            >
              {tail(payload.stdout, 8_000)}
            </pre>
          )}
          {payload.stderr && (
            <pre
              style={{
                marginTop: 8,
                padding: 8,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-danger, #b03a2e)',
                borderRadius: 4,
                maxHeight: 200,
                overflow: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--color-danger, #b03a2e)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {tail(payload.stderr, 4_000)}
            </pre>
          )}
        </details>
      )}
    </div>
  )
}

interface PointsTableProps {
  points: ComputeExperimentPoint[]
  paramNames: string[]
  metricNames: string[]
}

function PointsTable({ points, paramNames, metricNames }: PointsTableProps) {
  if (points.length === 0) {
    return (
      <div style={{ fontSize: 12, opacity: 0.7, fontStyle: 'italic' }}>
        No points yet.
      </div>
    )
  }
  return (
    <div
      style={{
        overflowX: 'auto',
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 4,
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr style={{ background: 'var(--color-bg, #fff)' }}>
            <th style={cellHead}>#</th>
            <th style={cellHead}>id</th>
            <th style={cellHead}>status</th>
            {paramNames.map((n) => (
              <th key={`p-${n}`} style={cellHead}>
                {n}
              </th>
            ))}
            {metricNames.map((n) => (
              <th key={`m-${n}`} style={cellHead}>
                {n}
              </th>
            ))}
            <th style={cellHead}>duration</th>
            <th style={cellHead}>note</th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt) => (
            <tr key={pt.id}>
              <td style={cell}>{pt.index}</td>
              <td style={cell}>{pt.id}</td>
              <td style={cell}>
                <Badge variant={POINT_VARIANTS[pt.status] ?? 'neutral'} size="sm">
                  {pt.status}
                </Badge>
              </td>
              {paramNames.map((n) => (
                <td key={`p-${pt.id}-${n}`} style={cell}>
                  {pt.params[n] !== undefined ? formatParamValue(pt.params[n]) : ''}
                </td>
              ))}
              {metricNames.map((n) => {
                const v = pt.metrics?.[n]
                return (
                  <td key={`m-${pt.id}-${n}`} style={cell}>
                    {v == null ? '' : String(v)}
                  </td>
                )
              })}
              <td style={cell}>{formatDuration(pt.durationMs)}</td>
              <td style={{ ...cell, color: 'var(--color-danger, #b03a2e)' }}>
                {pt.error ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const cellHead: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid var(--color-border, #ddd)',
  fontWeight: 600,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
}

const cell: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--color-border, #eee)',
  whiteSpace: 'nowrap',
}
