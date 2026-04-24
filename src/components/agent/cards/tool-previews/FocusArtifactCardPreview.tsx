// Phase 3c · focus_artifact preview card.
//
// `focus_artifact` is a pure UI side effect — on success it returns
// `{ ok: true, artifactId, title }`. On failure the tool throws, so the
// step ends up with status === 'failed' and no structured output. The
// preview handles both branches so the card never renders blank:
//
//   - success: show a green chip + "Focused <title>" + a "Jump to
//     artifact" button that re-focuses (duplicate clicks are harmless).
//   - failure: show a red chip + whatever error string the tool raised,
//     surfaced through `step.outputSummary`.

import type { ReactNode } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { useRuntimeStore } from '@/stores/runtime-store'
import { toast } from '@/stores/toast-store'

// ─── Input / output shape narrowing ───────────────────────────────────

interface FocusArtifactInput {
  artifactId: string
}

interface FocusArtifactOutput {
  ok: boolean
  artifactId: string
  title: string
}

function narrowInput(value: unknown): FocusArtifactInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { artifactId?: unknown }
  if (typeof v.artifactId !== 'string' || v.artifactId.length === 0) return null
  return { artifactId: v.artifactId }
}

function narrowOutput(value: unknown): FocusArtifactOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { ok?: unknown; artifactId?: unknown; title?: unknown }
  if (typeof v.artifactId !== 'string' || v.artifactId.length === 0) return null
  const ok = v.ok === true
  const title = typeof v.title === 'string' ? v.title : v.artifactId
  return { ok, artifactId: v.artifactId, title }
}

// ─── Rendering ────────────────────────────────────────────────────────

function StatusChip({ kind, label }: { kind: 'ok' | 'err'; label: string }) {
  const bg =
    kind === 'ok'
      ? 'rgba(92, 184, 92, 0.15)'
      : 'rgba(217, 83, 79, 0.15)'
  return (
    <span
      style={{
        fontSize: "var(--text-xxs)",
        padding: '1px 6px',
        borderRadius: 3,
        background: bg,
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </span>
  )
}

function ArtifactIdCode({ id }: { id: string }) {
  return (
    <code
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: "var(--text-xxs)",
        padding: '1px 5px',
        borderRadius: 3,
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
        background: 'rgba(0, 0, 0, 0.25)',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
      title={id}
    >
      {id}
    </code>
  )
}

function JumpButton({ artifactId, title }: { artifactId: string; title: string }) {
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
      Jump to artifact
    </button>
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

// ─── Body builders ────────────────────────────────────────────────────

function SuccessBody({
  output,
  density,
}: {
  output: FocusArtifactOutput
  density: 'compact' | 'expanded'
}) {
  const gap = density === 'compact' ? 4 : 6
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--text-xs)',
          flexWrap: 'wrap',
        }}
      >
        <StatusChip kind="ok" label="focused" />
        <span
          style={{
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
          title={output.title}
        >
          Focused {output.title}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        <ArtifactIdCode id={output.artifactId} />
        <JumpButton
          artifactId={output.artifactId}
          title={output.title}
        />
      </div>
    </div>
  )
}

function FailureBody({
  input,
  reason,
  density,
}: {
  input: FocusArtifactInput | null
  reason: string | undefined
  density: 'compact' | 'expanded'
}) {
  const gap = density === 'compact' ? 4 : 6
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--text-xs)',
          flexWrap: 'wrap',
        }}
      >
        <StatusChip kind="err" label="failed" />
        <span
          style={{
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
          title={reason ?? 'Focus failed'}
        >
          {reason ?? 'Focus failed'}
        </span>
      </div>
      {input ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <ArtifactIdCode id={input.artifactId} />
        </div>
      ) : null}
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const FocusArtifactPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)
  const isFailed = step.status === 'failed'

  // If the tool actually threw, `step.output` is absent — rely on the
  // step's top-level status + `outputSummary` for the error string.
  if (isFailed || (!output && step.output != null)) {
    const reason = step.outputSummary ?? 'Focus failed'
    const oneLiner = input
      ? `failed · ${input.artifactId}`
      : 'focus_artifact · failed'
    const compact: ReactNode = (
      <FailureBody input={input} reason={reason} density="compact" />
    )
    const expanded: ReactNode = (
      <FailureBody input={input} reason={reason} density="expanded" />
    )
    return { oneLiner, compact, expanded }
  }

  if (!output) {
    return {
      oneLiner: input
        ? `focus_artifact · ${input.artifactId}`
        : 'focus_artifact',
      compact: <Malformed />,
    }
  }

  if (!output.ok) {
    // `ok: false` isn't part of the current tool contract, but the narrow
    // path above tolerates it — treat it like the failure branch.
    const reason = step.outputSummary ?? `Could not focus ${output.title}`
    return {
      oneLiner: `failed · ${output.artifactId}`,
      compact: <FailureBody input={input} reason={reason} density="compact" />,
      expanded: (
        <FailureBody input={input} reason={reason} density="expanded" />
      ),
    }
  }

  const oneLiner = `focused · ${output.title}`

  return {
    oneLiner,
    compact: <SuccessBody output={output} density="compact" />,
    expanded: <SuccessBody output={output} density="expanded" />,
  }
}
