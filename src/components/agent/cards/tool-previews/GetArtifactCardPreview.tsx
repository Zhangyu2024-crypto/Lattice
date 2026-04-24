// Phase 3c · get_artifact preview card.
//
// The tool returns a trimmed snapshot of a single artifact. We delegate
// the body rendering to the existing artifact-kind preview registry —
// `getArtifactPreview(artifact)` — so this card looks consistent with the
// pure artifact bubbles the user already knows. To get a real Artifact
// with `createdAt` / `updatedAt` (the registry expects the full shape, not
// the denormalized tool output) we look the id up in the runtime store.
// When the live artifact is gone we degrade to a JSON tree summary so the
// card still renders useful information from the cached tool payload.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import {
  ARTIFACT_KIND_LABEL,
  getArtifactPreview,
} from '../preview-registry'
import type { Artifact, ArtifactKind } from '../../../../types/artifact'
import { useRuntimeStore } from '@/stores/runtime-store'
import { toast } from '@/stores/toast-store'

// ─── Input / output shape narrowing ───────────────────────────────────

interface GetArtifactInput {
  artifactId: string
}

interface GetArtifactOutput {
  id: string
  kind: string
  title: string
  sourceFile: string | null
  payload: unknown
}

function narrowInput(value: unknown): GetArtifactInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { artifactId?: unknown }
  if (typeof v.artifactId !== 'string' || v.artifactId.length === 0) return null
  return { artifactId: v.artifactId }
}

function narrowOutput(value: unknown): GetArtifactOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as {
    id?: unknown
    kind?: unknown
    title?: unknown
    sourceFile?: unknown
    payload?: unknown
  }
  if (typeof v.id !== 'string' || v.id.length === 0) return null
  if (typeof v.kind !== 'string') return null
  const title = typeof v.title === 'string' ? v.title : v.id
  const sourceFile =
    typeof v.sourceFile === 'string' && v.sourceFile.length > 0
      ? v.sourceFile
      : null
  return {
    id: v.id,
    kind: v.kind,
    title,
    sourceFile,
    payload: v.payload,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function kindLabel(kind: string): string {
  return ARTIFACT_KIND_LABEL[kind as ArtifactKind] ?? kind
}

function useLiveArtifact(artifactId: string | undefined): Artifact | null {
  // Subscribe explicitly so a later mutation re-renders the card. We read
  // out of the active session because `get_artifact` always operates on
  // the current runtime session (the tool's `ctx.sessionId` path).
  return useRuntimeStore((state) => {
    const activeId = state.activeSessionId
    if (!activeId || !artifactId) return null
    const session = state.sessions[activeId]
    return session?.artifacts[artifactId] ?? null
  })
}

// ─── Rendering ────────────────────────────────────────────────────────

function ArtifactHeader({
  id,
  kind,
  title,
  sourceFile,
}: {
  id: string
  kind: string
  title: string
  sourceFile: string | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
        flexWrap: 'wrap',
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
          fontFamily: 'var(--font-sans)',
        }}
        title={kind}
      >
        {kindLabel(kind)}
      </span>
      <span
        style={{
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          flex: 1,
        }}
        title={title}
      >
        {title}
      </span>
      <code
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: "var(--text-xxs)",
          padding: '1px 5px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          background: 'rgba(0, 0, 0, 0.25)',
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={id}
      >
        {id}
      </code>
      {sourceFile ? (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}
          title={sourceFile}
        >
          {sourceFile}
        </span>
      ) : null}
    </div>
  )
}

function FocusButton({ artifactId, title }: { artifactId: string; title: string }) {
  const onClick = () => {
    const sessionId = useRuntimeStore.getState().activeSessionId
    if (!sessionId) {
      toast.warn('No active session — cannot focus artifact.')
      return
    }
    const session = useRuntimeStore.getState().sessions[sessionId]
    if (!session?.artifacts[artifactId]) {
      toast.warn(`Artifact no longer in session: ${title}`)
      return
    }
    useRuntimeStore.getState().focusArtifact(sessionId, artifactId)
    toast.info(`Focused ${title}`)
  }
  return (
    <button
      type="button"
      className="agent-card-btn"
      onClick={onClick}
      style={{ fontSize: 'var(--text-xs)' }}
      title={`Focus ${title}`}
    >
      Focus
    </button>
  )
}

