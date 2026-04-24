// Phase 3c · list_artifacts preview card.
//
// Renders the session's artifact inventory as a scrollable list. Each row
// shows a kind chip, the artifact title, and an optional source-file hint;
// clicking a row focuses the artifact on the canvas so the user can
// immediately see what the model is referencing. The list input never
// carries arguments today (`Record<string, never>`), but we still surface
// any `kind` filter if one appears in future — the header slot already
// expects a possibly-absent filter chip, so the migration is painless.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { ARTIFACT_KIND_LABEL } from '../preview-registry'
import type { ArtifactKind } from '../../../../types/artifact'
import { useRuntimeStore } from '@/stores/runtime-store'
import { toast } from '@/stores/toast-store'

// ─── Input / output shape narrowing ───────────────────────────────────

interface ListArtifactsInputFilter {
  /** Reserved for forward-compatibility — `list_artifacts` currently
   *  takes no arguments. We still parse a `kind` hint so an older or
   *  experimental build that adds filtering gets a useful chip. */
  kind?: string
}

interface ListedArtifact {
  id: string
  kind: string
  title: string
  sourceFile: string | null
}

interface ListArtifactsOutput {
  artifacts: ListedArtifact[]
}

function narrowInput(value: unknown): ListArtifactsInputFilter | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { kind?: unknown }
  if (typeof v.kind === 'string' && v.kind.length > 0) return { kind: v.kind }
  // Input is present but empty — still a valid no-op input; return an
  // empty object so the header slot knows the call had structured args.
  return {}
}

function narrowOutput(value: unknown): ListArtifactsOutput | null {
  if (!value || typeof value !== 'object') return null
  const raw = (value as { artifacts?: unknown }).artifacts
  if (!Array.isArray(raw)) return null
  const artifacts: ListedArtifact[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as {
      id?: unknown
      kind?: unknown
      title?: unknown
      sourceFile?: unknown
    }
    if (typeof row.id !== 'string' || row.id.length === 0) continue
    if (typeof row.kind !== 'string') continue
    const title = typeof row.title === 'string' ? row.title : row.id
    const sourceFile =
      typeof row.sourceFile === 'string' && row.sourceFile.length > 0
        ? row.sourceFile
        : null
    artifacts.push({
      id: row.id,
      kind: row.kind,
      title,
      sourceFile,
    })
  }
  return { artifacts }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function kindLabel(kind: string): string {
  const mapped = ARTIFACT_KIND_LABEL[kind as ArtifactKind]
  if (mapped) return mapped
  // Fallback — title-case the raw id so unknown future kinds still read
  // cleanly (e.g. `custom-kind` → `Custom Kind`).
  return kind
    .split('-')
    .map((seg) => (seg.length > 0 ? seg[0].toUpperCase() + seg.slice(1) : seg))
    .join(' ')
}

// ─── Rendering ────────────────────────────────────────────────────────

function FilterHeader({ filter }: { filter: ListArtifactsInputFilter }) {
  if (!filter.kind) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>kind</span>
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
        {filter.kind}
      </code>
    </div>
  )
}

function KindChip({ kind }: { kind: string }) {
  return (
    <span
      style={{
        fontSize: "var(--text-xxs)",
        padding: '1px 5px',
        borderRadius: 3,
        background: 'rgba(110, 168, 254, 0.12)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      title={kind}
    >
      {kindLabel(kind)}
    </span>
  )
}

function ArtifactRow({ artifact }: { artifact: ListedArtifact }) {
  const onClick = () => {
    const sessionId = useRuntimeStore.getState().activeSessionId
    if (!sessionId) {
      toast.warn('No active session — cannot focus artifact.')
      return
    }
    const session = useRuntimeStore.getState().sessions[sessionId]
    if (!session?.artifacts[artifact.id]) {
      toast.warn(`Artifact no longer in session: ${artifact.title}`)
      return
    }
    useRuntimeStore.getState().focusArtifact(sessionId, artifact.id)
    toast.info(`Focused ${artifact.title}`)
  }
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={`Focus ${artifact.title}`}
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
          color: 'var(--color-text-primary)',
          borderRadius: 3,
          minWidth: 0,
        }}
      >
        <KindChip kind={artifact.kind} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {artifact.title}
        </span>
        {artifact.sourceFile ? (
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 140,
              flexShrink: 0,
            }}
            title={artifact.sourceFile}
          >
            {artifact.sourceFile}
          </span>
        ) : null}
      </button>
    </li>
  )
}

function Footer({ count }: { count: number }) {
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
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
        }}
      >
        {count} artifact{count === 1 ? '' : 's'}
      </span>
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

function ArtifactList({
  artifacts,
  maxHeight,
  cap,
}: {
  artifacts: ListedArtifact[]
  maxHeight: number
  cap: number | null
}) {
  const shown = cap != null ? artifacts.slice(0, cap) : artifacts
  const remainder = cap != null ? artifacts.length - shown.length : 0
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
        {shown.map((a) => (
          <ArtifactRow key={a.id} artifact={a} />
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
          +{remainder} more artifact{remainder === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )
}

function EmptyBlock(): ReactNode {
  return (
    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
      No artifacts yet
    </span>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const ListArtifactsPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: 'list_artifacts',
      compact: <Malformed />,
    }
  }

  const count = output.artifacts.length
  const filterSuffix = input?.kind ? ` · kind=${input.kind}` : ''
  const oneLiner = `${count} artifact${count === 1 ? '' : 's'}${filterSuffix}`

  const showHeader = Boolean(input?.kind)

  return {
    oneLiner,
    compact: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {showHeader && input ? <FilterHeader filter={input} /> : null}
        {count === 0 ? (
          <EmptyBlock />
        ) : (
          <ArtifactList artifacts={output.artifacts} maxHeight={140} cap={5} />
        )}
        <Footer count={count} />
      </div>
    ),
    expanded: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {showHeader && input ? <FilterHeader filter={input} /> : null}
        {count === 0 ? (
          <EmptyBlock />
        ) : (
          <ArtifactList
            artifacts={output.artifacts}
            maxHeight={480}
            cap={null}
          />
        )}
        <Footer count={count} />
      </div>
    ),
  }
}
