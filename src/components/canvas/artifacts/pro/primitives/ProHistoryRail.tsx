// Left-rail run history for Pro Workbenches. Slots into
// `ProWorkbenchShell.historyRail` (previously a permanent "later phase"
// placeholder) and renders whatever records the active sub-state has on
// `runHistory`. Each row shows command + time + short summary + a restore
// control; clicking restore replays only the params (not the execution —
// users click Run themselves if they want).
//
// Visual language: grayscale, hairline borders, ALL CAPS section header.
// Shrinks cleanly into the shell's collapsed rail (28px) by hiding all
// text when the rail is narrow, leaving just dot markers.

import { type CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import { TYPO } from '@/lib/typography-inline'
import type { ProRunRecord } from '@/types/artifact'

export interface ProHistoryRailProps {
  history: ProRunRecord[]
  onRestore?: (record: ProRunRecord) => void
  /** Displayed above the list; default 'RUNS'. */
  heading?: string
}

export default function ProHistoryRail({
  history,
  onRestore,
  heading = 'RUNS',
}: ProHistoryRailProps) {
  if (history.length === 0) {
    return (
      <div style={styles.wrap}>
        <div style={styles.heading}>{heading}</div>
        <div style={styles.empty}>No runs yet.</div>
      </div>
    )
  }
  // Newest first.
  const reversed = history.slice().reverse()
  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>
        {heading} · {history.length}
      </div>
      <div style={styles.list}>
        {reversed.map((r) => (
          <div
            key={r.id}
            style={{ ...styles.row, ...(r.failed ? styles.rowFailed : null) }}
          >
            <span style={styles.dot} aria-hidden>
              {r.failed ? '!' : '·'}
            </span>
            <div style={styles.body}>
              <div style={styles.cmdRow}>
                <span style={styles.cmd}>{r.command}</span>
                <span style={styles.time}>{formatRelative(r.createdAt)}</span>
              </div>
              {r.paramsSummary ? (
                <div style={styles.summary} title={r.paramsSummary}>
                  {r.paramsSummary}
                </div>
              ) : null}
              {r.resultSummary ? (
                <div style={styles.result} title={r.resultSummary}>
                  {r.resultSummary}
                  {r.durationMs != null ? (
                    <span style={styles.dur}> · {formatDuration(r.durationMs)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {onRestore && !isTruncated(r.paramsSnapshot) ? (
              <button
                type="button"
                onClick={() => onRestore(r)}
                style={styles.restoreBtn}
                title="Restore these params to the inspector"
                aria-label="Restore params"
              >
                <RotateCcw size={11} aria-hidden />
              </button>
            ) : onRestore ? (
              <button
                type="button"
                disabled
                style={{ ...styles.restoreBtn, opacity: 0.25 }}
                title="Params snapshot too large to restore"
                aria-label="Restore unavailable"
              >
                <RotateCcw size={11} aria-hidden />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function isTruncated(snapshot: unknown): boolean {
  return (
    typeof snapshot === 'object' &&
    snapshot !== null &&
    (snapshot as { truncated?: boolean }).truncated === true
  )
}

function formatRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

// ─── Inline styles (grayscale, hairline; fits shell's 220px expanded rail) ──

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 8px 12px',
    minHeight: 0,
    height: '100%',
    overflow: 'hidden',
  },
  heading: {
    fontSize: TYPO.xxs,
    fontWeight: 600,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    paddingLeft: 2,
  },
  empty: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    padding: '6px 4px',
    lineHeight: 1.5,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflowY: 'auto',
    paddingRight: 4,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '10px 1fr auto',
    gap: 6,
    alignItems: 'flex-start',
    padding: '4px 6px',
    borderLeft: '1px solid var(--color-border)',
  },
  rowFailed: {
    borderLeftColor: 'var(--color-danger)',
  },
  dot: {
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    lineHeight: 1.4,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  cmdRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 6,
  },
  cmd: {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPO.xxs,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    flexShrink: 0,
  },
  summary: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  result: {
    fontSize: TYPO.xxs,
    color: 'var(--color-text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dur: {
    opacity: 0.7,
  },
  restoreBtn: {
    width: 20,
    height: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 0,
    borderRadius: 3,
  },
}
