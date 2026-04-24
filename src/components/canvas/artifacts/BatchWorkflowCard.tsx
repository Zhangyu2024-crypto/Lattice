import { memo, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Download,
  Filter,
  FolderOpen,
  Loader2,
  Play,
  Search,
  Square,
  XCircle,
} from 'lucide-react'
import type {
  Artifact,
  BatchFile,
  BatchFileStatus,
  BatchWorkflowPayload,
} from '../../../types/artifact'
import { toast } from '../../../stores/toast-store'
import { downloadTextFile } from '../../../lib/pro-export'
import { Badge, Button, EmptyState, type BadgeVariant } from '../../ui'

interface Props {
  artifact: Artifact
  /** Context when row-click needs to resolve linked artifacts (provided by host). */
  sessionId?: string
  /** "Start" / "Resume" button — host decides whether to kick off runBatch. */
  onStart?: (args: { onlyPending: boolean }) => void
  /** "Cancel" button — host decides whether to call cancelBatch. */
  onCancel?: () => void
  /** File-row click on a succeeded file — host resolves & focuses the linked artifact. */
  onOpenLinkedFile?: (file: BatchFile) => void
  className?: string
}

type FilterMode = 'all' | 'running' | 'failed'

function BatchWorkflowCardImpl({
  artifact,
  onStart,
  onCancel,
  onOpenLinkedFile,
  className,
}: Props) {
  const payload = artifact.payload as unknown as BatchWorkflowPayload
  const [filter, setFilter] = useState<FilterMode>('all')
  const [query, setQuery] = useState<string>('')

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payload.files.filter((f) => {
      if (filter === 'running' && f.status !== 'running') return false
      if (filter === 'failed' && f.status !== 'failed') return false
      if (q && !f.relPath.toLowerCase().includes(q)) return false
      return true
    })
  }, [payload.files, filter, query])

  const totals = useMemo(() => {
    const total = payload.summary?.total ?? payload.files.length
    const ok = payload.summary?.ok ?? payload.files.filter((f) => f.status === 'succeeded').length
    const failed = payload.summary?.failed ?? payload.files.filter((f) => f.status === 'failed').length
    const durationMs = payload.files.reduce((acc, f) => acc + (f.durationMs ?? 0), 0)
    return { total, ok, failed, durationMs, pct: total > 0 ? Math.min(1, ok / total) : 0 }
  }, [payload.files, payload.summary])

  const statusBadgeVariant = batchStatusVariant(payload.status)
  const jsonlUrl = payload.summary?.jsonlUrl

  const handleDownload = async () => {
    // Prefer the backend-provided JSONL if it's reachable from the renderer
    // (CSP restricts us to localhost, so only local URLs will succeed).
    // Otherwise synthesize a JSONL manifest from the files we already have —
    // that's strictly more useful than a toast.
    let text: string | null = null
    if (jsonlUrl && /^https?:\/\//i.test(jsonlUrl)) {
      try {
        const res = await fetch(jsonlUrl)
        if (res.ok) {
          text = await res.text()
        }
      } catch {
        // Fall through to the synthesized manifest below.
      }
    }
    if (text == null) {
      text = buildSyntheticJsonl(payload)
    }
    downloadTextFile(
      `${jsonlFilename(payload)}.jsonl`,
      text,
      'application/x-ndjson;charset=utf-8',
    )
    toast.success(`Downloaded ${payload.files.length} entries`)
  }
  const handleAction = () => {
    if (payload.status === 'running') {
      onCancel?.()
      return
    }
    // Resume whenever the prior run already produced any successes —
    // regardless of whether the batch-level status is 'idle' (cancelled),
    // 'failed', or 'succeeded'. Only a truly fresh artifact (no files
    // finished yet) is treated as "start from scratch".
    const onlyPending = payload.files.some((f) => f.status === 'succeeded')
    onStart?.({ onlyPending })
  }
  const handleRowClick = (file: BatchFile) => {
    if (file.status !== 'succeeded') return
    onOpenLinkedFile?.(file)
  }

  const actionLabel =
    payload.status === 'running' ? 'Cancel' : payload.status === 'idle' ? 'Start' : 'Resume'
  const ActionIcon = payload.status === 'running' ? Square : Play

  const rootClassName = className ? `card-batch-root ${className}` : 'card-batch-root'

  return (
    <div className={rootClassName}>
      <div className="card-batch-top-strip">
        <FolderOpen size={14} className="card-batch-icon" />
        <span className="card-batch-source-dir" title={payload.sourceDir}>{payload.sourceDir}</span>
        <Badge variant="neutral" className="card-batch-mono-badge">{payload.pattern}</Badge>
        <span className="card-batch-divider" />
        <div className="card-batch-pipeline-wrap">
          {payload.pipeline.map((step, i) => (
            <Badge key={`${step}-${i}`} variant="info">{step}</Badge>
          ))}
        </div>
        <span className="card-batch-divider" />
        <span className="card-batch-concurrency">
          concurrency{' '}
          <strong className="card-batch-concurrency-value">{payload.concurrency}</strong>
        </span>
        <span className="card-batch-spacer" />
        <Badge
          variant={statusBadgeVariant}
          leading={
            payload.status === 'running' ? <Loader2 size={10} className="spin" /> :
            payload.status === 'succeeded' ? <CheckCircle2 size={10} /> :
            payload.status === 'failed' ? <XCircle size={10} /> :
            <Circle size={10} />
          }
          className="card-batch-status-badge"
        >
          {payload.status}
        </Badge>
      </div>

      <div className="card-batch-filter-strip">
        <div className="card-batch-search-wrap">
          <Search size={12} className="card-batch-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by path…"
            className="card-batch-search-input"
          />
        </div>
        <Filter size={12} className="card-batch-icon" />
        <div className="card-batch-filter-btn-group">
          {(['all', 'running', 'failed'] as const).map((m) => (
            <Button
              key={m}
              variant={filter === m ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(m)}
              aria-pressed={filter === m}
              className="card-batch-filter-btn"
            >
              {m}
            </Button>
          ))}
        </div>
        <span className="card-batch-spacer" />
        <span className="card-batch-count-hint">{filteredFiles.length} / {payload.files.length}</span>
      </div>

      <div className="card-batch-list-wrap">
        {filteredFiles.length === 0 ? (
          <EmptyState compact title="No files match the current filter" />
        ) : (
          filteredFiles.map((file, i) => (
            <FileRow
              key={`${file.relPath}-${i}`}
              file={file}
              onClick={() => handleRowClick(file)}
            />
          ))
        )}
      </div>

      <div className="card-batch-summary-bar">
        <div className="card-batch-summary-top">
          <div className="card-batch-summary-stats">
            <span>
              <strong className="card-batch-stat-ok">{totals.ok}</strong>
              <span className="card-batch-stat-muted"> / {totals.total} ok</span>
            </span>
            <span>
              <strong className={`card-batch-stat-fail${totals.failed > 0 ? ' is-error' : ''}`}>
                {totals.failed}
              </strong>
              <span className="card-batch-stat-muted"> failed</span>
            </span>
            <span>
              <strong className="card-batch-stat-total">
                {formatDuration(totals.durationMs)}
              </strong>
              <span className="card-batch-stat-muted"> total</span>
            </span>
          </div>
          <div className="card-batch-summary-actions">
            <Button
              variant="secondary"
              size="sm"
              leading={<Download size={12} />}
              onClick={handleDownload}
              title={
                jsonlUrl
                  ? `Download ${jsonlUrl}`
                  : 'Download manifest (synthesized from file list)'
              }
            >
              JSONL
            </Button>
            <Button
              variant={payload.status === 'running' ? 'danger' : 'primary'}
              size="sm"
              leading={<ActionIcon size={12} />}
              onClick={handleAction}
            >
              {actionLabel}
            </Button>
          </div>
        </div>
        <div className="card-batch-progress-track">
          <div
            className="card-batch-progress-fill"
            style={{ '--progress': `${totals.pct * 100}%` } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  )
}