function Footer({
  id,
  kind,
  title,
}: {
  id: string
  kind: string
  title: string
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
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
        }}
        title={kind}
      >
        {kindLabel(kind)}
      </span>
      <code
        style={{
          fontFamily: 'var(--font-sans)',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={id}
      >
        {id}
      </code>
      <FocusButton artifactId={id} title={title} />
    </div>
  )
}

function PayloadJson({ payload }: { payload: unknown }) {
  let serialized: string
  try {
    serialized = JSON.stringify(payload, null, 2)
  } catch {
    serialized = '[unserializable]'
  }
  // Hard cap the rendered JSON so a deeply-trimmed payload cannot still
  // tank the chat thread. The tool already trims to MAX_DEPTH=3 etc., so
  // 8 KB is plenty for the inspection use case.
  const CAP = 8_000
  const truncated = serialized.length > CAP
  const display = truncated ? serialized.slice(0, CAP) + '\n…' : serialized
  // Let the <details> element manage its own open state — no need to
  // mirror it into React state since nothing else in the card depends on
  // whether the payload is currently expanded.
  return (
    <details style={{ fontSize: 'var(--text-xs)' }}>
      <summary
        style={{
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          userSelect: 'none',
        }}
      >
        payload
      </summary>
      <pre
        className="agent-card-code-block"
        style={{
          margin: '4px 0 0',
          padding: '4px 6px',
          maxHeight: 320,
          overflow: 'auto',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-xs)',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid var(--color-border)',
          borderRadius: 3,
        }}
      >
        {display}
      </pre>
      {truncated ? (
        <span
          style={{
            display: 'block',
            marginTop: 2,
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
          }}
        >
          truncated at {CAP.toLocaleString()} chars
        </span>
      ) : null}
    </details>
  )
}

function DelegatedPreview({ artifact }: { artifact: Artifact }) {
  const inner = getArtifactPreview(artifact)
  if (!inner.compact && !inner.expanded && !inner.oneLiner) return null
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '4px 6px',
        background: 'rgba(110, 168, 254, 0.06)',
        border: '1px solid var(--color-border)',
        borderRadius: 3,
      }}
    >
      {inner.oneLiner ? (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {inner.oneLiner}
        </span>
      ) : null}
      {inner.compact ? <div>{inner.compact}</div> : null}
      {inner.expanded ? <div>{inner.expanded}</div> : null}
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

// ─── Body component ───────────────────────────────────────────────────

function GetArtifactBody({
  output,
  density,
}: {
  output: GetArtifactOutput
  density: 'compact' | 'expanded'
}) {
  const live = useLiveArtifact(output.id)
  const gap = density === 'compact' ? 4 : 6
  const children: ReactNode[] = []
  children.push(
    <ArtifactHeader
      key="header"
      id={output.id}
      kind={output.kind}
      title={output.title}
      sourceFile={output.sourceFile}
    />,
  )
  if (live) {
    children.push(<DelegatedPreview key="delegated" artifact={live} />)
  } else {
    // The live artifact is gone (user deleted it, or the session changed).
    // Fall back to the JSON tree so the cached snapshot still surfaces
    // something inspectable.
    children.push(<PayloadJson key="payload" payload={output.payload} />)
  }
  children.push(
    <Footer
      key="footer"
      id={output.id}
      kind={output.kind}
      title={output.title}
    />,
  )
  return <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const GetArtifactPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: input ? `get_artifact · ${input.artifactId}` : 'get_artifact',
      compact: <Malformed />,
    }
  }

  const oneLiner = `${kindLabel(output.kind)} · ${output.title}`

  return {
    oneLiner,
    compact: <GetArtifactBody output={output} density="compact" />,
    expanded: <GetArtifactBody output={output} density="expanded" />,
  }
}
