// Phase 3a · workspace_glob preview card.
//
// Flat list of matched paths with a per-row kind badge. Clicking a row fires
// a composer mention-add so the user can pull any hit into their next turn
// without retyping the path.

import type { ToolPreviewResolver } from '../preview-registry'
import { fileKindFromName } from '@/lib/workspace/file-kind'
import { dispatchMentionAdd } from '@/lib/composer-bus'
import { useRuntimeStore } from '@/stores/runtime-store'

// ─── Input / output shape narrowing ───────────────────────────────────

interface GlobInput {
  pattern: string
}

interface GlobOutput {
  files: string[]
  truncated: boolean
}

function narrowInput(value: unknown): GlobInput | null {
  if (!value || typeof value !== 'object') return null
  const p = (value as { pattern?: unknown }).pattern
  if (typeof p !== 'string' || p.length === 0) return null
  return { pattern: p }
}

function narrowOutput(value: unknown): GlobOutput | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as { files?: unknown }).files
  if (!Array.isArray(raw)) return null
  const files: string[] = []
  for (const f of raw) {
    if (typeof f === 'string' && f.length > 0) files.push(f)
  }
  return {
    files,
    truncated: (value as { truncated?: unknown }).truncated === true,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function basename(relPath: string): string {
  const segs = relPath.split('/')
  return segs[segs.length - 1] || relPath
}

// ─── Rendering ────────────────────────────────────────────────────────

function PatternHeader({ pattern }: { pattern: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>pattern</span>
      <code
        style={{
          fontFamily: 'var(--font-sans)',
          background: 'rgba(0, 0, 0, 0.25)',
          padding: '1px 5px',
          borderRadius: 3,
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
        }}
      >
        {pattern}
      </code>
    </div>
  )
}

function FileRow({ relPath }: { relPath: string }) {
  const kind = fileKindFromName(basename(relPath))
  const onClick = () => {
    const sessionId = useRuntimeStore.getState().activeSessionId
    if (!sessionId) return
    dispatchMentionAdd({
      ref: { type: 'file', sessionId, relPath },
      label: basename(relPath) || relPath,
    })
  }
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={`Mention ${basename(relPath)} in composer`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '2px 6px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text-primary)',
          borderRadius: 3,
        }}
      >
        <span
          style={{
            fontSize: "var(--text-xxs)",
            padding: '1px 5px',
            borderRadius: 3,
            background: 'rgba(110, 168, 254, 0.12)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          {kind}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {relPath}
        </span>
      </button>
    </li>
  )
}

function Footer({
  count,
  truncated,
}: {
  count: number
  truncated: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span>
        {count} file{count === 1 ? '' : 's'}
      </span>
      {truncated ? (
        <span
          style={{
            padding: '1px 5px',
            borderRadius: 3,
            border: '1px solid var(--color-border)',
            background: 'rgba(255, 100, 100, 0.12)',
            color: 'var(--color-text-primary)',
          }}
        >
          truncated
        </span>
      ) : null}
    </div>
  )
}

function Malformed() {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}
    >
      malformed output
    </div>
  )
}

function GlobList({
  files,
  maxHeight,
  cap,
}: {
  files: string[]
  maxHeight: number
  cap: number | null
}) {
  const shown = cap != null ? files.slice(0, cap) : files
  const remainder = cap != null ? files.length - shown.length : 0
  return (
    <div style={{ maxHeight, overflow: 'auto' }}>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {shown.map((rel) => (
          <FileRow key={rel} relPath={rel} />
        ))}
      </ul>
      {remainder > 0 ? (
        <span
          style={{
            display: 'block',
            padding: '2px 6px',
            fontSize: 'var(--text-xs)',
            fontStyle: 'italic',
            color: 'var(--color-text-muted)',
          }}
        >
          +{remainder} more file{remainder === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const WorkspaceGlobPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: input ? `glob · ${input.pattern}` : 'workspace_glob',
      compact: <Malformed />,
    }
  }

  const count = output.files.length
  const oneLiner = `${count} file${count === 1 ? '' : 's'}${
    output.truncated ? ' · truncated' : ''
  }`

  const emptyBlock = (
    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
      No matches
    </span>
  )

  return {
    oneLiner,
    compact: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {input ? <PatternHeader pattern={input.pattern} /> : null}
        {count === 0 ? emptyBlock : (
          <GlobList files={output.files} maxHeight={140} cap={5} />
        )}
        <Footer count={count} truncated={output.truncated} />
      </div>
    ),
    expanded: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {input ? <PatternHeader pattern={input.pattern} /> : null}
        {count === 0 ? emptyBlock : (
          <GlobList files={output.files} maxHeight={480} cap={null} />
        )}
        <Footer count={count} truncated={output.truncated} />
      </div>
    ),
  }
}
