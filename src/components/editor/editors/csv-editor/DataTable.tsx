import type { CSSProperties } from 'react'

interface DataTableProps {
  headers: string[]
  rows: string[][]
  /**
   * Number of non-empty lines in the original text (not just the parsed
   * slice). Lets the footer banner report the real file size when the
   * parser capped at `PARSE_MAX_ROWS`.
   */
  totalLines: number
  /**
   * True when the parser stopped early — signals the banner to use
   * "Parsed first N of M" wording even when M ≤ MAX_ROWS would normally
   * hide the banner entirely.
   */
  truncated: boolean
}

const MAX_ROWS = 2000

export default function DataTable({
  headers,
  rows,
  totalLines,
  truncated,
}: DataTableProps) {
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          width: '100%',
        }}
      >
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            {headers.map((h, i) => (
              <th key={i} style={thStyle} title={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_ROWS).map((row, ri) => (
            <tr key={ri}>
              <td style={tdMutedStyle}>{ri + 1}</td>
              {headers.map((_, ci) => (
                <td key={ci} style={tdStyle}>
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(rows.length > MAX_ROWS || truncated) && (
        <div
          style={{
            padding: '8px 14px',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            textAlign: 'center',
          }}
        >
          {truncated
            ? `Showing first ${MAX_ROWS} rows (file has ${totalLines.toLocaleString()}+ rows — parse capped for responsiveness)`
            : `Showing first ${MAX_ROWS} of ${rows.length} rows`}
        </div>
      )}
    </div>
  )
}

const thStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  background: 'var(--panel-bg, #1e1e1e)',
  borderBottom: '2px solid var(--color-border)',
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-primary)',
  whiteSpace: 'nowrap',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const tdStyle: CSSProperties = {
  padding: '4px 10px',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const tdMutedStyle: CSSProperties = {
  ...tdStyle,
  color: 'var(--color-text-muted)',
  fontSize: 'var(--text-xxs)',
  textAlign: 'right',
  paddingRight: 6,
  userSelect: 'none',
}
