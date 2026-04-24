// Phase 3a · workspace_bash preview card.
//
// Splits stdout and stderr into two tinted panes so shell output is easy to
// scan at a glance. Exit code turns green/red; duration shows when the tool
// happens to emit it (the current output shape doesn't, but we fall back to
// step timestamps so the chip is still informative).

import type { ToolPreviewResolver } from '../preview-registry'

// ─── Input / output shape narrowing ───────────────────────────────────

interface BashInput {
  command: string
  timeoutMs?: number
}

interface BashOutput {
  stdout: string
  stderr: string
  exitCode: number
  durationMs?: number
  success?: boolean
}

function narrowInput(value: unknown): BashInput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { command?: unknown; timeoutMs?: unknown }
  if (typeof v.command !== 'string' || v.command.length === 0) return null
  return {
    command: v.command,
    timeoutMs: typeof v.timeoutMs === 'number' ? v.timeoutMs : undefined,
  }
}

function narrowOutput(value: unknown): BashOutput | null {
  if (!value || typeof value !== 'object') return null
  const v = value as {
    stdout?: unknown
    stderr?: unknown
    exitCode?: unknown
    durationMs?: unknown
    success?: unknown
  }
  // Either field may be empty — the shape is valid as long as exitCode is
  // a number and stdout / stderr are strings (absent → coerce to '').
  if (typeof v.exitCode !== 'number') return null
  return {
    stdout: typeof v.stdout === 'string' ? v.stdout : '',
    stderr: typeof v.stderr === 'string' ? v.stderr : '',
    exitCode: v.exitCode,
    durationMs:
      typeof v.durationMs === 'number' && Number.isFinite(v.durationMs)
        ? v.durationMs
        : undefined,
    success: typeof v.success === 'boolean' ? v.success : undefined,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function truncateCommand(cmd: string, cap: number): string {
  if (cmd.length <= cap) return cmd
  return cmd.slice(0, cap - 1) + '…'
}

function formatDuration(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s >= 10 ? 1 : 2)} s`
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}m ${r.toFixed(0)}s`
}

// ─── Rendering ────────────────────────────────────────────────────────

function CommandHeader({ command }: { command: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span
        style={{
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        $
      </span>
      <code
        style={{
          fontFamily: 'var(--font-sans)',
          background: 'rgba(0, 0, 0, 0.25)',
          padding: '1px 6px',
          borderRadius: 3,
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
        title={command}
      >
        {truncateCommand(command, 120)}
      </code>
    </div>
  )
}

function StreamPane({
  label,
  body,
  tint,
  maxHeight,
}: {
  label: string
  body: string
  tint: 'ok' | 'err'
  maxHeight: number
}) {
  const trimmed = body.replace(/\s+$/, '')
  const empty = trimmed.length === 0
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: "var(--text-xxs)",
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {label}
      </span>
      <pre
        className="agent-card-code-block"
        style={{
          margin: 0,
          maxHeight,
          overflow: 'auto',
          padding: '4px 6px',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-xs)',
          color: empty
            ? 'var(--color-text-muted)'
            : 'var(--color-text-primary)',
          background:
            tint === 'ok'
              ? 'rgba(92, 184, 92, 0.08)'
              : 'rgba(217, 83, 79, 0.08)',
          border: '1px solid var(--color-border)',
          borderRadius: 3,
          fontStyle: empty ? 'italic' : 'normal',
        }}
      >
        {empty ? '(empty)' : trimmed}
      </pre>
    </div>
  )
}

function Footer({
  exitCode,
  durationMs,
  stepDurationMs,
}: {
  exitCode: number
  durationMs: number | undefined
  stepDurationMs: number | undefined
}) {
  const ok = exitCode === 0
  const d = formatDuration(durationMs) ?? formatDuration(stepDurationMs)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        fontSize: 'var(--text-xs)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid var(--color-border)',
          background: ok
            ? 'rgba(92, 184, 92, 0.15)'
            : 'rgba(217, 83, 79, 0.15)',
          color: ok ? 'var(--color-text-primary)' : 'var(--color-text-primary)',
        }}
      >
        exit {exitCode}
      </span>
      {d ? (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text-muted)',
            padding: '1px 6px',
            borderRadius: 3,
            border: '1px solid var(--color-border)',
          }}
        >
          {d}
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

// ─── Resolver ─────────────────────────────────────────────────────────

export const WorkspaceBashPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  // Step-level duration fallback when the tool output doesn't carry one.
  const stepDurationMs =
    typeof step.endedAt === 'number' &&
    typeof step.startedAt === 'number' &&
    step.endedAt >= step.startedAt
      ? step.endedAt - step.startedAt
      : undefined

  if (!output) {
    return {
      oneLiner: input
        ? `bash · ${truncateCommand(input.command, 60)}`
        : 'workspace_bash',
      compact: <Malformed />,
    }
  }

  const dur = formatDuration(output.durationMs) ?? formatDuration(stepDurationMs)
  const oneLiner = [
    output.exitCode === 0 ? 'ok' : `exit ${output.exitCode}`,
    input ? truncateCommand(input.command, 40) : null,
    dur,
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    oneLiner,
    compact: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {input ? <CommandHeader command={input.command} /> : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <StreamPane
            label="stdout"
            body={output.stdout}
            tint="ok"
            maxHeight={80}
          />
          <StreamPane
            label="stderr"
            body={output.stderr}
            tint="err"
            maxHeight={80}
          />
        </div>
        <Footer
          exitCode={output.exitCode}
          durationMs={output.durationMs}
          stepDurationMs={stepDurationMs}
        />
      </div>
    ),
    expanded: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {input ? <CommandHeader command={input.command} /> : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 6,
          }}
        >
          <StreamPane
            label="stdout"
            body={output.stdout}
            tint="ok"
            maxHeight={360}
          />
          <StreamPane
            label="stderr"
            body={output.stderr}
            tint="err"
            maxHeight={360}
          />
        </div>
        <Footer
          exitCode={output.exitCode}
          durationMs={output.durationMs}
          stepDurationMs={stepDurationMs}
        />
      </div>
    ),
  }
}