function FileRow({ file, onClick }: { file: BatchFile; onClick: () => void }) {
  const color = rowColor(file.status)
  const trailing =
    file.status === 'succeeded' && file.durationMs != null
      ? formatDuration(file.durationMs)
      : file.status === 'failed' && file.errorMessage
        ? file.errorMessage
        : null
  return (
    <div
      onClick={onClick}
      className={`card-batch-row${file.status === 'succeeded' ? ' is-clickable' : ''}`}
    >
      <StatusGlyph status={file.status} color={color} />
      <span className="card-batch-rel-path" title={file.relPath}>{file.relPath}</span>
      {trailing && (
        <span
          className={`card-batch-trailing${file.status === 'failed' ? ' is-error' : ''}`}
          title={trailing}
        >
          {trailing}
        </span>
      )}
      {file.artifactIds && file.artifactIds.length > 0 && (
        <span className="card-batch-artifact-link">{file.artifactIds.length} artifacts</span>
      )}
    </div>
  )
}

function StatusGlyph({ status, color }: { status: BatchFileStatus; color: string }) {
  // The color depends on the status token, which maps 1:1 to a CSS var via
  // `rowColor`. Passing the resolved var as `--glyph-color` lets the glyph
  // share one class regardless of which icon we render.
  const style = { '--glyph-color': color } as React.CSSProperties
  if (status === 'running') return <Loader2 size={13} className="spin card-batch-glyph" style={style} />
  if (status === 'succeeded') return <CheckCircle2 size={13} className="card-batch-glyph" style={style} />
  if (status === 'failed') return <XCircle size={13} className="card-batch-glyph" style={style} />
  return <Circle size={13} className="card-batch-glyph" style={style} />
}

function rowColor(status: BatchFileStatus): string {
  if (status === 'running') return 'var(--color-accent)'
  if (status === 'succeeded') return 'var(--color-green)'
  if (status === 'failed') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function batchStatusVariant(status: BatchWorkflowPayload['status']): BadgeVariant {
  if (status === 'running') return 'info'
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const total = ms / 1000
  if (total < 60) return `${total.toFixed(1)}s`
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  return `${m}m ${s}s`
}

function buildSyntheticJsonl(payload: BatchWorkflowPayload): string {
  return payload.files
    .map((f) =>
      JSON.stringify({
        relPath: f.relPath,
        status: f.status,
        durationMs: f.durationMs ?? null,
        errorMessage: f.errorMessage ?? null,
        artifactIds: f.artifactIds ?? [],
      }),
    )
    .join('\n')
}

function jsonlFilename(payload: BatchWorkflowPayload): string {
  const dir = payload.sourceDir.split(/[/\\]/).filter(Boolean).pop() ?? 'batch'
  const safe = dir.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)
  return `${safe || 'batch'}_manifest`
}

export default memo(BatchWorkflowCardImpl)
