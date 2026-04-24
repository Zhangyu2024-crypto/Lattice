// LogRow — collapsed one-liner with source badge + optional expanded
// detail view. Used inside LogConsole.

import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
} from 'lucide-react'
import type { LogEntry } from '../../stores/log-store'
import { toast } from '../../stores/toast-store'

const LEVEL_ICON = {
  error: AlertCircle,
  warn: AlertTriangle,
  success: CheckCircle2,
  info: Info,
} as const

function formatTime(ts: number): string {
  const d = new Date(ts)
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0') +
    ':' +
    String(d.getSeconds()).padStart(2, '0')
  )
}

interface Props {
  entry: LogEntry
}

export default function LogRow({ entry }: Props) {
  const [expanded, setExpanded] = useState(false)
  const Icon = LEVEL_ICON[entry.level] ?? Info
  const hasDetail = entry.detail && Object.keys(entry.detail).length > 0

  const copyEntry = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2))
      toast.success('Copied log entry', { skipLog: true })
    } catch {
      toast.error('Copy failed', { skipLog: true })
    }
  }

  return (
    <div className={`log-row log-row--${entry.level}`}>
      <button
        type="button"
        className="log-row-head"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        disabled={!hasDetail}
      >
        <span className="log-row-chev" aria-hidden>
          {hasDetail ? (
            expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className="log-row-chev-spacer" />
          )}
        </span>
        <span className="log-row-time">{formatTime(entry.timestamp)}</span>
        <Icon size={12} className="log-row-icon" aria-hidden />
        <span className={`log-row-source log-row-source--${entry.source}`}>
          {entry.source}
        </span>
        <span className="log-row-type">{entry.type}</span>
        <span className="log-row-msg">{entry.message}</span>
      </button>
      {expanded && hasDetail && (
        <div className="log-row-detail">
          <pre className="log-row-detail-pre">
            {JSON.stringify(entry.detail, null, 2)}
          </pre>
          <div className="log-row-detail-actions">
            <button
              type="button"
              className="log-row-detail-btn"
              onClick={copyEntry}
            >
              <Copy size={11} />
              Copy entry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
