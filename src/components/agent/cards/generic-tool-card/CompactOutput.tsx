// Trimmed output preview rendered for the `compact` density. Split out
// of GenericToolCard.tsx so the main file focuses on composition. Uses
// the same detected-shape union as the expanded renderer but applies
// tighter row / char limits.

import { COMPACT_PREVIEW_CHARS, COMPACT_PREVIEW_ROWS } from './constants'
import { isArrayOfObjects, truncateInline, type Detected } from './helpers'
import { ArrayOfObjectsTable, ArrayPrimitiveChips, KvObjectGrid } from './renderers'
import { S } from './styles'

export default function CompactOutput({ detected }: { detected: Detected }) {
  switch (detected.kind) {
    case 'array-of-objects':
      return (
        <ArrayOfObjectsTable rows={detected.rows} limit={COMPACT_PREVIEW_ROWS} />
      )
    case 'array-primitive':
      return <ArrayPrimitiveChips items={detected.items.slice(0, 12)} />
    case 'list-wrapper': {
      const head = detected.items.slice(0, COMPACT_PREVIEW_ROWS)
      return (
        <div style={S.section}>
          <div style={S.subHeader}>{detected.key}</div>
          {isArrayOfObjects(head) ? (
            <ArrayOfObjectsTable rows={head} limit={COMPACT_PREVIEW_ROWS} />
          ) : (
            <ArrayPrimitiveChips items={head} />
          )}
        </div>
      )
    }
    case 'kv-object': {
      const entries = detected.entries.slice(0, 6)
      return <KvObjectGrid entries={entries} />
    }
    case 'string-blob': {
      const lines = detected.text.split('\n').slice(0, 3).join('\n')
      const trimmed =
        lines.length > COMPACT_PREVIEW_CHARS
          ? lines.slice(0, COMPACT_PREVIEW_CHARS - 1) + '…'
          : lines
      return <pre style={{ ...S.blob, maxHeight: 100 }}>{trimmed}</pre>
    }
    case 'unknown': {
      let text: string
      try {
        text = JSON.stringify(detected.json)
      } catch {
        text = String(detected.json)
      }
      return (
        <pre style={{ ...S.blob, maxHeight: 100 }}>
          {truncateInline(text, COMPACT_PREVIEW_CHARS)}
        </pre>
      )
    }
  }
}
