// Shape-specific renderers for GenericToolCard's `expanded` density.
// Split out of GenericToolCard.tsx so the main file focuses on
// composition. Each renderer takes the already-detected shape and
// produces the corresponding UI — tables, chip rows, KV grids, string
// blobs with copy/download, and a raw JSON fallback.

import { useState, type ReactNode } from 'react'

import { MAX_KV_ENTRIES, MAX_TABLE_ROWS } from './constants'
import {
  detectShape,
  isArrayOfObjects,
  renderValueInline,
  truncateInline,
  type Detected,
} from './helpers'
import { S } from './styles'

export function ArrayOfObjectsTable({
  rows,
  limit,
}: {
  rows: Record<string, unknown>[]
  limit: number
}) {
  // Union of keys across the first `limit` rows. Preserves insertion
  // order of the first row, then appends new keys in row order.
  const seen = new Set<string>()
  const keys: string[] = []
  const visible = rows.slice(0, limit)
  for (const row of visible) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const overflow = rows.length - visible.length
  return (
    <div style={S.tableWrap}>
      <table style={S.table}>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} style={S.th}>
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr key={i}>
              {keys.map((k) => {
                const cell = renderValueInline(row[k])
                return (
                  <td key={k} style={S.td} title={cell}>
                    {cell}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {overflow > 0 ? (
        <div style={S.tableFooter}>
          {overflow} more row{overflow === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  )
}

export function ArrayPrimitiveChips({ items }: { items: unknown[] }) {
  return (
    <div style={S.chipRow}>
      {items.map((v, i) => (
        <span key={i} style={S.chip} title={renderValueInline(v)}>
          {truncateInline(renderValueInline(v), 40)}
        </span>
      ))}
    </div>
  )
}

export function StringBlob({
  text,
  toolName,
}: {
  text: string
  toolName?: string
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard API unavailable (permissions, non-HTTPS). Swallow —
      // the button is a best-effort convenience, not a contract.
    }
  }
  const onDownload = () => {
    try {
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${toolName ?? 'output'}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // Same reasoning as above — download is opportunistic.
    }
  }
  return (
    <div>
      <pre style={S.blob}>{text}</pre>
      <div style={S.blobActions}>
        <button type="button" style={S.blobBtn} onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" style={S.blobBtn} onClick={onDownload}>
          Download .txt
        </button>
      </div>
    </div>
  )
}

function renderKvValue(value: unknown): ReactNode {
  // For nested structured values, render with the matching shape so the
  // user can still see them at a glance without drilling down.
  const d = detectShape(value)
  if (d.kind === 'array-primitive') {
    return <ArrayPrimitiveChips items={d.items.slice(0, 12)} />
  }
  if (d.kind === 'array-of-objects') {
    return <ArrayOfObjectsTable rows={d.rows} limit={5} />
  }
  if (d.kind === 'list-wrapper') {
    if (isArrayOfObjects(d.items)) {
      return <ArrayOfObjectsTable rows={d.items} limit={5} />
    }
    return <ArrayPrimitiveChips items={d.items.slice(0, 12)} />
  }
  if (d.kind === 'string-blob') {
    const full = d.text
    const shown = truncateInline(full, 120)
    return (
      <span title={full} style={{ whiteSpace: 'pre-wrap' }}>
        {shown}
      </span>
    )
  }
  // kv-object + unknown both collapse to a single-line JSON preview.
  // Avoiding unbounded recursion on kv-object keeps the grid readable;
  // deeply nested objects are better inspected through the JSON tree.
  return (
    <span title={renderValueInline(value)}>
      {truncateInline(renderValueInline(value), 120)}
    </span>
  )
}

export function KvObjectGrid({ entries }: { entries: [string, unknown][] }) {
  const visible = entries.slice(0, MAX_KV_ENTRIES)
  const overflow = entries.length - visible.length
  // Flatten into explicit key/value cells (see InputBlock for rationale).
  const cells: ReactNode[] = []
  for (const [k, v] of visible) {
    cells.push(
      <div key={`k-${k}`} style={S.kvKey}>
        {k}
      </div>,
    )
    cells.push(
      <div key={`v-${k}`} style={S.kvValue}>
        {renderKvValue(v)}
      </div>,
    )
  }
  return (
    <div>
      <div style={S.kvGrid}>{cells}</div>
      {overflow > 0 ? (
        <div style={{ ...S.expandHint, marginTop: 4 }}>
          {overflow} more field{overflow === 1 ? '' : 's'}
        </div>
      ) : null}
    </div>
  )
}

export function JsonTree({ value }: { value: unknown }) {
  let text: string
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return <pre style={S.jsonTree}>{text}</pre>
}

export function ShapeRenderer({
  detected,
  toolName,
}: {
  detected: Detected
  toolName?: string
}) {
  switch (detected.kind) {
    case 'array-of-objects':
      return <ArrayOfObjectsTable rows={detected.rows} limit={MAX_TABLE_ROWS} />
    case 'array-primitive':
      return <ArrayPrimitiveChips items={detected.items} />
    case 'list-wrapper':
      return (
        <div style={S.section}>
          <div style={S.subHeader}>{detected.key}</div>
          {isArrayOfObjects(detected.items) ? (
            <ArrayOfObjectsTable
              rows={detected.items}
              limit={MAX_TABLE_ROWS}
            />
          ) : (
            <ArrayPrimitiveChips items={detected.items} />
          )}
        </div>
      )
    case 'kv-object':
      return <KvObjectGrid entries={detected.entries} />
    case 'string-blob':
      return <StringBlob text={detected.text} toolName={toolName} />
    case 'unknown':
      return <JsonTree value={detected.json} />
  }
}
